import type { AssetDebtLink } from "@/lib/asset-registry/financing";
import { valueBridge } from "@/lib/asset-registry/valueBridge";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow, type ReclassifiedRow } from "./measures";
import { resolvePeriod, type PeriodChoice } from "./period";
import { assetSeries, assetValues, holdings, homeEquity, isFixedAssetAccount, otherOf, portfolioBridge, portfolioMonthly, portfolioSeries, type AssetBook, type BookRow, type LoanRef } from "./wealth";

const accounts: AccountFact[] = [
  { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
  { id: "visa", name: "Visa", accountClass: "credit-card", treatment: null, offBudget: false },
  { id: "inv", name: "Brokerage", accountClass: "investment", treatment: "non-current-investment", offBudget: true },
  { id: "ira", name: "Retirement", accountClass: "retirement", treatment: null, offBudget: true },
  { id: "house", name: "House", accountClass: "property", treatment: null, offBudget: true },
  { id: "car", name: "Car", accountClass: "vehicle", treatment: null, offBudget: true },
  { id: "mortgage", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true },
];
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });
/** Both sides of a transfer; `toMonth` lets the second side fall in another month. */
const both = (month: string, from: string, to: string, amount: number, toMonth = month): MovementRow[] => [row(month, from, -amount, { transferAccountId: to }), row(toMonth, to, amount, { transferAccountId: from })];

function facts(movement: MovementRow[], extra: Partial<FinancialFacts> = {}): FinancialFacts {
  // The positive part of the transfer rows, as the page reads it.
  const transfersIn = movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! }));
  return { accounts, incomeCategories: new Set(["salary"]), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn, reclassified: [], loanCosts: [], ...extra };
}
const choice = (startMonth: string, endMonth: string): PeriodChoice => ({ kind: "custom", startMonth, endMonth });
const setup = (f: FinancialFacts, c = choice("2026-09", "2026-09")) => { const ledger = buildLedger(f); return { ledger, period: resolvePeriod(c, "2026-11-18", ledger.firstMonth) }; };
const start = (accountId: string, amountMinor: number, month = "2026-01") => ({ month, accountId, amountMinor });

/** What the lines of a bridge add up to; equal to its closing value unless something is unexplained. */
const bridgeLines = (s: { funding: number; withdrawals: number; between: number; activity: number; openingBalances: number }) => s.funding + s.withdrawals + s.between + s.activity + s.openingBalances;

