import { buildLedger, cashBuffer, summarize, type AccountFact, type AssetReview, type FinancialFacts, type LoanScheduleInput, type MovementRow, type Summary } from "./measures";
import { resolvePeriod, type PeriodChoice } from "./period";

const accounts: AccountFact[] = [
  { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
  { id: "sav", name: "Savings", accountClass: "bank", treatment: null, offBudget: true },
  { id: "fd", name: "Term deposit", accountClass: "bank", treatment: "fixed-deposit", offBudget: true },
  { id: "visa", name: "Visa", accountClass: "credit-card", treatment: null, offBudget: false },
  { id: "inv", name: "Brokerage", accountClass: "investment", treatment: "non-current-investment", offBudget: true },
  { id: "house", name: "House", accountClass: "property", treatment: null, offBudget: true },
  { id: "pass", name: "Pass-through", accountClass: "other-asset", treatment: "current-asset", offBudget: false },
  { id: "owed", name: "Owed to me", accountClass: "other-asset", treatment: "current-asset", offBudget: true },
  { id: "loan", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true },
];
const incomeCategories = new Set(["salary"]);
const none: AssetReview = { unavailableReason: null, rowCount: 0, amountMinor: 0 };

const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow =>
  ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });
/** Both sides of a transfer; `toMonth` lets the second side fall in another month. */
const transfer = (month: string, from: string, to: string, amount: number, toMonth = month): MovementRow[] => [
  row(month, from, -amount, { transferAccountId: to }),
  row(toMonth, to, amount, { transferAccountId: from }),
];

function facts(movement: MovementRow[], extra: Partial<FinancialFacts> = {}): FinancialFacts {
  return { accounts, incomeCategories, movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: [], reclassified: [], loanCosts: [], ...extra };
}
function run(f: FinancialFacts, choice: PeriodChoice, review = none, today = "2026-11-18"): Summary {
  const ledger = buildLedger(f);
  return summarize(ledger, resolvePeriod(choice, today, ledger.firstMonth), review);
}
const range = (startMonth: string, endMonth: string): PeriodChoice => ({ kind: "custom", startMonth, endMonth });
const sep = range("2026-09", "2026-09");
const value = <T>(s: { state: string; value?: T }) => (s.state === "ready" ? s.value : s.state);

describe("financial insights: the worked examples", () => {
  it("bank to investment: cash falls, the investment rises, net worth and Money kept do not move", () => {
    const s = run(facts(transfer("2026-09", "chk", "inv", 500_000)), sep);
    expect(s.eligibleCash.change).toBe(-500_000);
    expect(s.cashBridge.investment).toBe(-500_000);
    expect(s.invested).toBe(500_000);
    expect(s.netWorth.change).toBe(0);
    expect(value(s.moneyKept)).toBe(0);
    expect(s.unexplained).toBe(0);
  });

  it("borrowing: cash and debt rise together and it is not income", () => {
    const s = run(facts(transfer("2026-09", "loan", "chk", 10_000_000)), sep);
    expect(s.cashBridge.loan).toBe(10_000_000);
    expect(s.eligibleCash.change).toBe(10_000_000);
    expect(s.liabilities).toBe(10_000_000);
    expect(s.netWorth.change).toBe(0);
    expect(s.received).toBe(0);
  });

  it("principal 800 plus interest 200: cash -1,000, debt -800, spending +200, net worth -200", () => {
    const start = { startingBalances: [{ month: "2026-08", accountId: "loan", amountMinor: -10_000_000 }] };
    const s = run(facts([...transfer("2026-09", "chk", "loan", 80_000), row("2026-09", "chk", -20_000, { categoryId: "interest" })], start), sep);
    expect(s.eligibleCash.change).toBe(-100_000);
    expect(s.closing.loans).toBe(-10_000_000 + 80_000);
    expect(s.spent).toBe(20_000);
    expect(s.netWorth.change).toBe(-20_000);
    expect(s.unexplained).toBe(0);
  });

  it("a card purchase is spending once, in the purchase month; the later settlement is not spending", () => {
    const movement = [row("2026-09", "visa", -30_000, { categoryId: "food" }), ...transfer("2026-10", "chk", "visa", 30_000)];
    const september = run(facts(movement), sep);
    const october = run(facts(movement), range("2026-10", "2026-10"));
    expect([september.spent, october.spent]).toEqual([30_000, 0]);
    expect([september.eligibleCash.change, october.eligibleCash.change]).toEqual([0, -30_000]);
    expect(october.cashBridge.card).toBe(-30_000);
    expect(run(facts(movement), range("2026-09", "2026-10")).netWorth.change).toBe(-30_000);
  });

  it("cash moved between your own accounts is no consolidated change, whatever the budget placement", () => {
    const s = run(facts(transfer("2026-09", "chk", "sav", 50_000)), sep);
    expect(s.eligibleCash.change).toBe(0);
    expect(s.cashBridge.inTransit).toBe(0);
    expect(s.spent).toBe(0);
  });
});

