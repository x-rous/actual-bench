import { addLoanEntry, emptyLoanFigures, loanEntries, type DebtRepayments, type LoanFigures } from "./breakdowns";
import type { Ledger } from "./measures";
import { addMonths, type ResolvedPeriod } from "./period";

/**
 * Loans & cards: what is owed, account by account, and what the payments did. Built from the facts the page already holds
 * and `debtRepayments`; nothing here is a second definition. All amounts are integer minor units; a balance is shown as an
 * owed (positive) amount. Unavailable is never zero, and a schedule is never an estimate.
 */

export type DebtGroup = "loans" | "cards" | "otherLiability";
export const DEBT_GROUPS: { key: DebtGroup; label: string }[] = [
  { key: "loans", label: "Loans" },
  { key: "cards", label: "Credit cards" },
  { key: "otherLiability", label: "Other liabilities" },
];

/** A tracked loan's schedule, as `scheduleFromLoan` read it: the principal of the next twelve months, or why there is none. */
export type ScheduleInput = { accountId: string; state: "ready"; principalNext12Minor: number; costNext12Minor: number } | { accountId: string; state: "unavailable"; reason: string };

/** Principal due in the next twelve months, as of today: a schedule, never added on top of the balance. */
export type NextTwelve =
  | { state: "scheduled"; principalMinor: number; /** Interest and fees in the same installments. */ costMinor: number; /** What is owed today less that; never negative. */ laterMinor: number }
  | { state: "notScheduled" }
  | { state: "review"; reason: string };

export type DebtAccountRow = {
  accountId: string;
  name: string;
  group: DebtGroup;
  /** Owed at the end of the month before the period, and at the end of the period (positive). */
  startMinor: number;
  endMinor: number;
  /** End less start: positive when more is owed. */
  changeMinor: number;
  /** Loans: principal repaid in the period (paid in less what the lender charged); null for the other groups. */
  principalRepaidMinor: number | null;
  /** Loans: transferred in from other loans, cards or liabilities in the period; counted as no repayment. Null for the other groups. */
  movedFromDebtsMinor: number | null;
  /** Loans only. */
  next12: NextTwelve | null;
};

export type DebtTotals = {
  startMinor: number;
  endMinor: number;
  changeMinor: number;
  principalRepaidMinor: number;
  /** The loans that have a next-12-month figure, and how many loans there are. */
  scheduledLoans: number;
  loans: number;
  principalNext12Minor: number;
  costNext12Minor: number;
};

const GROUP_OF = { loan: "loans", "credit-card": "cards", "other-liability": "otherLiability" } as const;
const ownedPositive = (balance: number) => 0 - balance;

/**
 * One row per liability account. `today` fixes the as-of-today columns (next twelve months and
 * what is left after them), whatever period is selected. An account with no balance at either end and no entry in the
 * period is left out.
 */
export function debtAccounts(ledger: Ledger, period: ResolvedPeriod, today: string, repayments: DebtRepayments, schedules: readonly ScheduleInput[]): DebtAccountRow[] {
  const scheduleOf = new Map(schedules.map((s) => [s.accountId, s]));
  const principalOf = new Map(repayments.rows.map((r) => [r.accountId, r]));
  const startMonth = addMonths(period.startMonth, -1);
  const active = new Set<string>();
  for (const row of ledger.facts.movement) if (row.month >= period.startMonth && row.month <= period.endMonth) active.add(row.accountId);
  for (const row of ledger.facts.startingBalances) if (row.month >= period.startMonth && row.month <= period.endMonth) active.add(row.accountId);
  const todayMonth = today.slice(0, 7);

  const rows: DebtAccountRow[] = [];
  for (const account of ledger.account.values()) {
    const group = GROUP_OF[account.accountClass as keyof typeof GROUP_OF];
    if (!group) continue;
    const start = ownedPositive(ledger.balanceAt(account.id, startMonth));
    const end = ownedPositive(ledger.balanceAt(account.id, period.endMonth));
    if (start === 0 && end === 0 && !active.has(account.id)) continue;
    const loan = group === "loans";
    const repaid = principalOf.get(account.id);
    let next12: NextTwelve | null = null;
    if (loan) {
      const schedule = scheduleOf.get(account.id);
      if (!schedule) next12 = { state: "notScheduled" };
      else if (schedule.state === "unavailable") next12 = { state: "review", reason: schedule.reason };
      else next12 = { state: "scheduled", principalMinor: schedule.principalNext12Minor, costMinor: schedule.costNext12Minor, laterMinor: Math.max(0, ownedPositive(ledger.balanceAt(account.id, todayMonth)) - schedule.principalNext12Minor) };
    }
    rows.push({
      accountId: account.id, name: account.name, group, startMinor: start, endMinor: end, changeMinor: end - start,
      principalRepaidMinor: loan ? (repaid?.principalMinor ?? 0) : null,
      movedFromDebtsMinor: loan ? (repaid?.movedFromDebtsMinor ?? 0) : null,
      next12,
    });
  }
  const order = new Map(DEBT_GROUPS.map((g, i) => [g.key, i]));
  return rows.sort((a, b) => (order.get(a.group)! - order.get(b.group)!) || b.endMinor - a.endMinor || a.name.localeCompare(b.name));
}