describe("portfolio bridge", () => {
  it("closes with nothing unexplained over funding, a withdrawal, investment activity, a categorized fee (left in Other) and an account opened in the period", () => {
    const movement = [
      ...both("2026-09", "chk", "inv", 500_000),
      ...both("2026-09", "inv", "chk", 100_000),
      row("2026-09", "inv", 40_000),
      row("2026-09", "inv", -1_500, { categoryId: "fees" }),
      row("2026-09", "ira", 70_000, { transferAccountId: "chk" }),
    ];
    const { ledger, period } = setup(facts(movement, { startingBalances: [start("inv", 1_000_000, "2026-08"), start("ira", 300_000, "2026-09")] }));
    const { accounts: rows, total } = portfolioBridge(ledger, period);
    const inv = rows.find((a) => a.accountId === "inv")!;
    expect(inv).toMatchObject({ opening: 1_000_000, funding: 500_000, withdrawals: -100_000, activity: 40_000, between: 0, openingBalances: 0, unexplained: -1_500 });
    expect(inv.closing).toBe(1_438_500);
    // The categorized fee is on no line of its own: it is left in Other, so it can never be missed.
    expect(otherOf(inv)).toBe(-1_500);
    expect(rows.find((a) => a.accountId === "ira")).toMatchObject({ opening: 0, openingBalances: 300_000, funding: 70_000, closing: 370_000, unexplained: 0 });
    expect(total.closing - total.opening).toBe(bridgeLines(total) + total.unexplained);
    expect(total.funding).toBe(570_000);
  });

  it("agrees with Money in & out: funding and withdrawals from cash accounts are what the cash bridge calls put into and withdrawn", () => {
    const { ledger, period } = setup(facts([...both("2026-09", "chk", "inv", 500_000), ...both("2026-09", "inv", "chk", 100_000)]));
    const { total } = portfolioBridge(ledger, period);
    const cash = summarize(ledger, period, { unavailableReason: null, rowCount: 0 }).cashBridge;
    expect(total.fundingFromCash).toBe(0 - cash.investmentOut);
    expect(total.withdrawalsToCash).toBe(0 - cash.investmentIn);
  });

  it("keeps a contribution and a withdrawal in one month apart, and counts a card or an excluded account as outside money", () => {
    const f = facts([...both("2026-09", "chk", "inv", 300_000), ...both("2026-09", "inv", "chk", 80_000), ...both("2026-09", "visa", "inv", 20_000), row("2026-09", "inv", 10_000, { transferAccountId: "scratch" })], { excluded: new Set(["scratch"]) });
    const { total } = portfolioBridge(setup(f).ledger, setup(f).period);
    expect(total).toMatchObject({ funding: 330_000, withdrawals: -80_000, fundingFromExcluded: 10_000, fundingFromCash: 300_000, withdrawalsToCash: -80_000 });
  });

  it("cancels a transfer between two portfolio accounts, and shows it when only one side falls in the period", () => {
    const same = setup(facts(both("2026-09", "inv", "ira", 50_000)));
    expect(portfolioBridge(same.ledger, same.period).total).toMatchObject({ funding: 0, withdrawals: 0, between: 0 });
    expect(portfolioBridge(same.ledger, same.period).accounts.map((a) => a.between).sort()).toEqual([-50_000, 50_000]);
    const split = setup(facts(both("2026-09", "inv", "ira", 50_000, "2026-10")));
    const bridge = portfolioBridge(split.ledger, split.period).total;
    expect(bridge).toMatchObject({ funding: 0, withdrawals: 0, between: -50_000, unexplained: 0 });
  });

  it("reads an uncategorized row of an on-budget investment account as income or spending, not investment activity", () => {
    const f = facts([row("2026-09", "inv2", 12_000), row("2026-09", "inv2", 3_000, { categoryId: "salary" })], { accounts: [...accounts, { id: "inv2", name: "Savings plan", accountClass: "investment", treatment: "current-investment", offBudget: false }] });
    const { accounts: rows } = portfolioBridge(setup(f).ledger, setup(f).period);
    expect(rows.find((a) => a.accountId === "inv2")).toMatchObject({ activity: 0, unexplained: 15_000 });
  });

  it("shows a genuine difference as Unexplained instead of forcing it to zero", () => {
    const { ledger, period } = setup(facts([row("2026-09", "inv", 40_000)]));
    const off = { ...ledger, balanceAt: (id: string, month: string) => ledger.balanceAt(id, month) + (id === "inv" && month === "2026-09" ? 7_000 : 0) };
    const { total } = portfolioBridge(off, period);
    expect(total.unexplained).toBe(7_000);
    expect(total.closing - total.opening).toBe(bridgeLines(total) + 7_000);
  });
});

describe("a registry-classified row in a portfolio account", () => {
  it("is not investment activity, as on Money in & out, and is left in Other so the drill and the bridge agree", () => {
    const reclassified: ReclassifiedRow[] = [{ id: "s1", payeeId: null, month: "2026-09", accountId: "inv", categoryId: null, amountMinor: -9_000, to: "assetSale" }];
    const { ledger, period } = setup(facts([row("2026-09", "inv", 40_000), row("2026-09", "inv", -9_000)], { reclassified }));
    const { total } = portfolioBridge(ledger, period);
    expect(total.activity).toBe(40_000);
    expect(otherOf(total)).toBe(-9_000);
    expect(summarize(ledger, period, { unavailableReason: null, rowCount: 0 }).flows.investmentResults).toBe(40_000);
  });
});