describe("financial insights: how a row is classified", () => {
  it("never calls a transfer income or spending, whatever its category", () => {
    const s = run(facts(transfer("2026-09", "chk", "inv", 10_000).map((r) => ({ ...r, categoryId: "salary" }))), sep);
    expect([s.received, s.spent]).toEqual([0, 0]);
  });

  it("follows the category whatever the account class: an expense from an Other Asset account is spending", () => {
    const s = run(facts([row("2026-09", "pass", -40_000, { categoryId: "food" }), row("2026-09", "inv", -5_000, { categoryId: "fees" }), row("2026-09", "inv", 9_000, { categoryId: "salary" })]), sep);
    expect([s.received, s.spent]).toEqual([9_000, 45_000]);
    expect(s.flows.unidentified).toBe(0);
  });

  it("never infers income or spending from the sign of a categorized row", () => {
    // A refund in an expense category lowers spending; a reversal in an income category lowers income.
    const s = run(facts([row("2026-09", "chk", -100_000, { categoryId: "food" }), row("2026-09", "chk", 30_000, { categoryId: "food" }), row("2026-09", "chk", 500_000, { categoryId: "salary" }), row("2026-09", "chk", -50_000, { categoryId: "salary" })]), sep);
    expect([s.received, s.spent]).toEqual([450_000, 70_000]);
  });

  it("includes an uncategorized entry in an on-budget account by its sign, in any account class", () => {
    const f = facts([row("2026-09", "chk", 10_000, { count: 3 }), row("2026-09", "pass", -2_000)], {
      uncategorizedIn: [{ month: "2026-09", accountId: "chk", amountMinor: 30_000 }],
    });
    const s = run(f, sep);
    expect([s.flows.uncategorizedIn, s.flows.uncategorizedOut]).toEqual([30_000, -22_000]);
    expect([s.received, s.spent]).toEqual([30_000, 22_000]);
    expect(value(s.moneyKept)).toBe(8_000);
    expect(s.flows.unidentifiedCount).toBe(0);
  });

  it("keeps an uncategorized entry in an off-budget account out of income and spending, as an unidentified movement", () => {
    const f = facts([row("2026-09", "sav", 400_000, { count: 2 }), row("2026-09", "house", 1_000_000), row("2026-09", "owed", -7_000, { count: 4 }), row("2026-09", "chk", 100_000, { categoryId: "salary" })]);
    const s = run(f, sep);
    expect([s.received, s.spent]).toEqual([100_000, 0]);
    expect(value(s.moneyKept)).toBe(100_000);
    expect([s.flows.unidentified, s.flows.unidentifiedCount]).toEqual([1_393_000, 7]);
    expect(s.cashBridge.unidentified).toBe(400_000);
    expect([s.cashBridge.operatingIncome, s.cashBridge.operatingSpending]).toEqual([100_000, 0]);
    expect(s.eligibleCash.change).toBe(500_000);
    expect(s.netWorth.change).toBe(1_493_000);
    expect(s.unexplained).toBe(0);
  });

  it("does not let ordinary movements in asset accounts block Money kept", () => {
    const s = run(facts([row("2026-09", "owed", 14_753), row("2026-09", "pass", 66_054), row("2026-09", "house", 100_000)]), sep);
    expect(s.moneyKept.state).toBe("ready");
  });

  it("takes a row the registry classifies as a value change out of its category and into its own line", () => {
    const f = facts([row("2026-09", "house", 900_000, { categoryId: "misc" }), row("2026-09", "house", 100_000)], {
      reclassified: [
        { id: "r", payeeId: null, month: "2026-09", accountId: "house", categoryId: "misc", amountMinor: 900_000, to: "valueChange" },
        { id: "r", payeeId: null, month: "2026-09", accountId: "house", categoryId: null, amountMinor: 100_000, to: "valueChange" },
      ],
    });
    const s = run(f, sep);
    expect([s.received, s.spent, s.flows.unidentified, s.flows.valueChanges]).toEqual([0, 0, 0, 1_000_000]);
    expect(s.flows.unidentifiedCount).toBe(0);
    expect(s.unexplained).toBe(0);
  });

  it("takes a sale's linked proceeds out of income into their own line", () => {
    const f = facts([row("2026-09", "chk", 1_000_000, { categoryId: "salary" }), row("2026-09", "house", -900_000)], {
      reclassified: [
        { id: "r", payeeId: null, month: "2026-09", accountId: "chk", categoryId: "salary", amountMinor: 1_000_000, to: "assetSale" },
        { id: "r", payeeId: null, month: "2026-09", accountId: "house", categoryId: null, amountMinor: -900_000, to: "valueChange" },
      ],
    });
    const s = run(f, sep);
    expect(s.received).toBe(0);
    expect(s.flows.assetSales).toBe(1_000_000);
    expect(s.cashBridge.assetSales).toBe(1_000_000);
    expect([s.cashBridge.operatingIncome, s.cashBridge.operatingSpending]).toEqual([0, 0]);
    expect(s.flows.valueChanges).toBe(-900_000);
    expect(s.unexplained).toBe(0);
  });

  it("keeps starting balances out of income and spending, and shows them as opening balances", () => {
    const f = facts([row("2026-09", "chk", 100_000, { categoryId: "salary" })], {
      startingBalances: [{ month: "2026-08", accountId: "chk", amountMinor: 700_000 }, { month: "2026-09", accountId: "house", amountMinor: 9_000_000 }],
    });
    const s = run(f, sep);
    expect(s.received).toBe(100_000);
    expect(s.flows.openingBalances).toBe(9_000_000);
    expect(s.eligibleCash.opening).toBe(700_000);
    expect(s.netWorth.closing).toBe(700_000 + 100_000 + 9_000_000);
    expect(s.unexplained).toBe(0);
  });

  it("counts a fixed / restricted deposit in net worth but not in cash", () => {
    const s = run(facts(transfer("2026-09", "chk", "fd", 200_000)), sep);
    expect(s.eligibleCash.change).toBe(-200_000);
    expect(s.cashBridge.fixedDeposits).toBe(-200_000);
    expect(s.closing.fixedDeposits).toBe(200_000);
    expect(s.netWorth.change).toBe(0);
  });

  it("reads a loan account's rows: interest with a category is spending, an uncategorized one (an untracked loan) is an other entry, not unidentified", () => {
    const s = run(facts([row("2026-09", "loan", -5_000, { categoryId: "interest" }), row("2026-09", "loan", -3_000)]), sep);
    expect([s.spent, s.flows.unidentified, s.flows.loanAccountOther]).toEqual([5_000, 0, -3_000]);
    expect(s.netWorth.change).toBe(-8_000);
    expect(s.unexplained).toBe(0);
  });
});

