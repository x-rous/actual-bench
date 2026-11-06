import { buildLedger, summarize, type AccountFact, type FinancialFacts } from "./measures";
import { resolvePeriod } from "./period";
import { buildStatements, statementsCsvRows, type StatementEntry } from "./statements";
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
  { id: "inv", name: "Broker", accountClass: "investment", treatment: "current-investment", offBudget: true },
  { id: "ret", name: "Retirement", accountClass: "retirement", treatment: null, offBudget: true },
  { id: "other", name: "Receivable", accountClass: "other-asset", treatment: "current-asset", offBudget: true },
  { id: "fixed", name: "Collectible", accountClass: "other-asset", treatment: "fixed-asset", offBudget: true },
  { id: "card", name: "Card", accountClass: "credit-card", treatment: null, offBudget: false },
  { id: "loan", name: "Loan", accountClass: "loan", treatment: null, offBudget: true },
  { id: "liability", name: "Payable", accountClass: "other-liability", treatment: "current-liability", offBudget: true },
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
    expect(summarize(ledger, period, { unavailableReason: null, rowCount: 0 }).spent).toBe(50_000);
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
    expect(model.unresolved.find((r) => r.key === "uncategorized")).toMatchObject({ amountMinor: 0, ids: ["unknown-in", "unknown-out"] });
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
    expect(model.unresolved[0].amountMinor).toBe(900);
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

  it("leaves differences visible and exports every subtotal, adjustment and provisional status with exact cents", () => {
    const { ledger } = fixture([entry("income", "bank", 10001, { categoryId: "salary" }), entry("new-start", "bank", 123, { startingBalance: true })]);
    const model = buildStatements({ ledger, period, categories, entries: [], assetEntries: null, savedClassifications: [], basisIssue: "Registry unavailable" });
    expect(model.cash.differenceMinor).toBe(10124); expect(sumBridge(model)).toBe(10124);
    const csv = statementsCsvRows(model, period);
    expect(csv).toContainEqual(["Cash flow", "Balances", "Closing cash", "101.24", "", ""]);
    expect(csv).toContainEqual(["P&L status", "Registry unavailable"]);
    expect(csv.filter((r) => r[2] === "Subtotal")).toHaveLength(3);
    expect(csv.some((r) => r[2] === "Provisional categorized surplus / deficit — needs review")).toBe(true);
  });

  it("drills exact statement membership without excluding transfers or starting balances, and handles long memberships", () => {
    const { ledger } = fixture([]);
    const ctx = { ledger, period, today: "2026-11-06", reclassifiedIds: new Set(["classified"]) };
    const scope = drillScope({ kind: "statement", name: "Evidence", ids: ["opening", "classified", "transfer"], amountMinor: -123 }, ctx);
    expect(scope.constraints.where).toEqual({ id: { $oneof: ["opening", "classified", "transfer"] } });
    expect(scope.constraints.excludeStartingBalance).toBeUndefined(); expect(scope.expectedMinor).toBe(-123);
    const long = drillScope({ kind: "statement", name: "Long", ids: Array.from({ length: 301 }, (_, i) => `row-${i}`), amountMinor: 0 }, ctx);
    expect(long.constraints.where).toBeUndefined();
    expect(long.rowFilter!({ id: "row-300" } as Parameters<NonNullable<typeof long.rowFilter>>[0])).toBe(true);
    expect(long.rowFilter!({ id: "unrelated" } as Parameters<NonNullable<typeof long.rowFilter>>[0])).toBe(false);
  });
});