describe("fixed asset accounts", () => {
  it("are Property, Vehicle, and an Other Asset marked Fixed asset; a current or non-current Other Asset is not an asset here", () => {
    const other = (treatment: AccountFact["treatment"]) => ({ accountClass: "other-asset" as const, treatment });
    expect(isFixedAssetAccount({ accountClass: "property", treatment: null })).toBe(true);
    expect(isFixedAssetAccount({ accountClass: "vehicle", treatment: null })).toBe(true);
    expect(isFixedAssetAccount(other("fixed-asset"))).toBe(true);
    expect(isFixedAssetAccount(other("current-asset"))).toBe(false);
    expect(isFixedAssetAccount(other("non-current-asset"))).toBe(false);
    expect(isFixedAssetAccount({ accountClass: "investment", treatment: "non-current-investment" })).toBe(false);
  });

  it("leave a current Other Asset out of the unregistered asset rows", () => {
    const owed: AccountFact = { id: "owed", name: "Owed to me", accountClass: "other-asset", treatment: "current-asset", offBudget: true };
    const gold: AccountFact = { id: "gold", name: "Gold", accountClass: "other-asset", treatment: "fixed-asset", offBudget: true };
    const { ledger, period } = setup(facts([row("2026-09", "owed", 5_000), row("2026-09", "gold", 9_000)], { accounts: [...accounts, owed, gold] }));
    const rows = assetValues({ ledger, period, assets: [], books: new Map(), links: [], loans: [] });
    expect(rows.filter((r) => r.kind === "unregistered").map((r) => r.name).sort()).toEqual(["Car", "Gold", "House"]);
  });
});

describe("portfolio value by month", () => {
  it("gives the month-end value per account, unavailable before the budget has data", () => {
    const { ledger, period } = setup(facts([row("2026-08", "inv", 100_000), row("2026-09", "inv", 25_000), row("2026-10", "inv", -5_000)]), choice("2026-07", "2026-10"));
    const s = portfolioSeries(ledger, period);
    expect(s.accounts.map((a) => [a.name, a.values])).toEqual([["Brokerage", [null, 100_000, 125_000, 120_000]]]);
    expect(s.totals).toEqual([null, 100_000, 125_000, 120_000]);
  });
});

describe("portfolio changes by month", () => {
  it("shows in which month funding, a withdrawal and investment activity happened, and the months add up to the period", () => {
    const f = facts([...both("2026-08", "chk", "inv", 100_000), row("2026-08", "inv", 5_000), ...both("2026-09", "inv", "chk", 30_000), row("2026-10", "inv", 2_000)]);
    const { ledger, period } = setup(f, choice("2026-08", "2026-10"));
    const months = portfolioMonthly(ledger, period);
    expect(months.map((m) => [m.funding, m.withdrawals, m.activity])).toEqual([[100_000, 0, 5_000], [0, -30_000, 0], [0, 0, 2_000]]);
    expect(months.map((m) => m.unexplained)).toEqual([0, 0, 0]);
    const whole = portfolioBridge(ledger, period).total;
    expect(months.reduce((a, m) => a + m.funding, 0)).toBe(whole.funding);
    expect(months.reduce((a, m) => a + m.activity, 0)).toBe(whole.activity);
    expect(months[2].closing - months[0].opening).toBe(whole.closing - whole.opening);
  });
});

