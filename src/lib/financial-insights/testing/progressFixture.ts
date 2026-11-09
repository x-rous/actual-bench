import { compositionSeries, monthlyFlows } from "../breakdowns";
import { buildLedger, cashBuffer, summarize, type AccountFact, type FinancialFacts, type LoanScheduleInput, type MovementRow } from "../measures";
import { resolvePeriod } from "../period";
import type { ProgressInput } from "../progress";
import type { EquityPoint, LinkedEquitySeries } from "../wealth";

/** Test fixtures for the Progress tab: a household with distinctive names and amounts, none of which may reach a `ProgressView`. */

export const today = "2026-11-18";

// Distinctive names and amounts: none of them may appear anywhere in a ProgressView.
export const NAMES = ["Zephyr Checking", "Orchid Visa", "Basil Mortgage", "Quartz Hatchback loan", "Maple Cottage"];
export const AMOUNTS_MINOR = [98_765_432, 12_345_789, 4_567_891, 5_432_109];
export const AMOUNTS_TEXT = ["987654.32", "987,654.32", "123457.89", "123,457.89", "45678.91", "45,678.91", "98765", "987654", "12345", "123457"];

export const chk: AccountFact = { id: "chk", name: NAMES[0], accountClass: "bank", treatment: null, offBudget: false };
export const visa: AccountFact = { id: "visa", name: NAMES[1], accountClass: "credit-card", treatment: null, offBudget: false };
export const mortgage: AccountFact = { id: "mortgage", name: NAMES[2], accountClass: "loan", treatment: null, offBudget: true };
export const car: AccountFact = { id: "car", name: NAMES[3], accountClass: "loan", treatment: null, offBudget: true };

export const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });
export const pay = (month: string, from: string, to: string, amount: number): MovementRow[] => [row(month, from, -amount, { transferAccountId: to }), row(month, to, amount, { transferAccountId: from })];
export const months = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, "0")}`);

export function factsOf(accounts: AccountFact[], movement: MovementRow[], starting: { accountId: string; amountMinor: number }[] = []): FinancialFacts {
  return {
    accounts, incomeCategories: new Set(["salary"]), excluded: new Set(), movement, uncategorizedIn: [], reclassified: [], loanCosts: [],
    transfersIn: movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! })),
    startingBalances: starting.map((s) => ({ month: "2026-01", ...s })),
  };
}

export function inputOf(facts: FinancialFacts, over: Partial<ProgressInput> = {}, range: [string, string] = ["2026-01", "2026-10"]): ProgressInput {
  const ledger = buildLedger(facts);
  const period = resolvePeriod({ kind: "custom", startMonth: range[0], endMonth: range[1] }, today, ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
  return {
    today, period, ledger, summary, monthly: monthlyFlows(ledger, period, today, true), composition: compositionSeries(ledger, period, summary.opening),
    buffer: cashBuffer(ledger, today, new Map<string, LoanScheduleInput>(), {}), schedules: [], equity: [], allTime: false, ...over,
  };
}

/** Ten months: salary in, spending out (a loss in March), a card paid off in June, a loan paid off in April, a mortgage paid down. */
export function richFacts(): FinancialFacts {
  const movement: MovementRow[] = [];
  for (const m of months(1, 10)) {
    movement.push(row(m, "chk", 4_000_000, { categoryId: "salary" }), row(m, "chk", m === "2026-03" ? -4_500_000 : -3_000_000, { categoryId: "food" }));
    movement.push(...pay(m, "chk", "mortgage", 500_000));
  }
  for (const m of months(2, 6)) movement.push(...pay(m, "chk", "visa", 1_000_000));
  movement.push(...pay("2026-04", "chk", "car", 5_432_109));
  return factsOf([chk, visa, mortgage, car], movement, [
    { accountId: "chk", amountMinor: AMOUNTS_MINOR[0] }, { accountId: "mortgage", amountMinor: -AMOUNTS_MINOR[1] }, { accountId: "visa", amountMinor: -AMOUNTS_MINOR[2] }, { accountId: "car", amountMinor: -AMOUNTS_MINOR[3] },
  ]);
}

export const point = (value: number | null, debt: number | null, ltv: number | null): EquityPoint => ({ assetValueMinor: value, debtMinor: debt, equityMinor: value !== null && debt !== null ? value - debt : null, ltvPercent: ltv, gaps: [] });
export const home = (id: string, ltvs: (number | null)[], accountClass: LinkedEquitySeries["accountClass"] = "property"): LinkedEquitySeries => ({ assetId: id, accountId: `${id}-acct`, accountClass, points: ltvs.map((l) => point(l === null ? null : 54_321_098, l === null ? null : 30_000_000, l)) });

export const ltvTen = [72, 71, 70, 69, 68, 66, 64, 62, 61.4, 61.4];

