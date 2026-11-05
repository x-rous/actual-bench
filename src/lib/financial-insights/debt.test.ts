import { debtRepayments } from "./breakdowns";
import { cardCosts, cardMonthly, debtAccounts, debtMonthly, debtTotals, type ScheduleInput } from "./debt";
import { drillScope } from "./drill";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type LoanCostRow, type MovementRow } from "./measures";
import { resolvePeriod, type PeriodChoice } from "./period";

const today = "2026-11-18";
const accounts: AccountFact[] = [
  { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
  { id: "visa", name: "Visa", accountClass: "credit-card", treatment: null, offBudget: false },
  { id: "mortgage", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true },
  { id: "car", name: "Car loan", accountClass: "loan", treatment: null, offBudget: true },
  { id: "van", name: "Van loan", accountClass: "loan", treatment: null, offBudget: true },
  { id: "old", name: "Old loan", accountClass: "loan", treatment: null, offBudget: true },
  { id: "tax", name: "Tax bill", accountClass: "other-liability", treatment: "current-liability", offBudget: true },
];
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });
const both = (month: string, from: string, to: string, amount: number): MovementRow[] => [row(month, from, -amount, { transferAccountId: to }), row(month, to, amount, { transferAccountId: from })];
const start = (accountId: string, amountMinor: number, month = "2026-01") => ({ month, accountId, amountMinor });

/** A mortgage (tracked), a car loan (not tracked) and a van loan (tracked, its schedule does not reconcile), an old loan paid off, a card and a tax bill. */
function facts(extra: Partial<FinancialFacts> = {}): FinancialFacts {
  const movement = [
    row("2026-01", "chk", 900_000),
    ...both("2026-09", "chk", "mortgage", 70_000), ...both("2026-10", "chk", "mortgage", 71_000), ...both("2026-10", "chk", "car", 30_000),
    // A card purchase and a payment of the card from checking, which is not a loan.
    row("2026-10", "visa", -45_000, { categoryId: "food" }), ...both("2026-10", "chk", "visa", 20_000),
    // An older loan, paid off before the period, and a payment with an excluded account.
    ...both("2026-03", "chk", "old", 50_000),
    ...both("2026-10", "xcl", "car", 9_000),
  ];
  const transfersIn = movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! }));
  const costs: LoanCostRow[] = [
    { id: "i1", month: "2026-09", accountId: "chk", categoryId: "interest", amountMinor: -12_000, loanAccountId: "mortgage", kind: "interest" },
    { id: "i2", month: "2026-10", accountId: "chk", categoryId: "interest", amountMinor: -11_500, loanAccountId: "mortgage", kind: "interest" },
    { id: "f1", month: "2026-10", accountId: "chk", categoryId: "fee", amountMinor: -500, loanAccountId: "mortgage", kind: "fee" },
  ];
  return {
    accounts, incomeCategories: new Set(), excluded: new Set(["xcl"]), movement, uncategorizedIn: [], transfersIn, reclassified: [], loanCosts: costs,
    startingBalances: [start("mortgage", -20_000_000), start("car", -1_000_000), start("van", -400_000), start("old", -50_000), start("tax", -15_000)],
    ...extra,
  };
}
const choice = (startMonth: string, endMonth: string): PeriodChoice => ({ kind: "custom", startMonth, endMonth });
const setup = (f = facts(), c = choice("2026-09", "2026-10")) => { const ledger = buildLedger(f); return { ledger, period: resolvePeriod(c, today, ledger.firstMonth) }; };
const repayments = (ledger: ReturnType<typeof setup>["ledger"], period: ReturnType<typeof setup>["period"], tracked = ["mortgage"]) => debtRepayments(ledger, period, new Set(tracked), 0);
const schedule: ScheduleInput[] = [{ accountId: "mortgage", state: "ready", principalNext12Minor: 900_000, costNext12Minor: 150_000 }];