describe("everything you own and owe", () => {
  it("lists every account once, with liabilities negative, and adds up to Summary's net worth", () => {
    const f = facts([row("2026-09", "chk", 100_000), row("2026-09", "visa", -20_000)], { startingBalances: [start("inv", 500_000), start("house", 30_000_000), start("mortgage", -20_000_000)] });
    const { ledger, period } = setup(f);
    const own = holdings(ledger, period);
    const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0 });
    expect(own.netWorth).toEqual({ openingMinor: summary.netWorth.opening, closingMinor: summary.netWorth.closing });
    expect(own.groups.flatMap((g) => g.rows).length).toBe(accounts.length);
    expect(own.groups.find((g) => g.key === "loans")).toMatchObject({ closingMinor: -20_000_000 });
    expect(own.groups.find((g) => g.key === "cards")).toMatchObject({ closingMinor: -20_000, changeMinor: -20_000 });
  });
});

describe("asset values, equity and loan-to-value", () => {
  const rows: BookRow[] = [
    { assetId: "a1", date: "2026-01-01", classification: "opening-balance", amountMinor: 30_000_000 },
    { assetId: "a1", date: "2026-09-10", classification: "revaluation", amountMinor: 2_000_000 },
    { assetId: "a1", date: "2026-09-20", classification: "added-capital", amountMinor: 500_000 },
    { assetId: "a1", date: "2026-10-05", classification: "revaluation", amountMinor: 900_000 },
  ];
  const book = new Map<string, AssetBook | null>([["house", { available: true, rows }]]);
  const assets = [{ id: "a1", name: "Family home", actualAccountId: "house", status: "active" }];
  const links: AssetDebtLink[] = [{ assetId: "a1", debtId: "d1", allocationBps: 10000, effectiveFrom: "2026-01-01", effectiveTo: null, note: null }];
  const loans: LoanRef[] = [{ debtId: "d1", accountId: "mortgage", signConvention: "negative-is-debt" }];
  const ledgerFacts = facts([row("2026-09", "house", 2_500_000), row("2026-10", "house", 900_000)], { startingBalances: [start("house", 30_000_000), start("mortgage", -20_000_000), start("car", 800_000)] });
  const { ledger, period } = setup(ledgerFacts);
  const run = (over: Partial<Parameters<typeof assetValues>[0]> = {}) => assetValues({ ledger, period, assets, books: book, links, loans, ...over });

  it("is the Asset Registry's own value bridge over the rows it attributes to the asset, with equity and loan-to-value", () => {
    const [home] = run();
    if (home.kind !== "registered" || home.state !== "ready") throw new Error("expected a ready asset");
    expect(home.bridge).toEqual(valueBridge(rows, period.startDate, period.endDate));
    expect(home.bridge).toMatchObject({ openingMinor: 30_000_000, capitalMinor: 500_000, revaluationMinor: 2_000_000, closingMinor: 32_500_000 });
    expect(home.equity.end).toMatchObject({ assetValueMinor: 32_500_000, debtMinor: 20_000_000, equityMinor: 12_500_000, ltvPercent: 61.5 });
    expect(home.equity.start).toMatchObject({ equityMinor: 10_000_000 });
    expect(homeEquity(run())).toMatchObject({ state: "ready", endMinor: 12_500_000, startMinor: 10_000_000, ltvPercent: 61.5 });
  });

  it("lists the linked loans with what is owed at the start and the end", () => {
    const [home] = run();
    if (home.kind !== "registered") throw new Error("expected a registered asset");
    expect(home.loans).toEqual([{ debtId: "d1", accountId: "mortgage", name: "Mortgage", startDebtMinor: 20_000_000, endDebtMinor: 20_000_000 }]);
  });

  it("follows value, debt and equity month by month, ending on the table's own end figures", () => {
    const series = assetSeries({ ledger, period, assets, books: book, links, loans });
    const [home] = run();
    if (home.kind !== "registered" || home.state !== "ready") throw new Error("expected a ready asset");
    expect(series.assets).toBe(1);
    expect(series.linked).toBe(1);
    expect(series.opening).toEqual({ valueMinor: 30_000_000, debtMinor: 20_000_000, equityMinor: 10_000_000 });
    const last = series.points[series.points.length - 1];
    expect(last).toEqual({ valueMinor: home.equity.end.assetValueMinor, debtMinor: home.equity.end.debtMinor, equityMinor: home.equity.end.equityMinor });
    expect(series.points).toHaveLength(period.months.length);
  });

  it("leaves debt and equity out when no loan is linked, and counts only assets that could be read", () => {
    expect(assetSeries({ ledger, period, assets, books: book, links: [], loans }).points.every((p) => p.debtMinor === null && p.equityMinor === null)).toBe(true);
    const none = assetSeries({ ledger, period, assets, books: new Map([["house", { available: false, rows: [] }]]), links, loans });
    expect(none.assets).toBe(0);
    expect(none.points.every((p) => p.valueMinor === 0 && p.equityMinor === null)).toBe(true);
  });

  it("is unavailable, never zero, when a loan balance is missing, and says Not linked without a link", () => {
    expect(homeEquity(run({ loans: [] }))).toMatchObject({ state: "unavailable" });
    expect(homeEquity(run({ links: [] }))).toEqual({ state: "notLinked" });
    const noLoanAccount = setup(facts([], { accounts: accounts.filter((a) => a.id !== "mortgage"), startingBalances: [start("house", 30_000_000)] }));
    expect(homeEquity(assetValues({ ledger: noLoanAccount.ledger, period: noLoanAccount.period, assets, books: book, links, loans }))).toMatchObject({ state: "unavailable" });
  });

  it("marks an account that could not be read, or does not reconcile, as unavailable with its closing value; unregistered accounts show opening and closing", () => {
    const unreadable = run({ books: new Map([["house", { available: false, rows: [] }]]) });
    expect(unreadable[0]).toMatchObject({ kind: "registered", state: "unavailable", openingMinor: 30_000_000, closingMinor: 32_500_000 });
    expect(unreadable[1]).toMatchObject({ kind: "unregistered", name: "Car", openingMinor: 800_000, closingMinor: 800_000 });
    const tooBig = run({ books: new Map([["house", null]]), unreadable: new Map([["house", "too many entries"]]) });
    expect(tooBig[0]).toMatchObject({ state: "unavailable", reason: "too many entries" });
  });
});

