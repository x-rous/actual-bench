import type { QueryClient } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { isAccountGroupsUnsupported } from "@/lib/api/accountGroups";
import { runQuery } from "@/lib/api/query";
import { readLoanCostRows, readMovement, readStartingBalances, readTransfersIn, readUncategorizedIn } from "@/lib/financial-insights/reads";
import type { DatedAmount, MovementRow } from "@/lib/financial-insights/measures";
import { getDebt, listDebts } from "@/features/assets-debt/lib/debtsApi";
import { projectAfterAnchor, readTrackedLoan } from "@/features/assets-debt/lib/trackedLoan";
import { recordedCostRows } from "@/features/financial-insights/lib/loanSchedules";
import { budgetMonthDataQueryOptions } from "@/features/budget-management/lib/monthDataQuery";
import type { ConnectionInstance } from "@/store/connection";
import type { Account, AccountGroup } from "@/types/entities";
import { MAX_YEARS, type Month } from "@/lib/cashflow-planning/types";
import type { BudgetSnapshot, LoanCostLine, LoanForecast, ShiftedTransaction, SnapCategory, SnapSchedule } from "@/lib/cashflow-planning/actuals";
import { addMonths } from "@/lib/cashflow-planning/months";
import { scheduleDates } from "@/lib/cashflow-planning/scheduleDates";

/**
 * The reads behind Cashflow Planning. All of them go through the active transport (or the shared ActualQL helper the
 * Financial Insights reads use) and nothing is ever written to Actual. One request at a time: the transport queues them
 * anyway, and a failure is then easy to place.
 */

export type LedgerRead = {
  accounts: Account[];
  /** Null when the server has no account groups. */
  accountGroups: AccountGroup[] | null;
  categories: SnapCategory[];
  movement: MovementRow[];
  startingBalances: DatedAmount[];
  uncategorizedIn: DatedAmount[];
  transfersIn: (DatedAmount & { transferAccountId: string })[];
  schedules: SnapSchedule[];
  readAt: string;
};

export async function readLedger(connection: ConnectionInstance, today: string, onStage?: (stage: string) => void): Promise<LedgerRead> {
  const transport = getTransport(connection);
  onStage?.("Reading accounts…");
  const accounts = await transport.getAccounts();
  let accountGroups: AccountGroup[] | null = null;
  if (transport.getAccountGroups) {
    try { accountGroups = await transport.getAccountGroups(); } catch (error) { if (!isAccountGroupsUnsupported(error)) throw error; }
  }
  onStage?.("Reading categories…");
  const groups = await transport.getCategoryGroups();
  const groupOf = new Map(groups.groups.map((g) => [g.id, g]));
  // A category is income when its group is, as in Actual's budget.
  const categories: SnapCategory[] = groups.categories.map((c) => ({
    id: c.id, name: c.name, groupId: c.groupId, groupName: groupOf.get(c.groupId)?.name ?? "Other",
    isIncome: groupOf.get(c.groupId)?.isIncome ?? c.isIncome, hidden: c.hidden || !!groupOf.get(c.groupId)?.hidden,
  }));

  onStage?.("Reading transactions…");
  const movement = await readMovement(connection, today);
  const startingBalances = await readStartingBalances(connection, today);
  const uncategorizedIn = await readUncategorizedIn(connection, today);
  const transfersIn = await readTransfersIn(connection, today);

  onStage?.("Reading schedules…");
  // Schedules are optional: a plan works without them, and a failed read only disables the rows that follow one.
  let schedules: SnapSchedule[] = [];
  try {
    const horizon = `${Number(today.slice(0, 4)) + MAX_YEARS + 1}${today.slice(4)}`;
    const payees = new Map((await transport.getPayees()).map((p) => [p.id, p.name]));
    schedules = (await transport.getSchedules()).map((schedule): SnapSchedule => {
      const name = schedule.name?.trim() || (schedule.payeeId ? payees.get(schedule.payeeId) : undefined) || "Unnamed schedule";
      const amount = typeof schedule.amount === "number" ? schedule.amount : schedule.amount ? Math.round((schedule.amount.num1 + schedule.amount.num2) / 2) : null;
      const dates = scheduleDates(schedule, horizon);
      return { id: schedule.id, name, completed: schedule.completed, amount, dates: dates.ok ? dates.dates : null, ...(dates.ok ? {} : { problem: dates.problem }) };
    });
  } catch {
    schedules = [];
  }
  return { accounts, accountGroups, categories, movement, startingBalances, uncategorizedIn, transfersIn, schedules, readAt: new Date().toISOString() };
}

export type LoanRead = { forecasts: Record<string, LoanForecast>; costs: LoanCostLine[] };

/**
 * What each tracked loan will cost, month by month, from the projection the Loans page itself shows: the whole instalment and
 * the part that reaches the loan account. Also the interest and fee lines of the repayments already recorded as splits, so a
 * row can count whole repayments in the past as well. Only a loan that is tracked against its Actual account and agrees with it
 * has a forecast; an untracked loan has none (its row can follow its own history instead).
 */
