import type { BufferLoan, CashBuffer, Status } from "./measures";

/**
 * Cash buffer scenarios: "what would my buffer be if ...". A scenario leaves categories and loans out of the monthly need and
 * can replace what each one costs per month. It starts from the real buffer (`cashBuffer`) and never changes it, so a scenario
 * with no adjustments always equals the real figure. Pure: no I/O. Amounts are integer minor units per month.
 */

/** The key of the spending that has no category, which has no id of its own. */
export const UNCATEGORIZED_KEY = "__uncategorized";

/** What the cash buffer's average monthly spending is made of: one category and what it averages per month over the same months. */
export type BufferCategoryRow = { id: string | null; name: string; group: string; hidden: boolean; avgMinor: number; /** Position in the budget (groups in Actual's order, then their categories); spending with no category has none. */ order?: number; /** What the category came to over all the months a typical month is taken over (positive is spent): the figure its transactions add up to. */ totalMinor?: number; /** What a typical month of it holds of the interest and fees of tracked loans: counted in the loan repayments, so it is not in `avgMinor`. */ loanInterestMinor?: number };

/**
 * What the user chose for the cash buffer of one budget: the months of cover they aim for, and how a typical month is worked out
 * (the average or the median of the last 3, 6 or 12 complete months). It applies to the real buffer and to every scenario.
 */
export type BufferSettings = { goalMonths: number | null; averageMonths: 3 | 6 | 12; method: "average" | "median" };
export const DEFAULT_BUFFER_SETTINGS: BufferSettings = { goalMonths: null, averageMonths: 12, method: "average" };
export const AVERAGE_MONTH_CHOICES = [3, 6, 12] as const;
export const GOAL_MONTHS_MAX = 120;

/** Settings in the expected shape, or null. */
export function parseBufferSettings(input: unknown): BufferSettings | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const goal = o.goalMonths;
  if (goal !== null && !(typeof goal === "number" && Number.isInteger(goal) && goal >= 1 && goal <= GOAL_MONTHS_MAX)) return null;
  if (o.averageMonths !== 3 && o.averageMonths !== 6 && o.averageMonths !== 12) return null;
  if (o.method !== "average" && o.method !== "median") return null;
  return { goalMonths: goal, averageMonths: o.averageMonths, method: o.method };
}

/** The middle value of a list (the mean of the two in the middle when there is an even number); zero for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type BufferAdjustments = {
  /** Categories left out of the monthly need (`UNCATEGORIZED_KEY` for spending with no category). */
  excluded: string[];
  /** A monthly amount that replaces a category's typical one. */
  amounts: Record<string, number>;
  /** Loan accounts left out, and a monthly repayment that replaces a loan's. */
  loansExcluded: string[];
  loanAmounts: Record<string, number>;
};

export const NO_ADJUSTMENTS: BufferAdjustments = { excluded: [], amounts: {}, loansExcluded: [], loanAmounts: {} };

/** What a scenario came to when it was saved, so it can be set beside what it is now. */
export type ScenarioResult = { months: number; cashMinor: number; monthlyNeedMinor: number; actualMonths: number; at: string };

export const categoryKey = (row: Pick<BufferCategoryRow, "id">): string => row.id ?? UNCATEGORIZED_KEY;

const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isKeyList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 2000 && v.every((k) => typeof k === "string" && k.length > 0 && k.length <= 200);
const isAmounts = (v: unknown): v is Record<string, number> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length <= 2000 && Object.entries(v).every(([k, n]) => k.length > 0 && k.length <= 200 && isAmount(n));

/** The adjustments as stored, or null when they are not in the expected shape (so nothing malformed is ever applied). */
export function parseAdjustments(input: unknown): BufferAdjustments | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (!isKeyList(o.excluded) || !isAmounts(o.amounts) || !isKeyList(o.loansExcluded) || !isAmounts(o.loanAmounts)) return null;
  return { excluded: [...new Set(o.excluded)], amounts: { ...o.amounts }, loansExcluded: [...new Set(o.loansExcluded)], loanAmounts: { ...o.loanAmounts } };
}

/** A saved result in the expected shape, or null. */
export function parseScenarioResult(input: unknown): ScenarioResult | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!finite(o.months) || !finite(o.cashMinor) || !finite(o.monthlyNeedMinor) || !finite(o.actualMonths) || typeof o.at !== "string") return null;
  return { months: o.months, cashMinor: o.cashMinor, monthlyNeedMinor: o.monthlyNeedMinor, actualMonths: o.actualMonths, at: o.at };
}