describe("assets held in an Other Asset account whose treatment is no longer fixed", () => {
  it("is listed as unavailable, not dropped, because it is not a fixed asset any more", () => {
    const other = { id: "gold", name: "Gold", accountClass: "other-asset" as const, treatment: "current-asset" as const, offBudget: true };
    const fixed = { ...other, treatment: "fixed-asset" as const };
    const regAsset = [{ id: "g1", name: "Gold bar", actualAccountId: "gold", status: "active" }];
    const { ledger: l1, period: p1 } = setup(facts([row("2026-09", "gold", 100_000)], { accounts: [accounts[0], other] }));
    const dropped = assetValues({ ledger: l1, period: p1, assets: regAsset, books: new Map([["gold", { available: true, rows: [] }]]), links: [{ assetId: "g1", debtId: "d1", allocationBps: 10000, effectiveFrom: "2026-01-01", effectiveTo: null, note: null }], loans: [] }).filter((r) => r.kind === "registered");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ state: "unavailable", linked: true, closingMinor: 100_000 });
    expect(homeEquity(assetValues({ ledger: l1, period: p1, assets: regAsset, books: new Map(), links: [{ assetId: "g1", debtId: "d1", allocationBps: 10000, effectiveFrom: "2026-01-01", effectiveTo: null, note: null }], loans: [] }))).toMatchObject({ state: "unavailable" });
    const { ledger: l2, period: p2 } = setup(facts([row("2026-09", "gold", 100_000)], { accounts: [accounts[0], fixed] }));
    expect(assetValues({ ledger: l2, period: p2, assets: regAsset, books: new Map([["gold", { available: true, rows: [] }]]), links: [], loans: [] }).some((r) => r.kind === "registered")).toBe(true);
  });
});
