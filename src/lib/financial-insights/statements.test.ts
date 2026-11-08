import { buildLedger, summarize, type AccountFact, type FinancialFacts } from "./measures";
import { resolvePeriod } from "./period";
import { buildStatements, statementsCsvRows, subtotalIds, type StatementEntry } from "./statements";
import type { CategoryInfo } from "./breakdowns";
import { drillScope } from "./drill";

const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-06", null);
const accounts: AccountFact[] = [
  { id: "cash", name: "Wallet", accountClass: "cash", treatment: null, offBudget: false },
  { id: "bank", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
  { id: "saving", name: "Savings", accountClass: "bank", treatment: null, offBudget: true, closed: true },
  { id: "fd", name: "Deposit", accountClass: "bank", treatment: "fixed-deposit", offBudget: true },
  { id: "car", name: "Car", accountClass: "vehicle", treatment: null, offBudget: true },
  { id: "home", name: "Home", accountClass: "property", treatment: null, offBudget: true },
  { id: "inv", name: "Broker", accountClass: "investment", treatment: null, offBudget: true },
  { id: "ret", name: "Retirement", accountClass: "retirement", treatment: null, offBudget: true },
  { id: "other", name: "Receivable", accountClass: "other-asset", treatment: null, offBudget: true },
  { id: "fixed", name: "Collectible", accountClass: "other-asset", treatment: "fixed-asset", offBudget: true },
  { id: "card", name: "Card", accountClass: "credit-card", treatment: null, offBudget: false },
  { id: "loan", name: "Loan", accountClass: "loan", treatment: null, offBudget: true },
  { id: "liability", name: "Payable", accountClass: "other-liability", treatment: null, offBudget: true },
];
const categories = new Map<string, CategoryInfo>([
  ["salary", { id: "salary", name: "Salary", groupName: "Income", hidden: false, isIncome: true, order: 1 }],
  ["food", { id: "food", name: "Food", groupName: "Living", hidden: false, isIncome: false, order: 3 }],
  ["interest", { id: "interest", name: "Interest", groupName: "Debt costs", hidden: true, isIncome: false, order: 2 }],
]);
const entry = (id: string, accountId: string, amountMinor: number, over: Partial<StatementEntry> = {}): StatementEntry => ({
  id, accountId, amountMinor, date: "2026-09-12", categoryId: null, transferAccountId: null, transferId: null, parentId: null, startingBalance: false, ...over,
});
const transfer = (id: string, from: string, to: string, amountMinor: number, over: Partial<StatementEntry> = {}): StatementEntry[] => [
  entry(`${id}-from`, from, -amountMinor, { transferAccountId: to, transferId: `${id}-to`, ...over }),
  entry(`${id}-to`, to, amountMinor, { transferAccountId: from, transferId: `${id}-from` }),
];
function fixture(entries: StatementEntry[], extra: Partial<FinancialFacts> = {}, options: Partial<Parameters<typeof buildStatements>[0]> = {}) {
  const facts: FinancialFacts = {
    accounts, excluded: new Set(["excluded"]), incomeCategories: new Set(["salary"]),
    movement: entries.filter((r) => !r.startingBalance).map((r) => ({ month: r.date.slice(0, 7), accountId: r.accountId, categoryId: r.categoryId, transferAccountId: r.transferAccountId, amountMinor: r.amountMinor, count: 1 })),
    startingBalances: entries.filter((r) => r.startingBalance).map((r) => ({ month: r.date.slice(0, 7), accountId: r.accountId, amountMinor: r.amountMinor })),
    uncategorizedIn: entries.filter((r) => !r.startingBalance && !r.transferAccountId && !r.categoryId && r.amountMinor > 0).map((r) => ({ month: r.date.slice(0, 7), accountId: r.accountId, amountMinor: r.amountMinor })),
    transfersIn: [], loanCosts: [], reclassified: [], ...extra,
  };
  const ledger = buildLedger(facts);
  const model = buildStatements({ ledger, period, categories, entries, assetEntries: [], savedClassifications: [], basisIssue: null, ...options });
  return { model, ledger };
}
const section = (model: ReturnType<typeof buildStatements>, key: string) => model.cash.sections.find((s) => s.key === key)!;
const sumBridge = (model: ReturnType<typeof buildStatements>) => model.bridge.reduce((sum, r) => sum + r.amountMinor, 0);

describe("recorded financial statements", () => {
  it("reconciles cash and P&L while counting card purchases only once, with split principal and interest", () => {
    const entries = [
      entry("open", "bank", 500_000, { date: "2026-08-01", startingBalance: true }),
      entry("pay", "bank", 300_000, { categoryId: "salary" }), entry("groceries", "card", -30_000, { categoryId: "food" }),
      ...transfer("settle", "bank", "card", 24_000), ...transfer("invest", "bank", "inv", 50_000),
      ...transfer("borrow", "loan", "bank", 100_000), ...transfer("repay", "bank", "loan", 80_000, { parentId: "payment" }),
      entry("interest-paid", "bank", -20_000, { parentId: "payment", categoryId: "interest" }),
    ];
    const { model, ledger } = fixture(entries, { loanCosts: [{ id: "interest-paid", month: "2026-09", accountId: "bank", categoryId: "interest", amountMinor: -20_000, loanAccountId: "loan", kind: "interest" }] });
    expect([model.cash.openingMinor, model.cash.closingMinor, model.cash.changeMinor]).toEqual([500_000, 726_000, 226_000]);
    expect(model.pnl).toMatchObject({ incomeMinor: 300_000, expensesMinor: -50_000, surplusMinor: 250_000, basisIssue: null });
    expect(section(model, "operating").amountMinor).toBe(256_000);
    expect(section(model, "investing").amountMinor).toBe(-50_000);
    expect(section(model, "financing").amountMinor).toBe(20_000);
    expect(section(model, "operating").rows.find((r) => r.key === "interest")?.ids).toEqual(["interest-paid"]);
    expect(model.cash.differenceMinor).toBe(0); expect(sumBridge(model)).toBe(model.cash.changeMinor);
    expect(model.classificationComplete).toBe(true);
    // Existing Insights definitions remain unchanged by the new projection.
    expect(summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 }).spent).toBe(50_000);
  });

  it("uses every cash equivalent, preserves closed history, and separates investments, retirement, deposits and fixed assets", () => {
    const movements = [...transfer("cash", "bank", "cash", 100), ...transfer("savings", "bank", "saving", 200), ...transfer("fd", "bank", "fd", 300),
      ...transfer("investment", "bank", "inv", 400), ...transfer("withdrawal", "inv", "bank", 150), ...transfer("retire", "bank", "ret", 500),
      ...transfer("car", "bank", "car", 600), ...transfer("house", "bank", "home", 700), ...transfer("fixed", "bank", "fixed", 800)];
    const { model } = fixture(movements);
    expect(model.cash.changeMinor).toBe(-3150);
    expect(section(model, "investing").amountMinor).toBe(-3150);
    expect(model.pnl.surplusMinor).toBe(0); expect(model.cash.adjustments).toEqual([]);
    expect(model.cash.differenceMinor).toBe(0); expect(sumBridge(model)).toBe(-3150);
    expect(section(model, "investing").rows.find((r) => r.key === "invest-in")?.amountMinor).toBe(150);
  });

  it("keeps uncertain transfer purposes, unsplit repayments and net-zero uncategorized activity visible", () => {
    const { model } = fixture([...transfer("repay", "bank", "loan", 1000), ...transfer("other", "bank", "other", 200),
      ...transfer("payable", "bank", "liability", 300), ...transfer("scope", "bank", "excluded", 400), ...transfer("missing", "bank", "missing", 500),
      ...transfer("card-receipt", "card", "bank", 600), entry("unknown-in", "bank", 700), entry("unknown-out", "bank", -700)]);
    expect(section(model, "financing").amountMinor).toBe(0);
    expect(model.unresolved.find((r) => r.key === "uncategorized")).toBeUndefined();
    expect(model.pnl.income.find((r) => r.key === "uncategorized-income")).toMatchObject({ amountMinor: 700, ids: ["unknown-in"] });
    expect(model.pnl.expenses.find((r) => r.key === "uncategorized-expenses")).toMatchObject({ amountMinor: -700, ids: ["unknown-out"] });
    expect(model.unresolved.find((r) => r.key === "loan-allocation")?.amountMinor).toBe(-1000);
    expect(model.unresolved.find((r) => r.key === "scope")?.amountMinor).toBe(-900);
    expect(model.pnl.surplusMinor).toBe(0); expect(model.classificationComplete).toBe(false);
    expect(model.cash.differenceMinor).toBe(0); expect(sumBridge(model)).toBe(model.cash.changeMinor);
  });

  it("uses category identity rather than amount sign, includes hidden categories, and bridges recorded noncash charges", () => {
    const { model } = fixture([entry("salary", "bank", 10000, { categoryId: "salary" }), entry("reversal", "bank", -1000, { categoryId: "salary" }),
      entry("food", "bank", -4000, { categoryId: "food" }), entry("refund", "bank", 1000, { categoryId: "food" }),
      entry("posted-interest", "loan", -500, { categoryId: "interest" }), entry("dividend", "inv", 700, { categoryId: "salary" }), entry("investment-change", "inv", 900)]);
    expect(model.pnl).toMatchObject({ incomeMinor: 9700, expensesMinor: -3500, surplusMinor: 6200 });
    expect(model.pnl.expenses[0].rows[0].label).toBe("Interest (hidden)");
    expect(model.cash.changeMinor).toBe(6000); expect(sumBridge(model)).toBe(6000);
    expect(model.investmentActivity).toMatchObject({ amountMinor: 900, ids: ["investment-change"] });
    expect(model.unresolved).toEqual([]);
  });

  it("follows existing Insights for uncategorized on-budget purchases and receipts, with investment activity outside exceptions and P&L", () => {
    const { model, ledger } = fixture([
      entry("purchase", "card", -1234), entry("cash-payment", "bank", -500), entry("cash-receipt", "bank", 800),
      entry("gain-1", "inv", 6000), entry("gain-2", "inv", 14000), entry("retirement-loss", "ret", -1000),
    ]);
    expect(model.pnl).toMatchObject({ incomeMinor: 800, expensesMinor: -1734, surplusMinor: -934, basisIssue: null });
    expect(model.pnl.expenses.find((g) => g.key === "uncategorized-expenses")?.ids).toEqual(["purchase", "cash-payment"]);
    expect(model.investmentActivity).toMatchObject({ amountMinor: 19000, ids: ["gain-1", "gain-2", "retirement-loss"] });
    expect(model.unresolved).toEqual([]); expect(model.classificationComplete).toBe(true);
    expect(section(model, "operating").amountMinor).toBe(300);
    expect(model.cash.differenceMinor).toBe(0); expect(sumBridge(model)).toBe(300);
    const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
    expect(model.pnl.surplusMinor).toBe(summary.received - summary.spent);
    const csv = statementsCsvRows(model, period);
    expect(csv).toContainEqual(["Other activity", "Investment activity", "Recorded investment activity", "190.00", 3, model.investmentActivity.detail]);
    expect(csv.some((r) => r[0] === "Review")).toBe(false);
    const scope = drillScope({ kind: "statement", name: model.investmentActivity.label, ids: model.investmentActivity.ids, amountMinor: model.investmentActivity.amountMinor }, { ledger, period, today: "2026-11-06", reclassifiedIds: new Set() });
    expect(scope.constraints.namedIds).toEqual(["gain-1", "gain-2", "retirement-loss"]);
    expect(scope.expectedMinor).toBe(19000);
  });

  it("retains genuinely unidentified off-budget entries and missing categories without treating them as ordinary spending", () => {
    const { model } = fixture([entry("cash-unknown", "saving", -300), entry("other-unknown", "other", -400), entry("missing-category", "bank", -500, { categoryId: "unavailable" })]);
    expect(model.pnl.surplusMinor).toBe(0);
    expect(model.unresolved.flatMap((r) => r.ids)).toEqual(["cash-unknown", "missing-category", "other-unknown"]);
    expect(model.classificationComplete).toBe(false);
    expect(model.cash.differenceMinor).toBe(0); expect(sumBridge(model)).toBe(-800);
  });

  it("excludes revaluations, depreciation, capital and linked sales from P&L, with cash sale proceeds in investing", () => {
    const entries = [entry("valuation", "home", 9000, { categoryId: "salary" }), entry("depreciation", "car", -500, { categoryId: "food" }),
      entry("proceeds", "bank", 5000, { categoryId: "salary" }), entry("selling-cost", "bank", -200, { categoryId: "food" }), entry("capital", "home", 2000, { categoryId: "food" })];
    const reclassified = entries.slice(0, 4).map((r) => ({ id: r.id, month: "2026-09", accountId: r.accountId, categoryId: r.categoryId, amountMinor: r.amountMinor, payeeId: null, to: r.accountId === "bank" ? "assetSale" as const : "valueChange" as const }));
    const { model } = fixture(entries, { reclassified }, { assetEntries: [{ id: "capital", date: "2026-09-12", accountId: "home", categoryId: "food", amountMinor: 2000, notes: "#acquisition" }], basisIssue: "Capital without a transfer" });
    expect(model.pnl).toMatchObject({ incomeMinor: 0, expensesMinor: 0, basisIssue: "Capital without a transfer" });
    expect(section(model, "investing").amountMinor).toBe(4800);
    expect(model.unresolved[0].key).toBe("capital"); expect(sumBridge(model)).toBe(4800);
  });

  it("separates starting balances and cross-period cash transfers from activities", () => {
    const { model } = fixture([entry("opening", "cash", 200, { date: "2026-08-01", startingBalance: true }), entry("new-start", "bank", 500, { startingBalance: true }),
      entry("cross-from", "cash", -100, { transferAccountId: "saving", transferId: "cross-to" }),
      entry("cross-to", "saving", 100, { date: "2026-10-01", transferAccountId: "cash", transferId: "cross-from" })]);
    expect(model.cash).toMatchObject({ openingMinor: 200, closingMinor: 600, changeMinor: 400, differenceMinor: 0 });
    expect(model.cash.adjustments.map((r) => [r.key, r.amountMinor])).toEqual([["starting", 500], ["internal", -100]]);
    expect(model.pnl.surplusMinor).toBe(0); expect(model.classificationComplete).toBe(false);
  });

  it("reports snapshot drift in noncash categories even when cash still reconciles", () => {
    const { ledger } = fixture([entry("purchase", "card", -100, { categoryId: "food" })]);
    const model = buildStatements({ ledger, period, categories, entries: [entry("purchase", "card", -100, { categoryId: "interest" })], assetEntries: [], savedClassifications: [], basisIssue: null });
    expect(model.cash.differenceMinor).toBe(0); expect(model.pnl.basisIssue).toMatch(/differs from the shared/); expect(model.classificationComplete).toBe(false);
  });

  it("keeps unrelated unmatched cash transfers for review even when their amounts cancel", () => {
    const { model } = fixture([entry("out", "cash", -100, { transferAccountId: "bank", transferId: "missing-a" }), entry("in", "bank", 100, { transferAccountId: "cash", transferId: "missing-b" })]);
    expect(model.cash.adjustments).toEqual(expect.arrayContaining([expect.objectContaining({ key: "internal", amountMinor: 0, ids: ["out", "in"] })]));
    expect(model.classificationComplete).toBe(false);
  });

  it("detects classified transactions swapped between accounts even if aggregate cells agree", () => {
    const original = [entry("classified", "home", 100, { categoryId: "food" }), entry("ordinary", "car", 100, { categoryId: "food" })];
    const classified = { id: "classified", date: "2026-09-12", accountId: "home", categoryId: "food", amountMinor: 100, notes: "#revaluation" };
    const { ledger } = fixture(original);
    const changed = [entry("classified", "car", 100, { categoryId: "food" }), entry("ordinary", "home", 100, { categoryId: "food" })];
    const model = buildStatements({ ledger, period, categories, entries: changed, assetEntries: [classified], savedClassifications: [], basisIssue: null });
    expect(model.pnl.basisIssue).toMatch(/differs from the shared/);
  });

  it("keeps same-named category groups separate by their IDs", () => {
    const rows = [entry("first", "bank", -100, { categoryId: "food" }), entry("second", "bank", -200, { categoryId: "interest" })];
    const separate = new Map(categories);
    separate.set("food", { ...separate.get("food")!, groupName: "Shared", groupId: "one" });
    separate.set("interest", { ...separate.get("interest")!, groupName: "Shared", groupId: "two" });
    const { ledger } = fixture(rows);
    const model = buildStatements({ ledger, period, categories: separate, entries: rows, assetEntries: [], savedClassifications: [], basisIssue: null });
    expect(model.pnl.expenses.map((group) => [group.key, group.ids])).toEqual([["two", ["second"]], ["one", ["first"]]]);
  });

  it("leaves differences visible and exports every subtotal, adjustment and provisional status with exact cents", () => {
    const { ledger } = fixture([entry("income", "bank", 10001, { categoryId: "salary" }), entry("new-start", "bank", 123, { startingBalance: true })]);
    const model = buildStatements({ ledger, period, categories, entries: [], assetEntries: null, savedClassifications: [], basisIssue: "Registry unavailable" });
    expect(model.cash.differenceMinor).toBe(10124); expect(sumBridge(model)).toBe(10124);
    const csv = statementsCsvRows(model, period);
    expect(csv).toContainEqual(["Cash flow", "Balances", "Closing cash", "101.24", "", ""]);
    expect(csv).toContainEqual(["P&L status", "Registry unavailable"]);
    expect(csv.filter((r) => r[2] === "Subtotal")).toHaveLength(3);
    expect(csv.some((r) => r[2] === "Provisional surplus / deficit — needs review")).toBe(true);
  });

  it("drills exact statement membership without excluding transfers or starting balances, and handles long memberships", () => {
    const { ledger } = fixture([]);
    const ctx = { ledger, period, today: "2026-11-06", reclassifiedIds: new Set(["classified"]) };
    const scope = drillScope({ kind: "statement", name: "Evidence", ids: ["opening", "classified", "transfer"], amountMinor: -123 }, ctx);
    expect(scope.constraints.namedIds).toEqual(["opening", "classified", "transfer"]);
    expect(scope.constraints.excludeStartingBalance).toBeUndefined(); expect(scope.expectedMinor).toBe(-123);
    const long = drillScope({ kind: "statement", name: "Long", ids: Array.from({ length: 301 }, (_, i) => `row-${i}`), amountMinor: 0 }, ctx);
    expect(long.constraints.namedIds).toHaveLength(301);
    expect(long.rowFilter).toBeUndefined();
  });

  describe("a lender that charges interest to a tracked loan's account", () => {
    const charge = { id: "charge", month: "2026-09", accountId: "loan", categoryId: null, amountMinor: -2_000, loanAccountId: "loan", kind: "interest" as const, charged: true };
    const salary = entry("salary", "bank", 100_000, { categoryId: "salary" });
    const charged = entry("charge", "loan", -2_000);
    const line = (rows: { key: string }[], key: string) => rows.find((r) => r.key === key);

    it("is a recorded expense; the payments are split into interest paid (operating) and principal (financing), and everything reconciles", () => {
      const { model } = fixture([salary, charged, ...transfer("repay", "bank", "loan", 12_000)], { loanCosts: [charge] });
      expect(model.pnl.expenses.find((g) => g.label === "Loans")).toMatchObject({ amountMinor: -2_000, rows: [{ key: "lender-charges", ids: ["charge"] }] });
      expect(model.pnl.surplusMinor).toBe(98_000);
      expect(section(model, "operating").rows.find((r) => r.key === "interest")).toMatchObject({ amountMinor: -2_000, ids: ["charge"] });
      const principal = line(section(model, "financing").rows, "principal-net") as ReturnType<typeof section>["rows"][number];
      expect(principal.amountMinor).toBe(-10_000);
      // Opened from the loan accounts: what was paid in (12,000.00) less what was charged (2,000.00).
      expect(principal.drill).toEqual({ ids: ["repay-to", "charge"], amountMinor: 10_000 });
      expect(model.unresolved.find((r) => r.key === "loan-allocation")).toBeUndefined();
      expect(model.unresolved.find((r) => r.key === "uncategorized")).toBeUndefined();
      expect(model.cash.differenceMinor).toBe(0);
      expect(sumBridge(model)).toBe(model.cash.changeMinor);
      expect(Math.abs(model.bridge.find((r) => r.label === "Income / expenses in other noncash accounts")!.amountMinor)).toBe(0);
    });

    it("lists the loan-side rows and the charge for the principal line, adding up to its drill figure", () => {
      const rows = [salary, charged, ...transfer("repay", "bank", "loan", 12_000)];
      const { model } = fixture(rows, { loanCosts: [charge] });
      const principal = line(section(model, "financing").rows, "principal-net") as ReturnType<typeof section>["rows"][number];
      const listedTotal = principal.drill!.ids.reduce((sum, id) => sum + rows.find((r) => r.id === id)!.amountMinor, 0);
      expect(listedTotal).toBe(principal.drill!.amountMinor);
      const operating = line(section(model, "operating").rows, "interest") as ReturnType<typeof section>["rows"][number];
      expect(operating.ids.reduce((sum, id) => sum + rows.find((r) => r.id === id)!.amountMinor, 0)).toBe(operating.amountMinor);
    });

    it("is an expense with no cash movement when nothing was paid to the loan in the period, and still reconciles", () => {
      const { model } = fixture([salary, charged], { loanCosts: [charge] });
      expect(model.pnl.expensesMinor).toBe(-2_000);
      expect(section(model, "operating").rows.find((r) => r.key === "interest")).toBeUndefined();
      expect(section(model, "financing").rows).toEqual([]);
      expect(model.bridge.find((r) => r.label === "Income / expenses in other noncash accounts")?.amountMinor).toBe(2_000);
      expect(model.cash.differenceMinor).toBe(0);
      expect(sumBridge(model)).toBe(model.cash.changeMinor);
    });

    it("pays interest and fees in cash only up to the payments: a larger charge leaves the rest as a noncash expense, and principal is never an inflow", () => {
      const rows = [salary, entry("charge", "loan", -50_000), ...transfer("repay", "bank", "loan", 30_000)];
      const { model } = fixture(rows, { loanCosts: [{ ...charge, amountMinor: -50_000 }] });
      const interest = line(section(model, "operating").rows, "interest") as ReturnType<typeof section>["rows"][number];
      expect(interest.amountMinor).toBe(-30_000);
      // Opened from the payments that paid it, so the list adds up to the figure.
      expect(interest.ids).toEqual(["repay-from"]);
      expect(interest.ids.reduce((sum, id) => sum + rows.find((r) => r.id === id)!.amountMinor, 0)).toBe(interest.amountMinor);
      expect(line(section(model, "financing").rows, "principal-net")).toBeUndefined();
      expect(model.pnl.expensesMinor).toBe(-50_000);
      expect(model.bridge.find((r) => r.label === "Income / expenses in other noncash accounts")!.amountMinor).toBe(20_000);
      expect(model.unresolved.find((r) => r.key === "loan-allocation")).toBeUndefined();
      expect(model.cash.differenceMinor).toBe(0);
      expect(sumBridge(model)).toBe(model.cash.changeMinor);
    });

    it("opens no list for a subtotal that holds a line shown from the loan side, and lists every other subtotal in full", () => {
      const rows = [salary, charged, ...transfer("repay", "bank", "loan", 12_000)];
      const { model } = fixture(rows, { loanCosts: [charge] });
      // The line opens from the loan accounts (+10,000.00) while it counts -10,000.00 in the section, so the section cannot be listed.
      expect(subtotalIds(section(model, "financing").rows)).toEqual([]);
      const operating = section(model, "operating").rows;
      expect(subtotalIds(operating)).toEqual(operating.flatMap((r) => r.ids));
      expect(subtotalIds(operating).reduce((sum, id) => sum + rows.find((r) => r.id === id)!.amountMinor, 0)).toBe(section(model, "operating").amountMinor);
    });

    it("opens no subtotal list when the loan line is zero, because its rows still do not add up to the section", () => {
      const rows = [salary, entry("charge", "loan", -12_000), ...transfer("repay", "bank", "loan", 12_000)];
      const { model } = fixture(rows, { loanCosts: [{ ...charge, amountMinor: -12_000 }] });
      const principal = line(section(model, "financing").rows, "principal-net") as ReturnType<typeof section>["rows"][number];
      expect(principal.amountMinor).toBe(0);
      expect(subtotalIds(section(model, "financing").rows)).toEqual([]);
      expect(model.cash.differenceMinor).toBe(0);
      expect(sumBridge(model)).toBe(model.cash.changeMinor);
    });

    it("pays no interest in cash when the lender credited the loan on balance: the payments are all principal and the credit stays in the P&L", () => {
      const rows = [salary, entry("credit", "loan", 2_000), ...transfer("repay", "bank", "loan", 12_000)];
      const { model } = fixture(rows, { loanCosts: [{ ...charge, id: "credit", amountMinor: 2_000 }] });
      expect(line(section(model, "operating").rows, "interest")).toBeUndefined();
      const principal = line(section(model, "financing").rows, "principal-net") as ReturnType<typeof section>["rows"][number];
      expect(principal.amountMinor).toBe(-12_000);
      expect(principal.drill).toEqual({ ids: ["repay-to"], amountMinor: 12_000 });
      expect(model.pnl.expensesMinor).toBe(2_000);
      expect(model.cash.differenceMinor).toBe(0);
      expect(sumBridge(model)).toBe(model.cash.changeMinor);
    });

    it("leaves a loan whose lender charges nothing as before: the unsplit payment stays unidentified", () => {
      const { model } = fixture([salary, ...transfer("repay", "bank", "loan", 12_000)]);
      expect(model.unresolved.find((r) => r.key === "loan-allocation")?.amountMinor).toBe(-12_000);
    });
  });
});