describe("financial insights: transfers across dates", () => {
  const cross = facts(transfer("2026-09", "chk", "sav", 50_000, "2026-10"));

  it("shows a transfer whose sides straddle the period as in transit, never forced to net out", () => {
    const september = run(cross, sep);
    expect(september.eligibleCash.change).toBe(-50_000);
    expect(september.cashBridge.inTransit).toBe(-50_000);
    expect(september.flows.inTransit).toBe(-50_000);
    expect(september.unexplained).toBe(0);
    const both = run(cross, range("2026-09", "2026-10"));
    expect([both.eligibleCash.change, both.cashBridge.inTransit, both.flows.inTransit]).toEqual([0, 0, 0]);
  });

  it("leaves a future-dated second side out, so the difference is in transit up to today", () => {
    const s = run(facts([row("2026-11", "chk", -50_000, { transferAccountId: "sav" })]), { kind: "preset", id: "this-month" });
    expect(s.cashBridge.inTransit).toBe(-50_000);
    expect(s.eligibleCash.closing).toBe(-50_000);
  });
});

describe("financial insights: Money kept and the savings rate", () => {
  const earnings = facts([row("2026-09", "chk", 1_000_000, { categoryId: "salary" }), row("2026-09", "chk", -600_000, { categoryId: "food" })]);

  it("is income minus spending, and the rate is a share of income", () => {
    const s = run(earnings, sep);
    expect(value(s.moneyKept)).toBe(400_000);
    expect(value(s.savingsRate)).toBe(40);
  });

  it("is shown with a warning and the amount at issue when the registry says capital was put in without a transfer", () => {
    const s = run(earnings, sep, { unavailableReason: null, rowCount: 2, amountMinor: 300_000 });
    expect(s.moneyKept).toEqual({ state: "ready", value: 400_000, warning: expect.stringContaining("2 entries (3,000.00) are classified in Assets as capital put into an asset without a recorded transfer, so this may count them twice") });
    expect(s.savingsRate).toMatchObject({ state: "ready", value: 40, warning: expect.stringContaining("2 entries") });
    expect([s.received, s.spent]).toEqual([1_000_000, 600_000]);
    expect(s.netWorth.change).toBe(400_000);
  });

  it("is withheld when the registry could not be read, and nothing else is affected", () => {
    const s = run(earnings, sep, { unavailableReason: "Too many entries to read", rowCount: 0, amountMinor: 0 });
    expect(s.moneyKept).toEqual({ state: "needsReview", reason: "Too many entries to read" });
    expect(s.netWorth.closing).toBe(400_000);
  });

  it("has no savings rate without income", () => {
    expect(run(facts([row("2026-09", "chk", -1_000, { categoryId: "food" })]), sep).savingsRate.state).toBe("unavailable");
  });
});