export async function readLoanForecasts(connection: ConnectionInstance, input: { budgetSyncId: string; today: string; loanAccountIds: ReadonlySet<string> }): Promise<LoanRead> {
  const forecasts: Record<string, LoanForecast> = {};
  if (input.loanAccountIds.size === 0) return { forecasts, costs: [] };
  const debts = (await listDebts(input.budgetSyncId)).filter((d) => d.status === "active" && d.liabilityAccountId && input.loanAccountIds.has(d.liabilityAccountId));
  const tags: ReturnType<typeof recordedCostRows> = [];
  for (const summary of debts) {
    const accountId = summary.liabilityAccountId!;
    try {
      const read = await readTrackedLoan(connection, await getDebt(summary.id), input.today);
      if (read.state === "untracked") continue;
      if (read.state === "unavailable") { forecasts[accountId] = { state: "unavailable", reason: read.reason }; continue; }
      // The split lines of recorded repayments: categorized entries in a cash account. A charge the lender added inside the loan account is no cash movement.
      const splitLines = recordedCostRows(read.loan.plan, accountId).filter((tag) => !tag.charged);
      tags.push(...splitLines);
      if (!read.loan.agrees) { forecasts[accountId] = { state: "unavailable", reason: `${summary.name}: its schedule does not agree with the loan account in Actual; review it in Loans` }; continue; }
      const projected = projectAfterAnchor(read.loan);
      if (!projected.ok) { forecasts[accountId] = { state: "unavailable", reason: `${summary.name}: ${projected.reason}` }; continue; }
      const split = splitLines.length > 0;
      const payment: Record<Month, number> = {}, principal: Record<Month, number> = {};
      for (const event of projected.projection.events) {
        // Repayments only: money still to be drawn from the loan is borrowing, which a repayment row never counts.
        if (event.cashMovementMinor >= 0) continue;
        const month = event.date.slice(0, 7);
        payment[month] = (payment[month] ?? 0) - event.cashMovementMinor;
        // What reaches the loan account: with split repayments only the principal is transferred.
        const reaches = split ? Math.max(0, -event.principalMovementMinor) : -event.cashMovementMinor;
        if (reaches !== 0) principal[month] = (principal[month] ?? 0) + reaches;
      }
      forecasts[accountId] = { state: "ready", payment, principal, split, name: summary.name };
    } catch (error) {
      forecasts[accountId] = { state: "unavailable", reason: error instanceof Error ? error.message : "The loan could not be read" };
    }
  }
  let costs: LoanCostLine[] = [];
  try {
    const rows = await readLoanCostRows(connection, tags, input.today);
    costs = rows.flatMap((r) => (r.id && r.loanAccountId ? [{ id: r.id, month: r.month, accountId: r.accountId, categoryId: r.categoryId, amountMinor: r.amountMinor, loanAccountId: r.loanAccountId }] : []));
  } catch {
    // Without them a whole-repayment row shows the principal for past months; the forecast is unaffected.
  }
  return { forecasts, costs };
}

const TAG = /#(\d{4}-(?:0[1-9]|1[0-2]))(?![\d-])/;

/** The month a `#YYYY-MM` tag in a transaction's note names, if it has one. */
export function tagMonthOf(notes: string | null | undefined): Month | null {
  return notes ? TAG.exec(notes)?.[1] ?? null : null;
}

type ShiftRow = { id: string; date: string; amount: number; account: string; category: string | null; notes: string | null; "payee.transfer_acct": string | null };

/**
 * The transactions that may count in another month than their date: those whose note carries a `#YYYY-MM` tag, and those the
 * plan itself moves. A handful at most, read one by one because the monthly read cannot tell them apart.
 */
export async function readShifts(connection: ConnectionInstance, today: string, movedIds: readonly string[]): Promise<ShiftedTransaction[]> {
  const select = ["id", "date", "amount", "account", "category", "notes", "payee.transfer_acct"];
  const tagged = await runQuery<{ data: ShiftRow[] }>(connection, {
    ActualQLquery: { table: "transactions", filter: { $and: [{ date: { $lte: today } }, { notes: { $like: "%#2%" } }] }, select },
  });
  const rows = new Map(tagged.data.filter((r) => tagMonthOf(r.notes)).map((r) => [r.id, r]));
  const missing = movedIds.filter((id) => !rows.has(id));
  for (let i = 0; i < missing.length; i += 400) {
    const more = await runQuery<{ data: ShiftRow[] }>(connection, {
      ActualQLquery: { table: "transactions", filter: { $and: [{ date: { $lte: today } }, { id: { $oneof: missing.slice(i, i + 400) } }] }, select },
    });
    for (const r of more.data) rows.set(r.id, r);
  }
  return [...rows.values()].map((r) => ({ id: r.id, date: r.date, accountId: r.account, categoryId: r.category, transferAccountId: r["payee.transfer_acct"], amountMinor: r.amount, tagMonth: tagMonthOf(r.notes) }));
}

/** How many budget months ahead are read: enough for a year's plan in Actual, few enough to stay quick. */
export const BUDGET_MONTHS_AHEAD = 24;

/**
 * What Actual's budget holds from the current month on, per category. Months are read through Budget Cockpit's cached
 * month query, so a month either workspace has read is read once. A month Actual does not have is simply absent.
 */
export async function readBudget(connection: ConnectionInstance, queryClient: QueryClient, currentMonth: Month): Promise<BudgetSnapshot> {
  const existing = new Set(await getTransport(connection).getBudgetMonths());
  const months: BudgetSnapshot["months"] = {};
  let lastMonth: Month | null = null;
  for (let k = 0; k < BUDGET_MONTHS_AHEAD; k++) {
    const month = addMonths(currentMonth, k);
    if (!existing.has(month)) continue;
    try {
      const data = await queryClient.fetchQuery(budgetMonthDataQueryOptions(connection, month));
      const values: Record<string, number> = {};
      let any = false;
      for (const category of Object.values(data.categoriesById)) {
        const budgeted = Math.abs(category.budgeted);
        values[category.id] = budgeted;
        if (budgeted !== 0) any = true;
      }
      // A month Actual created but nobody budgeted says nothing about the plan: later months repeat the last one that does.
      if (!any) continue;
      months[month] = values;
      lastMonth = month;
    } catch {
      // A month that cannot be read is treated as not budgeted.
    }
  }
  return { months, lastMonth };
}
