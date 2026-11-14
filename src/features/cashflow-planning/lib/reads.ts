import type { QueryClient } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { isAccountGroupsUnsupported } from "@/lib/api/accountGroups";
import { readMovement, readStartingBalances, readTransfersIn, readUncategorizedIn } from "@/lib/financial-insights/reads";
import type { DatedAmount, MovementRow } from "@/lib/financial-insights/measures";
import { getDebt, listDebts } from "@/features/assets-debt/lib/debtsApi";
import { projectAfterAnchor, readTrackedLoan } from "@/features/assets-debt/lib/trackedLoan";
import { recordedCostRows } from "@/features/financial-insights/lib/loanSchedules";
import { budgetMonthDataQueryOptions } from "@/features/budget-management/lib/monthDataQuery";
import type { ConnectionInstance } from "@/store/connection";
import type { Account, AccountGroup } from "@/types/entities";
import { MAX_YEARS, type Month } from "@/lib/cashflow-planning/types";
import type { BudgetSnapshot, LoanForecast, SnapCategory, SnapSchedule } from "@/lib/cashflow-planning/actuals";
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

/**
 * What each tracked loan will cost in cash, month by month, from the projection the Loans page itself shows. Only a loan
 * that is tracked against its Actual account and agrees with it has a forecast; an untracked loan has none (its row can
 * follow its own history instead).
 */
export async function readLoanForecasts(connection: ConnectionInstance, input: { budgetSyncId: string; today: string; loanAccountIds: ReadonlySet<string> }): Promise<Record<string, LoanForecast>> {
  const result: Record<string, LoanForecast> = {};
  if (input.loanAccountIds.size === 0) return result;
  const debts = (await listDebts(input.budgetSyncId)).filter((d) => d.status === "active" && d.liabilityAccountId && input.loanAccountIds.has(d.liabilityAccountId));
  for (const summary of debts) {
    const accountId = summary.liabilityAccountId!;
    try {
      const read = await readTrackedLoan(connection, await getDebt(summary.id), input.today);
      if (read.state === "untracked") continue;
      if (read.state === "unavailable") { result[accountId] = { state: "unavailable", reason: read.reason }; continue; }
      if (!read.loan.agrees) { result[accountId] = { state: "unavailable", reason: `${summary.name}: its schedule does not agree with the loan account in Actual; review it in Loans` }; continue; }
      const projected = projectAfterAnchor(read.loan);
      if (!projected.ok) { result[accountId] = { state: "unavailable", reason: `${summary.name}: ${projected.reason}` }; continue; }
      // What reaches the loan account is what a row that follows it records. When repayments are recorded as splits (interest and
      // fees on their own categorized lines), only the principal is transferred, and the interest belongs to its category's row:
      // forecasting the whole installment here would count it twice.
      const principalOnly = recordedCostRows(read.loan.plan, accountId).some((tag) => !tag.charged);
      const byMonth: Record<Month, number> = {};
      for (const event of projected.projection.events) {
        const amount = principalOnly ? (event.cashMovementMinor < 0 ? Math.max(0, -event.principalMovementMinor) : -event.cashMovementMinor) : -event.cashMovementMinor;
        if (event.cashMovementMinor === 0 || amount === 0) continue;
        const month = event.date.slice(0, 7);
        byMonth[month] = (byMonth[month] ?? 0) + amount;
      }
      result[accountId] = { state: "ready", byMonth, name: summary.name, principalOnly };
    } catch (error) {
      result[accountId] = { state: "unavailable", reason: error instanceof Error ? error.message : "The loan could not be read" };
    }
  }
  return result;
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