describe("financial insights: loans and cards", () => {
  it("lists every liability account once, and their balances add up to Summary's liabilities", () => {
    const { ledger, period } = setup();
    const rows = debtAccounts(ledger, period, today, repayments(ledger, period), schedule);
    const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0 });
    expect(rows.map((r) => r.accountId)).toEqual(["mortgage", "car", "van", "visa", "tax"]); // the loan paid off in March has nothing in the period
    expect(new Set(rows.map((r) => r.accountId)).size).toBe(rows.length);
    const totals = debtTotals(rows);
    expect(totals.endMinor).toBe(summary.liabilities);
    expect(totals.startMinor).toBe(0 - (summary.opening.loans + summary.opening.cards + summary.opening.otherLiabilities));
    expect(totals.changeMinor).toBe(totals.endMinor - totals.startMinor);
    expect(rows.find((r) => r.accountId === "mortgage")).toMatchObject({ startMinor: 20_000_000, endMinor: 20_000_000 - 141_000, changeMinor: -141_000 });
    expect(rows.find((r) => r.accountId === "tax")).toMatchObject({ endMinor: 15_000, principalRepaidMinor: null, next12: null });
  });

  it("takes principal from the Loan repayments card, leaving out a payment from an excluded account", () => {
    const { ledger, period } = setup();
    const repaid = repayments(ledger, period);
    const rows = debtAccounts(ledger, period, today, repaid, schedule);
    expect(rows.find((r) => r.accountId === "car")?.principalRepaidMinor).toBe(30_000);
    expect(debtTotals(rows).principalRepaidMinor).toBe(repaid.principalMinor);
    expect(repaid.principalMinor).toBe(171_000);
  });

  it("adds the monthly series up to the Loan repayments totals, with interest and fees only for tracked loans", () => {
    const { ledger, period } = setup();
    const repaid = repayments(ledger, period);
    const months = debtMonthly(ledger, period);
    expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    const sum = (pick: (m: (typeof months)[number]) => number) => months.reduce((a, m) => a + pick(m), 0);
    expect(sum((m) => m.principalMinor)).toBe(repaid.principalMinor);
    expect(sum((m) => m.interestMinor)).toBe(repaid.interestMinor);
    expect(sum((m) => m.feesMinor)).toBe(repaid.feesMinor);
    expect(months[1]).toMatchObject({ principalMinor: 101_000, interestMinor: 11_500, feesMinor: 500 });
    // The untracked car loan adds principal but no interest or fees; a month before the budget began has no data.
    const early = debtMonthly(ledger, resolvePeriod(choice("2025-11", "2026-01"), today, ledger.firstMonth));
    expect(early.map((m) => m.hasData)).toEqual([false, false, true]);
  });

  it("shows next 12 months and later for a scheduled loan, 'Not scheduled' for an untracked one and the reason for one to review", () => {
    const { ledger, period } = setup();
    const rows = debtAccounts(ledger, period, today, repayments(ledger, period), [...schedule, { accountId: "van", state: "unavailable", reason: "Its schedule does not agree with the loan account in Actual; review it in Loans" }]);
    const owedToday = 20_000_000 - 141_000;
    expect(rows.find((r) => r.accountId === "mortgage")?.next12).toEqual({ state: "scheduled", principalMinor: 900_000, costMinor: 150_000, laterMinor: owedToday - 900_000 });
    expect(rows.find((r) => r.accountId === "car")?.next12).toEqual({ state: "notScheduled" });
    expect(rows.find((r) => r.accountId === "van")?.next12).toEqual({ state: "review", reason: expect.stringContaining("review it in Loans") });
    const totals = debtTotals(rows);
    // Only the loans that have a figure are added, and the total says how many that is.
    expect(totals).toMatchObject({ loans: 3, scheduledLoans: 1, principalNext12Minor: 900_000, costNext12Minor: 150_000 });
  });

  it("measures the next twelve months and what follows against today, not the end of a past period, and never goes below zero", () => {
    const { ledger, period } = setup(facts(), choice("2026-09", "2026-09"));
    const rows = debtAccounts(ledger, period, today, repayments(ledger, period), [{ accountId: "mortgage", state: "ready", principalNext12Minor: 99_999_999, costNext12Minor: 1 }]);
    const mortgage = rows.find((r) => r.accountId === "mortgage")!;
    expect(mortgage.endMinor).toBe(20_000_000 - 70_000);
    expect(mortgage.next12).toMatchObject({ state: "scheduled", laterMinor: 0 });
    const normal = debtAccounts(ledger, period, today, repayments(ledger, period), schedule).find((r) => r.accountId === "mortgage")!;
    expect(normal.next12).toMatchObject({ laterMinor: 20_000_000 - 141_000 - 900_000 });
  });

  it("hides an account with no balance and no activity, and keeps one that was paid off in the period", () => {
    const f = facts();
    const { ledger, period } = setup(f, choice("2026-10", "2026-10"));
    // "old" was paid off in March: nothing owed at either end of October and no entry in it.
    const rows = debtAccounts(ledger, period, today, repayments(ledger, period), schedule);
    expect(rows.map((r) => r.accountId)).toEqual(["mortgage", "car", "van", "visa", "tax"]);
    const wide = setup(f, choice("2026-03", "2026-10"));
    expect(debtAccounts(wide.ledger, wide.period, today, repayments(wide.ledger, wide.period), schedule).map((r) => r.accountId)).toContain("old");
  });
});