describe("financial insights: excluded accounts", () => {
  it("counts nothing of an excluded account and shows a transfer with one on its own line, closing the identity", () => {
    const f = facts(
      [row("2026-09", "chk", 500_000, { categoryId: "salary" }), ...transfer("2026-09", "chk", "scratch", 120_000), row("2026-09", "scratch", 7_000_000), row("2026-09", "scratch", -3_000, { categoryId: "food" })],
      { excluded: new Set(["scratch"]) },
    );
    const s = run(f, sep);
    expect(s.netWorth.closing).toBe(380_000);
    expect(s.flows.excludedTransfers).toBe(-120_000);
    expect(s.cashBridge.excluded).toBe(-120_000);
    expect([s.flows.inTransit, s.flows.unidentified, s.received, s.spent]).toEqual([0, 0, 500_000, 0]);
    expect(s.unexplained).toBe(0);
  });
});

describe("financial insights: the history series", () => {
  it("leaves months before any data empty and marks the current month partial", () => {
    const s = run(facts([row("2026-10", "chk", 100_000, { categoryId: "salary" })]), range("2026-09", "2026-11"));
    expect(s.series.map((p) => p.netWorthMinor)).toEqual([null, 100_000, 100_000]);
    expect(s.series.map((p) => p.partial)).toEqual([false, false, true]);
  });
});

