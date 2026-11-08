import { buildLedger, cashBuffer, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import type { CategoryInfo } from "@/lib/financial-insights/breakdowns";
import { adjustedBuffer, type BufferSettings } from "@/lib/financial-insights/bufferScenario";
import { bufferSpendingGroups } from "./useFinancialInsights";

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const spend = (month: string, categoryId: string, amountMinor: number): MovementRow => ({ month, accountId: "chk", categoryId, transferAccountId: null, amountMinor: -amountMinor, count: 1 });
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
// Food is 1,000 a month except one month of 7,000; rent is steady.
const movement = [...months.map((m, i) => spend(m, "food", i === 3 ? 7_000 : 1_000)), ...months.map((m) => spend(m, "rent", 5_000))];
const facts: FinancialFacts = { accounts: [chk], excluded: new Set(), incomeCategories: new Set(), movement, startingBalances: [], uncategorizedIn: [], transfersIn: [], reclassified: [], loanCosts: [] };
const ledger = buildLedger(facts);
const categories = new Map<string, CategoryInfo>([
  ["food", { id: "food", name: "Food", groupName: "Daily", hidden: false, isIncome: false, order: 100_001 }],
  ["rent", { id: "rent", name: "Rent", groupName: "Housing", hidden: false, isIncome: false, order: 0 }],
]);
const settings = (over: Partial<BufferSettings>): BufferSettings => ({ goalMonths: null, averageMonths: 12, method: "average", ...over });
const food = (r: ReturnType<typeof bufferSpendingGroups>) => r?.categories.find((c) => c.id === "food");

describe("the typical month behind the cash buffer", () => {
  it("is the average of the months, so a one-off month pulls it up", () => {
    const r = bufferSpendingGroups(ledger, "2026-11-18", categories, settings({}));
    expect(r?.months).toBe(6);
    expect(food(r)?.avgMinor).toBe(2_000); // (5 x 1,000 + 7,000) / 6
    expect(r?.spendingMinor).toBe(2_000 + 5_000);
  });

  it("is the middle month with the median, so the one-off does not move it", () => {
    const r = bufferSpendingGroups(ledger, "2026-11-18", categories, settings({ method: "median" }));
    expect(food(r)?.avgMinor).toBe(1_000);
    expect(r?.spendingMinor).toBe(6_000);
    expect(r?.groups.map((g) => [g.name, g.avgMinor])).toEqual([["Housing", 5_000], ["Daily", 1_000]]);
  });

  it("takes only the last 3 or 6 months when asked, and carries the order of the budget", () => {
    const r = bufferSpendingGroups(ledger, "2026-11-18", categories, settings({ averageMonths: 3 }));
    expect(r?.months).toBe(3);
    expect(food(r)?.avgMinor).toBe(3_000); // Aug (7,000) + Sep + Oct (1,000 each), over 3
    expect(r?.categories.map((c) => [c.name, c.order])).toEqual(expect.arrayContaining([["Rent", 0], ["Food", 100_001]]));
  });

  it("is unavailable with fewer than three complete months", () => {
    expect(bufferSpendingGroups(ledger, "2026-07-18", categories, settings({}))).toBeNull();
  });
});

describe("loan interest in the typical month", () => {
  // Rent 5,000 and food 1,000 a month, and a category of loan interest of 1,500 a month that the Loans tracking recorded: the loan's
  // repayment counts it, so the categories must not.
  const interest = (month: string): MovementRow => spend(month, "interest", 1_500);
  const withInterest: FinancialFacts = {
    accounts: [chk], excluded: new Set(), incomeCategories: new Set(),
    movement: [...months.map((m) => spend(m, "food", 1_000)), ...months.map((m) => spend(m, "rent", 5_000)), ...months.map(interest)],
    startingBalances: [{ month: "2026-04", accountId: "chk", amountMinor: 5_000_000 }], uncategorizedIn: [], transfersIn: [], reclassified: [],
    loanCosts: months.map((m) => ({ month: m, accountId: "chk", categoryId: "interest", amountMinor: -1_500, loanAccountId: "loan", kind: "interest" as const })),
  };
  const l = buildLedger(withInterest);
  const cats = new Map<string, CategoryInfo>([...categories, ["interest", { id: "interest", name: "Bank Loan Interest", groupName: "Debt", hidden: false, isIncome: false, order: 5 }]]);

  it("takes the loan interest out of its category, and does not list a category that was only loan interest", () => {
    const r = bufferSpendingGroups(l, "2026-11-18", cats, settings({}));
    expect(r?.categories.map((c) => c.name).sort()).toEqual(["Food", "Rent"]);
    expect(r?.spendingMinor).toBe(6_000);
    expect(r?.loanInterestMinor).toBe(1_500);
    expect(r?.groups.map((g) => g.name)).not.toContain("Debt");
  });

  it("keeps the part of a category that is not loan interest, and says how much was taken out", () => {
    const mixed: FinancialFacts = { ...withInterest, movement: [...withInterest.movement, ...months.map((m) => spend(m, "interest", 400))] };
    const r = bufferSpendingGroups(buildLedger(mixed), "2026-11-18", cats, settings({}));
    const row = r?.categories.find((c) => c.id === "interest");
    expect(row).toMatchObject({ avgMinor: 400, loanInterestMinor: 1_500, totalMinor: 6 * 1_900 });
  });

  it("agrees with the real cash buffer to the cent when nothing is adjusted, so nothing is counted twice or dropped", () => {
    const real = cashBuffer(l, "2026-11-18", new Map(), { months: 12 });
    const typical = bufferSpendingGroups(l, "2026-11-18", cats, settings({}));
    expect(real.state).toBe("ready");
    if (real.state !== "ready" || !typical) return;
    expect(real.value.spendingMinor).toBe(typical.spendingMinor);
    // Unticking the loan interest category (which is no longer listed) cannot lower it; unticking food lowers it by exactly food.
    const adjusted = adjustedBuffer(real.value, typical.categories, { excluded: ["food"], amounts: {}, loansExcluded: [], loanAmounts: {} });
    expect(adjusted.state === "ready" && adjusted.value.spendingMinor).toBe(real.value.spendingMinor - 1_000);
  });
});

describe("the typical month behind the cash buffer when a lender charges interest to the loan account", () => {
  const loan: AccountFact = { id: "loan", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true };
  const withCharge = (tagged: boolean) => {
    const charges: MovementRow[] = months.map((m) => ({ month: m, accountId: "loan", categoryId: null, transferAccountId: null, amountMinor: -20_000, count: 1 }));
    const tags = tagged ? months.map((m) => ({ id: `c-${m}`, month: m, accountId: "loan", categoryId: null, amountMinor: -20_000, loanAccountId: "loan", kind: "interest" as const, charged: true })) : [];
    return buildLedger({ ...facts, accounts: [chk, loan], movement: [...movement, ...charges], startingBalances: [{ month: "2026-04", accountId: "chk", amountMinor: 10_000_000 }, { month: "2026-04", accountId: "loan", amountMinor: -5_000_000 }], loanCosts: tags });
  };
  const schedules = new Map([["loan", { state: "ready" as const, monthlyMinor: 25_000 }]]);

  it("leaves the charge out of the spending average, because the scheduled repayment already holds it, and still adds up with the simulator", () => {
    const l = withCharge(true);
    const groups = bufferSpendingGroups(l, "2026-11-18", categories, settings({}));
    const buffer = cashBuffer(l, "2026-11-18", schedules);
    if (buffer.state !== "ready" || !groups) throw new Error("not ready");
    // The charge is in Spent, but not in the buffer's typical month: 2,000 food + 5,000 rent, the same as without it.
    expect(buffer.value.spendingMinor).toBe(7_000);
    expect(groups.spendingMinor).toBe(7_000);
    expect(groups.loanInterestMinor).toBe(20_000);
    expect(groups.categories.some((c) => c.name.includes("charged by lender"))).toBe(false);
    // A scenario with no adjustments is the real buffer.
    const sim = adjustedBuffer(buffer.value, groups.categories, { excluded: [], amounts: {}, loansExcluded: [], loanAmounts: {} });
    expect(sim.state === "ready" && sim.value.months).toBeCloseTo(buffer.value.months, 9);
    // And the buffer is the same as when the charge is not tagged (it was never in the spending categories).
    expect(cashBuffer(withCharge(false), "2026-11-18", schedules)).toEqual(buffer);
  });
});