describe("financial insights: loan drilldown scopes", () => {
  it("lists principal, interest and fees with the figures they sit on", () => {
    const { ledger, period } = setup();
    const repaid = repayments(ledger, period);
    const ctx = { ledger, period, today, reclassifiedIds: new Set<string>() };
    expect(drillScope({ kind: "loanPrincipal" }, ctx).expectedMinor).toBe(repaid.principalMinor);
    expect(drillScope({ kind: "loanPrincipal", accountId: "car" }, ctx)).toMatchObject({ expectedMinor: 30_000, constraints: { amountSign: "positive" } });
    expect(drillScope({ kind: "loanPrincipal", month: "2026-10" }, ctx).expectedMinor).toBe(101_000);
    // Interest and fees are the expense lines (negative as listed); the figure on the page is their opposite.
    expect(drillScope({ kind: "loanInterest" }, ctx).expectedMinor).toBe(0 - repaid.interestMinor);
    expect(drillScope({ kind: "loanFees", accountId: "mortgage" }, ctx).expectedMinor).toBe(0 - repaid.feesMinor);
    expect(drillScope({ kind: "loanInterest", accountId: "car" }, ctx).expectedMinor).toBe(0);
  });
});

describe("financial insights: credit cards by month", () => {
  it("shows what is owed on each card at every month end, equal to the table", () => {
    const { ledger, period } = setup();
    const c = cardMonthly(ledger, period);
    expect(c.months).toEqual(["2026-09", "2026-10"]);
    expect(c.cards.map((x) => [x.accountId, x.values])).toEqual([["visa", [0, 25_000]]]);
    expect(c.totals).toEqual([0, 25_000]);
    const rows = debtAccounts(ledger, period, today, repayments(ledger, period), schedule);
    expect(c.totals.at(-1)).toBe(debtTotals(rows.filter((r) => r.group === "cards")).endMinor);
  });

  it("has no data before the budget began", () => {
    const { ledger } = setup();
    const early = cardMonthly(ledger, resolvePeriod(choice("2025-11", "2026-01"), today, ledger.firstMonth));
    expect(early.hasData).toEqual([false, false, true]);
    expect(early.totals.slice(0, 2)).toEqual([null, null]);
  });
});

describe("financial insights: credit card interest and fees", () => {
  const cardsFacts = () => {
    const f = facts();
    return facts({
      accounts: [...f.accounts, { id: "amex", name: "Amex", accountClass: "credit-card", treatment: null, offBudget: false }],
      movement: [...f.movement,
        row("2026-09", "visa", -1_000, { categoryId: "int" }), row("2026-10", "visa", -1_200, { categoryId: "int" }), row("2026-10", "visa", -300, { categoryId: "fee" }), row("2026-10", "visa", 100, { categoryId: "fee" }),
        // The same category in another account, a transfer carrying it, and a card with nothing mapped: none of them is a card cost.
        row("2026-10", "chk", -7_000, { categoryId: "int" }), row("2026-10", "visa", -900, { categoryId: "int", transferAccountId: "chk" }), row("2026-10", "amex", -500, { categoryId: "int" })],
    });
  };
  const settings = [{ accountId: "visa", interestCategoryId: "int", feeCategoryId: "fee" }];

  it("counts the entries in a card's account with the category mapped to that card, refunds netted", () => {
    const { ledger, period } = setup(cardsFacts());
    const c = cardCosts(ledger, period, settings);
    expect(c.interest).toEqual([1_000, 1_200]);
    expect(c.fees).toEqual([0, 200]);
    expect(c.identified.map((x) => x.accountId)).toEqual(["visa"]);
  });

  it("lists a card with no mapped category as not identified instead of guessing", () => {
    const { ledger, period } = setup(cardsFacts());
    expect(cardCosts(ledger, period, settings).notIdentified.map((x) => x.accountId)).toEqual(["amex"]);
    expect(cardCosts(ledger, period, []).identified).toEqual([]);
    expect(cardCosts(ledger, period, [{ accountId: "visa", interestCategoryId: null, feeCategoryId: null }]).notIdentified.map((x) => x.accountId)).toEqual(["visa", "amex"]);
  });

  it("opens the interest of the cards only, adding up to the figure", () => {
    const { ledger, period } = setup(cardsFacts());
    const scope = drillScope({ kind: "category", categoryIds: ["int"], pairs: [{ accountId: "visa", categoryId: "int" }], name: "Credit card interest", amountMinor: 2_200 }, { ledger, period, today, reclassifiedIds: new Set<string>() });
    expect(scope.expectedMinor).toBe(-2_200);
    expect(JSON.stringify(scope.constraints.where)).toBe('{"$or":[{"$and":[{"account":{"$oneof":["visa"]}},{"category":{"$oneof":["int"]}}]}]}');
  });

  it("pairs each card with its own category, so a category shared by another card is not matched", () => {
    const { ledger, period } = setup(cardsFacts());
    const scope = drillScope({ kind: "category", categoryIds: ["x", "y"], pairs: [{ accountId: "a", categoryId: "x" }, { accountId: "b", categoryId: "y" }], name: "Credit card interest", amountMinor: 0 }, { ledger, period, today, reclassifiedIds: new Set<string>() });
    const where = JSON.stringify(scope.constraints.where);
    expect(where).toContain('{"$and":[{"account":{"$oneof":["a"]}},{"category":{"$oneof":["x"]}}]}');
    expect(where).toContain('{"$and":[{"account":{"$oneof":["b"]}},{"category":{"$oneof":["y"]}}]}');
  });
});