/** The totals of some rows (a group, or all of them). The next twelve months add only the loans that have a figure. */
export function debtTotals(rows: readonly DebtAccountRow[]): DebtTotals {
  const t: DebtTotals = { startMinor: 0, endMinor: 0, changeMinor: 0, principalRepaidMinor: 0, scheduledLoans: 0, loans: 0, principalNext12Minor: 0, costNext12Minor: 0 };
  for (const r of rows) {
    t.startMinor += r.startMinor; t.endMinor += r.endMinor; t.changeMinor += r.changeMinor;
    if (r.group === "loans") {
      t.loans += 1;
      t.principalRepaidMinor += r.principalRepaidMinor ?? 0;
      if (r.next12?.state === "scheduled") { t.scheduledLoans += 1; t.principalNext12Minor += r.next12.principalMinor; t.costNext12Minor += r.next12.costMinor; }
    }
  }
  return t;
}

export type DebtMonth = {
  month: string;
  /** False for a month before the budget has any movement: nothing is drawn, not a zero. */
  hasData: boolean;
  partial: boolean;
  /** Paid into loan accounts from accounts that are not debts, and moved in from other debts. */
  paidInMinor: number;
  movedFromDebtsMinor: number;
  /** How far the debt fell: paid in less what the lender charged. Negative when more was charged than paid. */
  principalMinor: number;
  /** Recorded interest and fees of tracked loans only (split lines and lender charges); an untracked loan's cannot be told from other spending. */
  interestMinor: number;
  feesMinor: number;
};

/** The same facts as `debtRepayments` (one shared reading, `loanEntries`), month by month: the months add up to its totals. */
export function debtMonthly(ledger: Ledger, period: ResolvedPeriod): DebtMonth[] {
  const figures = new Map(period.months.map((month): [string, LoanFigures] => [month, emptyLoanFigures()]));
  // A loan's principal is paid in less its charges, so the months are summed per loan and added up, not mixed across loans.
  const perLoan = new Map<string, Map<string, LoanFigures>>();
  for (const e of loanEntries(ledger)) {
    if (!figures.has(e.month)) continue;
    const months = perLoan.get(e.accountId) ?? new Map<string, LoanFigures>();
    const f = months.get(e.month) ?? emptyLoanFigures();
    addLoanEntry(f, e.field, e.amountMinor);
    months.set(e.month, f);
    perLoan.set(e.accountId, months);
  }
  return period.months.map((month, i): DebtMonth => {
    const sum = emptyLoanFigures();
    for (const months of perLoan.values()) {
      const f = months.get(month);
      if (!f) continue;
      for (const k of Object.keys(sum) as (keyof LoanFigures)[]) sum[k] += f[k];
    }
    return {
      month, hasData: !!ledger.firstMonth && month >= ledger.firstMonth, partial: period.partial && i === period.months.length - 1,
      paidInMinor: sum.paidIn, movedFromDebtsMinor: sum.movedFromDebts, principalMinor: sum.principalMinor, interestMinor: sum.interestMinor, feesMinor: sum.feesMinor,
    };
  });
}