describe("financial insights: cash buffer", () => {
  const today = "2026-11-18";
  const spending = (months: string[], amount = 100_000, categoryId = "food") => months.map((m) => row(m, "chk", -amount, { categoryId }));
  const months6 = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const base = [row("2026-05", "chk", 1_000_000, { categoryId: "salary" })];
  const owing = row("2026-05", "loan", -10_000_000);
  const buffer = (f: FinancialFacts, schedules: [string, LoanScheduleInput][] = []) => cashBuffer(buildLedger(f), today, new Map(schedules));

  it("adds a tracked loan's whole scheduled repayment, and takes out only the interest lines the loan's tracking recorded", () => {
    const interest = months6.map((m) => row(m, "chk", -20_000, { categoryId: "loan-interest" }));
    const f = facts([...base, ...spending(months6), ...interest, owing], {
      loanCosts: months6.map((m) => ({ month: m, accountId: "chk", categoryId: "loan-interest", amountMinor: -20_000 })),
    });
    const result = buffer(f, [["loan", { state: "ready", monthlyMinor: 837_891 }]]);
    expect(result).toMatchObject({ state: "ready", value: { spendingMinor: 100_000, monthlyNeedMinor: 937_891, loans: [{ monthlyMinor: 837_891, source: "schedule" }] } });
    // Without the recorded lines the same interest would be in both the spending and the repayment.
    expect(buffer(facts([...base, ...spending(months6), ...interest, owing]), [["loan", { state: "ready", monthlyMinor: 837_891 }]])).toMatchObject({ value: { spendingMinor: 120_000 } });
  });

  it("never removes unrelated spending that shares the loan's interest category", () => {
    // Every month: 200 of the loan's interest and 450 of something else, both under one category.
    const shared = months6.flatMap((m) => [row(m, "chk", -20_000, { categoryId: "debt" }), row(m, "visa", -45_000, { categoryId: "debt" })]);
    const f = facts([...base, ...shared, owing], { loanCosts: months6.map((m) => ({ month: m, accountId: "chk", categoryId: "debt", amountMinor: -20_000 })) });
    expect(buffer(f, [["loan", { state: "ready", monthlyMinor: 100_000 }]])).toMatchObject({ state: "ready", value: { spendingMinor: 45_000 } });
  });

  it("only takes out a recorded interest line that counted as spending", () => {
    const f = facts([...base, ...spending(months6), owing], {
      loanCosts: [{ month: "2026-09", accountId: "sav", categoryId: null, amountMinor: -20_000 }, { month: "2026-09", accountId: "chk", categoryId: "salary", amountMinor: -20_000 }],
    });
    expect(buffer(f, [["loan", { state: "ready", monthlyMinor: 100_000 }]])).toMatchObject({ value: { spendingMinor: 100_000 } });
  });

  it("is unavailable, naming the loan, when its schedule does not reconcile, and never falls back to an estimate", () => {
    const paid = months6.flatMap((m) => transfer(m, "chk", "loan", 50_000));
    const f = facts([...base, ...spending(months6), owing, ...paid]);
    expect(buffer(f, [["loan", { state: "unavailable", reason: "Its schedule does not agree with Actual" }]])).toEqual({ state: "unavailable", reason: "Mortgage: Its schedule does not agree with Actual" });
  });

  it("uses recorded transfers into a loan that has no schedule, with at least three complete months, else is unavailable", () => {
    const paid = months6.flatMap((m) => transfer(m, "chk", "loan", 50_000));
    expect(buffer(facts([...base, ...spending(months6), owing, ...paid]))).toMatchObject({ state: "ready", value: { loans: [{ monthlyMinor: 50_000, source: "recorded" }] } });
    const recent = facts([...base, ...spending(months6), row("2026-09", "loan", -10_000_000), ...transfer("2026-10", "chk", "loan", 50_000)]);
    expect(buffer(recent)).toEqual({ state: "unavailable", reason: "Mortgage is not tracked in Loans and has fewer than three complete months of recorded repayments" });
  });

  it("needs three complete months of history and is current, whatever period is selected", () => {
    expect(buffer(facts(spending(["2026-09", "2026-10"]))).state).toBe("unavailable");
    expect(buffer(facts([...base, ...spending(months6)]))).toMatchObject({ state: "ready", value: { spendingMonths: 6, monthlyNeedMinor: 100_000 } });
  });

  it("averages spending over the last 12 complete months, or all of them from three to eleven", () => {
    const twelve = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", ...months6];
    const early = [row("2025-09", "chk", 5_000_000, { categoryId: "salary" })];
    expect(buffer(facts([...early, ...spending(["2025-09", "2025-10", ...twelve])]))).toMatchObject({ state: "ready", value: { spendingMonths: 12, spendingMinor: 100_000 } });
    expect(buffer(facts([row("2026-08", "chk", 1_000_000, { categoryId: "salary" }), ...spending(months6.slice(3))]))).toMatchObject({ state: "ready", value: { spendingMonths: 3 } });
    expect(buffer(facts(spending(["2026-09", "2026-10"])))).toEqual({ state: "unavailable", reason: "Insufficient history: at least three complete months are needed" });
  });

  it("is unavailable, not negative, when cash & bank is below zero", () => {
    expect(buffer(facts(spending(months6)))).toEqual({ state: "unavailable", reason: "Cash & bank is below zero" });
  });

  it("excludes fixed deposits from the cash it divides", () => {
    const result = buffer(facts([...base, ...spending(months6), ...transfer("2026-10", "chk", "fd", 400_000)]));
    expect(result.state === "ready" && result.value.cashMinor).toBe(1_000_000 - 600_000 - 400_000);
  });
});

