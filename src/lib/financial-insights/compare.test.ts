import { buildLedger, type AccountFact, type FinancialFacts, type MovementRow } from "./measures";
import { comparePeriods, percentChange } from "./compare";
import { resolvePeriod } from "./period";

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const row = (month: string, amountMinor: number, categoryId: string): MovementRow => ({ month, accountId: "chk", categoryId, transferAccountId: null, amountMinor, count: 1 });
const today = "2026-11-18";
const months = (from: string, count: number) => { const [y, m] = from.split("-").map(Number); return Array.from({ length: count }, (_, i) => { const t = y * 12 + (m - 1) + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }); };

function ledgerFrom(first: string, count: number, pay: (m: string) => number) {
  const movement = months(first, count).flatMap((m) => [row(m, pay(m), "pay"), row(m, -20_000, "food")]);
  const f: FinancialFacts = { accounts: [chk], incomeCategories: new Set(["pay"]), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: [], reclassified: [], loanCosts: [] };
  return buildLedger(f);
}

describe("comparing a period with the one before it", () => {
  it("sets whole months against the same number just before, and leaves the running month out of both", () => {
    const ledger = ledgerFrom("2025-01", 23, (m) => (m >= "2026-01" ? 60_000 : 50_000)); // Jan 2025 .. Nov 2026
    const period = resolvePeriod({ kind: "custom", startMonth: "2026-01", endMonth: "2026-11" }, today, ledger.firstMonth);
    expect(period.partial).toBe(true);
    const c = comparePeriods(ledger, period, today)!;
    expect(c.months).toBe(10);
    expect(c.label).toBe("the 10 months before");
    expect(c.current).toEqual({ received: 600_000, spent: 200_000, kept: 400_000 });
    expect(c.previous).toEqual({ received: 500_000, spent: 200_000, kept: 300_000 });
  });

  it("says the previous month for a single month", () => {
    const ledger = ledgerFrom("2026-01", 10, () => 50_000);
    const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, today, ledger.firstMonth);
    expect(comparePeriods(ledger, period, today)!.label).toBe("the previous month");
  });

  it("offers no comparison when the budget has no data back to the start of the earlier stretch", () => {
    const ledger = ledgerFrom("2026-03", 8, () => 50_000);
    const period = resolvePeriod({ kind: "custom", startMonth: "2026-01", endMonth: "2026-10" }, today, ledger.firstMonth);
    expect(comparePeriods(ledger, period, today)).toBeNull();
    const short = resolvePeriod({ kind: "custom", startMonth: "2026-06", endMonth: "2026-10" }, today, ledger.firstMonth);
    expect(comparePeriods(ledger, short, today)).toBeNull();
  });

  it("offers none for a period that is only the month still running", () => {
    const ledger = ledgerFrom("2025-01", 23, () => 50_000);
    const period = resolvePeriod({ kind: "custom", startMonth: "2026-11", endMonth: "2026-11" }, today, ledger.firstMonth);
    expect(comparePeriods(ledger, period, today)).toBeNull();
  });

  it("states a change in percent, and none against nothing", () => {
    expect(percentChange(660, 600)).toBe(10);
    expect(percentChange(450, 600)).toBe(-25);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(-50, -100)).toBe(50);
  });
});