export type CardSeries = { accountId: string; name: string; /** What is owed at each month end (positive), null before the budget began. */ values: (number | null)[] };

export type CardMonths = {
  months: string[];
  hasData: boolean[];
  partial: number | null;
  /** The cards, largest balance at the end of the period first. */
  cards: CardSeries[];
  /** What is owed on all cards at each month end. */
  totals: (number | null)[];
};

/** Credit cards, month by month, from the facts the page already holds: the balance at each month end (the same balances as the table). */
export function cardMonthly(ledger: Ledger, period: ResolvedPeriod): CardMonths {
  const cards = [...ledger.account.values()].filter((a) => a.accountClass === "credit-card");
  const hasData = period.months.map((m) => !!ledger.firstMonth && m >= ledger.firstMonth);
  const series = cards.map((c) => ({ accountId: c.id, name: c.name, values: period.months.map((m, i) => (hasData[i] ? 0 - ledger.balanceAt(c.id, m) : null)) }));
  const end = (s: CardSeries) => s.values[s.values.length - 1] ?? 0;
  series.sort((a, b) => end(b) - end(a) || a.name.localeCompare(b.name));
  const totals = period.months.map((_, i) => (hasData[i] ? series.reduce((a, s) => a + (s.values[i] ?? 0), 0) : null));
  return { months: period.months, hasData, partial: period.partial ? period.months.length - 1 : null, cards: series, totals };
}

/** The categories the Credit Cards module maps to a card's interest and fees (its own settings). */
export type CardCategories = { accountId: string; interestCategoryId: string | null; feeCategoryId: string | null };

export type CardCosts = {
  months: string[];
  hasData: boolean[];
  partial: number | null;
  /** Interest and fees charged on the mapped cards in each month, refunds netted (positive when more was charged). */
  interest: number[];
  fees: number[];
  /** The cards whose interest or fee category is mapped, and the ones with neither, which cannot be told from other spending. */
  identified: { accountId: string; name: string; interestCategoryId: string | null; feeCategoryId: string | null }[];
  notIdentified: { accountId: string; name: string }[];
};

/**
 * Interest and fees charged to the credit cards, by month: the entries in a card's account with the category the Credit Cards
 * module maps to that card's interest or fees. A card with neither mapped is listed as not identified, never guessed.
 */
export function cardCosts(ledger: Ledger, period: ResolvedPeriod, settings: readonly CardCategories[]): CardCosts {
  const index = new Map(period.months.map((m, i) => [m, i]));
  const hasData = period.months.map((m) => !!ledger.firstMonth && m >= ledger.firstMonth);
  const by = new Map(settings.map((s) => [s.accountId, s]));
  const identified: CardCosts["identified"] = [], notIdentified: CardCosts["notIdentified"] = [];
  for (const a of ledger.account.values()) {
    if (a.accountClass !== "credit-card") continue;
    const s = by.get(a.id);
    if (s && (s.interestCategoryId || s.feeCategoryId)) identified.push({ accountId: a.id, name: a.name, interestCategoryId: s.interestCategoryId, feeCategoryId: s.feeCategoryId });
    else notIdentified.push({ accountId: a.id, name: a.name });
  }
  const interest = period.months.map(() => 0), fees = period.months.map(() => 0);
  const mapped = new Map(identified.map((c) => [c.accountId, c]));
  for (const r of ledger.facts.movement) {
    const i = index.get(r.month), card = mapped.get(r.accountId);
    if (i === undefined || !card || r.transferAccountId || r.categoryId === null) continue;
    if (r.categoryId === card.interestCategoryId) interest[i] -= r.amountMinor;
    else if (r.categoryId === card.feeCategoryId) fees[i] -= r.amountMinor;
  }
  return { months: period.months, hasData, partial: period.partial ? period.months.length - 1 : null, interest, fees, identified, notIdentified };
}