describe("where a budget's data begins", () => {
  it("counts a starting balance, so a budget with only those still has balances to show", () => {
    const ledger = buildLedger(facts([], { startingBalances: [{ month: "2026-03", accountId: "chk", amountMinor: 50_000 }] }));
    expect(ledger.firstMonth).toBe("2026-03");
    expect(ledger.balanceAt("chk", "2026-05")).toBe(50_000);
  });

  it("begins with the first movement when there is one, not with an earlier month that holds only a starting balance", () => {
    const earlierBalance = buildLedger(facts([row("2026-06", "chk", 1_000)], { startingBalances: [{ month: "2026-02", accountId: "chk", amountMinor: 5_000 }] }));
    expect(earlierBalance.firstMonth).toBe("2026-06");
    expect(earlierBalance.balanceAt("chk", "2026-03")).toBe(5_000);
  });

  it("reads a balance at any month: nothing before the first, the running total between months, and the last total after", () => {
    const ledger = buildLedger(facts([row("2026-02", "chk", 1_000), row("2026-02", "chk", 500), row("2026-05", "chk", -300), row("2026-09", "chk", 200)]));
    expect(["2026-01", "2026-02", "2026-04", "2026-05", "2026-08", "2026-09", "2030-01"].map((m) => ledger.balanceAt("chk", m))).toEqual([0, 1_500, 1_500, 1_200, 1_200, 1_400, 1_400]);
    expect(ledger.balanceAt("unknown", "2026-09")).toBe(0);
  });

  it("is not moved by rows of an account that is left out", () => {
    const ledger = buildLedger(facts([row("2025-01", "ghost", 1_000), row("2026-04", "chk", 1_000)], { startingBalances: [{ month: "2024-06", accountId: "ghost", amountMinor: 9_000 }] }));
    expect(ledger.firstMonth).toBe("2026-04");
  });
});