export type AdjustedLoan = BufferLoan & { typicalMinor: number; included: boolean };

export type AdjustedBuffer = {
  months: number;
  cashMinor: number;
  monthlyNeedMinor: number;
  /** Spending per month in the scenario, including what no category row holds (loan interest taken out, rounding). */
  spendingMinor: number;
  loans: AdjustedLoan[];
  /** How many categories and loans are left out or have another amount. */
  leftOut: number;
  edited: number;
};

/** What the rows do not hold: the interest and fees of tracked loans taken out of spending, and rounding. It is always kept. */
export const fixedSpending = (buffer: CashBuffer, rows: readonly BufferCategoryRow[]): number => buffer.spendingMinor - rows.reduce((a, r) => a + r.avgMinor, 0);

/** The amount a category counts for in a scenario: nothing when it is left out, the replacement when there is one, else its typical amount. */
export function scenarioAmount(row: BufferCategoryRow, a: BufferAdjustments): number {
  const key = categoryKey(row);
  if (a.excluded.includes(key)) return 0;
  return a.amounts[key] ?? row.avgMinor;
}

/** The cash buffer for a scenario, from the real buffer's cash and loans and the categories' typical amounts. */
export function adjustedBuffer(buffer: CashBuffer, rows: readonly BufferCategoryRow[], a: BufferAdjustments): Status<AdjustedBuffer> {
  const spendingMinor = fixedSpending(buffer, rows) + rows.reduce((sum, r) => sum + scenarioAmount(r, a), 0);
  const loans: AdjustedLoan[] = buffer.loans.map((l) => {
    const included = !a.loansExcluded.includes(l.accountId);
    return { ...l, typicalMinor: l.monthlyMinor, included, monthlyMinor: included ? a.loanAmounts[l.accountId] ?? l.monthlyMinor : 0 };
  });
  const monthlyNeedMinor = spendingMinor + loans.reduce((sum, l) => sum + l.monthlyMinor, 0);
  if (monthlyNeedMinor <= 0) return { state: "unavailable", reason: "Nothing is left to spend in this scenario, so the cover has no end" };
  const leftOut = rows.filter((r) => a.excluded.includes(categoryKey(r))).length + loans.filter((l) => !l.included).length;
  const edited =
    rows.filter((r) => !a.excluded.includes(categoryKey(r)) && a.amounts[categoryKey(r)] !== undefined && a.amounts[categoryKey(r)] !== r.avgMinor).length +
    loans.filter((l) => l.included && a.loanAmounts[l.accountId] !== undefined && a.loanAmounts[l.accountId] !== l.typicalMinor).length;
  return { state: "ready", value: { months: buffer.cashMinor / monthlyNeedMinor, cashMinor: buffer.cashMinor, monthlyNeedMinor, spendingMinor, loans, leftOut, edited } };
}

/** The adjustments without the entries that say nothing (an amount equal to the typical one, an amount for a category left out). */
export function tidyAdjustments(rows: readonly BufferCategoryRow[], loans: readonly BufferLoan[], a: BufferAdjustments): BufferAdjustments {
  const keys = new Set(rows.map(categoryKey));
  const typical = new Map(rows.map((r) => [categoryKey(r), r.avgMinor]));
  const loanIds = new Set(loans.map((l) => l.accountId));
  const loanTypical = new Map(loans.map((l) => [l.accountId, l.monthlyMinor]));
  const excluded = a.excluded.filter((k) => keys.has(k));
  const amounts = Object.fromEntries(Object.entries(a.amounts).filter(([k, v]) => keys.has(k) && !excluded.includes(k) && v !== typical.get(k)));
  const loansExcluded = a.loansExcluded.filter((id) => loanIds.has(id));
  const loanAmounts = Object.fromEntries(Object.entries(a.loanAmounts).filter(([id, v]) => loanIds.has(id) && !loansExcluded.includes(id) && v !== loanTypical.get(id)));
  return { excluded, amounts, loansExcluded, loanAmounts };
}

export const isUnadjusted = (a: BufferAdjustments): boolean => a.excluded.length === 0 && a.loansExcluded.length === 0 && Object.keys(a.amounts).length === 0 && Object.keys(a.loanAmounts).length === 0;