describe("financial insights: the cash buffer", () => {
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const steady = months.flatMap((m) => [row(m, "chk", 300_000, { categoryId: "salary" }), row(m, "chk", -300_000, { categoryId: "food" })]);
  const months9 = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const steady9 = months9.flatMap((m) => [row(m, "chk", 300_000, { categoryId: "salary" }), row(m, "chk", -300_000, { categoryId: "food" })]);
  const buffer = (f: FinancialFacts, schedules: ReadonlyMap<string, LoanScheduleInput> = new Map()) => cashBuffer(buildLedger(f), "2026-11-18", schedules);

  it("is measured on cash & bank less what is owed on credit cards", () => {
    const f = facts(steady, { startingBalances: [{ month: "2026-04", accountId: "chk", amountMinor: 1_000_000 }, { month: "2026-04", accountId: "visa", amountMinor: -400_000 }] });
    const b = buffer(f);
    expect(b).toMatchObject({ state: "ready", value: { grossCashMinor: 1_000_000, cardsOwedMinor: 400_000, cashMinor: 600_000, monthlyNeedMinor: 300_000 } });
    expect(b.state === "ready" && b.value.months).toBeCloseTo(2, 5);
  });

  it("ignores a card in credit, and is unavailable when the cards owe more than the cash", () => {
    const credit = buffer(facts(steady, { startingBalances: [{ month: "2026-04", accountId: "chk", amountMinor: 1_000_000 }, { month: "2026-04", accountId: "visa", amountMinor: 50_000 }] }));
    expect(credit).toMatchObject({ state: "ready", value: { cardsOwedMinor: 0, cashMinor: 1_000_000 } });
    const owed = buffer(facts(steady, { startingBalances: [{ month: "2026-04", accountId: "chk", amountMinor: 1_000_000 }, { month: "2026-04", accountId: "visa", amountMinor: -1_200_000 }] }));
    expect(owed).toEqual({ state: "unavailable", reason: "What you owe on credit cards is more than your cash & bank" });
    const below = buffer(facts(steady, { startingBalances: [{ month: "2026-04", accountId: "chk", amountMinor: -400_000 }] }));
    expect(below).toEqual({ state: "unavailable", reason: "Cash & bank is below zero" });
  });

  it("is the same whether the lender's charge is tagged as a cost of the loan or not (it is in the repayment either way)", () => {
    // Each month: 5,000 in, 1,000 of food, 200 charged to the loan account, and the 1,200 repayment as one whole transfer.
    const movement = months.flatMap((m) => [
      row(m, "chk", 500_000, { categoryId: "salary" }), row(m, "chk", -100_000, { categoryId: "food" }), row(m, "loan", -20_000), ...transfer(m, "chk", "loan", 120_000),
    ]);
    const start = [{ month: "2026-04", accountId: "loan", amountMinor: -10_000_000 }, { month: "2026-04", accountId: "chk", amountMinor: 5_000_000 }];
    const tags = months.map((m) => ({ id: `c-${m}`, month: m, accountId: "loan", categoryId: null, amountMinor: -20_000, loanAccountId: "loan", kind: "interest" as const, charged: true }));
    const schedules = new Map<string, LoanScheduleInput>([["loan", { state: "ready", monthlyMinor: 120_000 }]]);
    const tagged = buffer(facts(movement, { startingBalances: start, loanCosts: tags }), schedules);
    const untagged = buffer(facts(movement, { startingBalances: start }), schedules);
    expect(tagged.state === "ready" && tagged.value.monthlyNeedMinor).toBe(100_000 + 120_000);
    expect(tagged).toEqual(untagged);
  });

  it("works out an untracked loan's recorded repayments over the same months as a typical month, and still needs three", () => {
    // 100.00 paid in each of the last three months, 400.00 in each of the nine before.
    const payments = months9.flatMap((m, i) => transfer(m, "chk", "loan", i < 6 ? 40_000 : 10_000));
    const f = facts([...steady9, ...payments], { startingBalances: [{ month: "2026-01", accountId: "loan", amountMinor: -10_000_000 }, { month: "2026-01", accountId: "chk", amountMinor: 50_000_000 }] });
    const over = (n: number | undefined) => { const b = cashBuffer(buildLedger(f), "2026-11-18", new Map(), { months: n }); return b.state === "ready" ? b.value.loans[0].monthlyMinor : b; };
    expect(over(3)).toBe(10_000);
    expect(over(6)).toBe(Math.round((3 * 10_000 + 3 * 40_000) / 6));
    expect(over(undefined)).toBe(Math.round((6 * 40_000 + 3 * 10_000) / 9));
    expect(over(2)).toEqual({ state: "unavailable", reason: "Insufficient history: at least three complete months are needed" });
  });

  it("takes the median of an untracked loan's monthly payments when asked, so one lump sum does not lift it", () => {
    const payments = months.flatMap((m, i) => transfer(m, "chk", "loan", i === 5 ? 1_000_000 : 100_000));
    const f = facts([...steady, ...payments], { startingBalances: [{ month: "2026-04", accountId: "loan", amountMinor: -10_000_000 }, { month: "2026-04", accountId: "chk", amountMinor: 50_000_000 }] });
    const average = cashBuffer(buildLedger(f), "2026-11-18", new Map(), { method: "average" });
    const median = cashBuffer(buildLedger(f), "2026-11-18", new Map(), { method: "median" });
    expect(average.state === "ready" && average.value.loans[0].monthlyMinor).toBe(Math.round((5 * 100_000 + 1_000_000) / 6));
    expect(median.state === "ready" && median.value.loans[0].monthlyMinor).toBe(100_000);
  });
});
