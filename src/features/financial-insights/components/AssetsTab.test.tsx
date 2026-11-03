import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { compositionSeries, debtRepayments, monthlyFlows, netWorthSteps } from "@/lib/financial-insights/breakdowns";
import { resolvePeriod } from "@/lib/financial-insights/period";
import type { AssetSeries, AssetValueRow } from "@/lib/financial-insights/wealth";
import { offeredTabs } from "../hooks/useFinancialInsights";
import type { WealthLoad } from "../hooks/useWealth";
import { AssetsTab } from "./AssetsTab";
import { TipProvider } from "./charts/Tip";

jest.mock("../hooks/useWealth", () => ({ useWealth: jest.fn() }));
const useWealth = jest.requireMock("../hooks/useWealth").useWealth as jest.Mock;

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const house: AccountFact = { id: "house", name: "House", accountClass: "property", treatment: null, offBudget: true };
const car: AccountFact = { id: "car", name: "Car", accountClass: "vehicle", treatment: null, offBudget: true };
const mortgage: AccountFact = { id: "mortgage", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true };
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });

function data(accounts: AccountFact[], movement: MovementRow[], over: Record<string, unknown> = {}) {
  const f: FinancialFacts = { accounts, incomeCategories: new Set(), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! })), reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0 });
  return { ledger, period, summary, composition: compositionSeries(ledger, period, summary.opening), netWorthChange: netWorthSteps(summary), monthly: monthlyFlows(ledger, period, "2026-11-18", true), review: [], registry: { read: true, assets: [], metadata: [], debtLinks: [], assetEntries: [], assetRowCount: 0, savedClassifications: [] }, ...over } as never;
}

const today = "2026-11-18";
const show = (d: never, onOpenLoans?: () => void) => render(<TipProvider><AssetsTab data={d} today={today} onOpenLoans={onOpenLoans} /></TipProvider>);
const bridge = { openingMinor: 0, capitalMinor: 100_000, revaluationMinor: 25_000, depreciationMinor: -5_000, disposalMinor: 0, otherMinor: 0, closingMinor: 100_000 };
const point = (over: Record<string, unknown> = {}) => ({ assetValueMinor: 100_000, debtMinor: 40_000, equityMinor: 60_000, ltvPercent: 40, gaps: [] as string[], ...over });
const loan = { debtId: "d1", accountId: "mortgage", name: "Mortgage", startDebtMinor: 50_000, endDebtMinor: 40_000 };
const home = (over: Record<string, unknown> = {}): AssetValueRow => ({ kind: "registered", assetId: "a1", name: "Family home", accountId: "house", accountClass: "property", state: "ready", bridge, linked: true, loans: [loan], equity: { start: point({ debtMinor: 50_000, equityMinor: 50_000, ltvPercent: 50 }), end: point() }, ...over } as AssetValueRow);
const series = (over: Partial<AssetSeries> = {}): AssetSeries => ({ months: ["2026-09"], opening: { valueMinor: 0, debtMinor: 50_000, equityMinor: -50_000 }, points: [{ valueMinor: 100_000, debtMinor: 40_000, equityMinor: 60_000 }], assets: 1, linked: 1, ...over });
const ready = (rows: AssetValueRow[], s: AssetSeries = series()): WealthLoad => ({ state: "ready", rows, series: s, hasFailedBooks: false, retryBooks: jest.fn() });
const facts = [row("2026-09", "house", 100_000), row("2026-09", "mortgage", -40_000), row("2026-09", "car", 20_000)];
const all = () => {
  const d = data([chk, house, car, mortgage], facts) as unknown as { ledger: never; period: never };
  return { ...d, debt: debtRepayments(d.ledger, d.period, new Set<string>(), 0), schedules: [] } as never;
};
beforeEach(() => jest.clearAllMocks());

describe("Property & assets", () => {
  it("shows the value from Actual's balances at once, and says it is reading while the registry loads", () => {
    useWealth.mockReturnValue({ state: "loading" });
    show(all());
    expect(screen.getByText("Asset value")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reading asset accounts");
    expect(screen.queryByRole("region", { name: "Value, loan and equity by asset" })).not.toBeInTheDocument();
  });

  it("offers a retry when the linked loans cannot be read", () => {
    const retry = jest.fn();
    useWealth.mockReturnValue({ state: "error", retry });
    show(all());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("states debt, equity and loan-to-value for a linked asset, and draws its value split into the loan and the equity", () => {
    useWealth.mockReturnValue(ready([home()]));
    show(all());
    const tiles = screen.getByRole("region", { name: "Property and assets" });
    expect(tiles).toHaveTextContent("Debt against assets");
    expect(tiles).toHaveTextContent("Loan-to-value");
    expect(screen.getByRole("img", { name: /Family home: value 1,000\.00, owed 400\.00, equity 600\.00/ })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Value, loan and equity by asset" });
    expect(card).toHaveTextContent("Mortgage");
    expect(card).toHaveTextContent("Loan-to-value 40.0%");
  });

  it("draws the value, debt and equity over time, and what changed the value", () => {
    useWealth.mockReturnValue(ready([home()]));
    show(all());
    expect(screen.getByRole("group", { name: /Value of your assets, the debt against them and the equity at each month end/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "What changed the value of your assets" })).toBeInTheDocument();
  });

  it("says Not linked on the tiles that need a loan, for an asset without one", () => {
    useWealth.mockReturnValue(ready([home({ linked: false, loans: [] })], series({ linked: 0, opening: { valueMinor: 0, debtMinor: null, equityMinor: null }, points: [{ valueMinor: 100_000, debtMinor: null, equityMinor: null }] })));
    show(all());
    const tiles = screen.getByRole("region", { name: "Property and assets" });
    // Five tiles always: the three that need a loan say Not linked rather than disappearing.
    for (const label of ["Asset value", "Change in value", "Debt against assets", "Equity", "Loan-to-value"]) expect(tiles).toHaveTextContent(label);
    expect(within(tiles).getAllByText("Not linked")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "Value, loan and equity by asset" })).toHaveTextContent("No loan linked");
    expect(screen.getByText(/No loan is linked to an asset in Assets, so debt and equity are not shown/)).toBeInTheDocument();
  });

  it("shows Unavailable, never zero, when an input for equity is missing", () => {
    const missing = point({ debtMinor: null, equityMinor: null, ltvPercent: null, gaps: ["Actual loan balance is unavailable on that date"] });
    useWealth.mockReturnValue(ready([home({ equity: { start: missing, end: missing } })]));
    show(all());
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Actual loan balance is unavailable/).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Value, loan and equity by asset" })).toHaveTextContent("Equity unavailable");
  });

  it("lists an account that is not in the registry as needing review, with its value", () => {
    useWealth.mockReturnValue(ready([{ kind: "unregistered", accountId: "car", name: "Car", accountClass: "vehicle", openingMinor: 0, closingMinor: 20_000 }], series({ assets: 0, linked: 0 })));
    show(all());
    expect(screen.getByRole("region", { name: "Value, loan and equity by asset" })).toHaveTextContent("Needs review");
    expect(screen.getByRole("region", { name: "Property and asset values" })).toHaveTextContent("Not in the Asset Registry");
    expect(screen.getByRole("link", { name: "Open Assets" })).toBeInTheDocument();
  });

  it("points to Loans & cards for the loans of each asset, when that tab exists", () => {
    useWealth.mockReturnValue(ready([home()]));
    const onOpenLoans = jest.fn();
    show(all(), onOpenLoans);
    fireEvent.click(screen.getByRole("button", { name: "Loans & cards" }));
    expect(onOpenLoans).toHaveBeenCalled();
  });
});

describe("offered tabs for property", () => {
  const names = (accounts: AccountFact[]) => offeredTabs(accounts, false).map((t) => t.value);
  it("offers Property & assets for a fixed asset account, and Investments only for an investment or retirement account", () => {
    expect(names([chk, house])).toContain("property");
    expect(names([chk, house])).not.toContain("wealth");
    expect(names([chk, car])).toContain("property");
    expect(names([chk])).not.toContain("property");
    expect(names([chk, { ...house, accountClass: "investment" }])).toContain("wealth");
  });
  it("does not count a current or non-current Other Asset as a property or asset account", () => {
    const owed: AccountFact = { id: "owed", name: "Owed to me", accountClass: "other-asset", treatment: "current-asset", offBudget: true };
    const gold: AccountFact = { id: "gold", name: "Gold", accountClass: "other-asset", treatment: "fixed-asset", offBudget: true };
    expect(names([chk, owed])).not.toContain("property");
    expect(names([chk, gold])).toContain("property");
  });
});

describe("the Property & assets change in value tile", () => {
  it("adds revaluation and depreciation, and reads Unavailable when no asset could be read", () => {
    useWealth.mockReturnValue(ready([home()]));
    const { unmount } = show(all());
    const tile = screen.getByText("Change in value").closest("div")!;
    expect(tile).toHaveTextContent("+200.00");
    expect(tile).toHaveTextContent("Revaluation +250.00");
    expect(tile).toHaveTextContent("depreciation -50.00");
    unmount();
    useWealth.mockReturnValue(ready([{ kind: "unregistered", accountId: "car", name: "Car", accountClass: "vehicle", openingMinor: 0, closingMinor: 20_000 }], series({ assets: 0, linked: 0 })));
    show(all());
    expect(screen.getByText("Change in value").closest("div")).toHaveTextContent("Unavailable");
  });
});

describe("the Property and asset values table", () => {
  it("leaves out depreciation, disposal and other when nothing uses them, so it fits half the page", () => {
    useWealth.mockReturnValue(ready([home({ bridge: { ...bridge, depreciationMinor: 0 } })]));
    show(all());
    const table = screen.getByRole("region", { name: "Property and asset values" });
    expect(within(table).queryByRole("columnheader", { name: "Depreciation" })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Revaluation" })).toBeInTheDocument();
  });

  it("keeps a column an asset uses", () => {
    useWealth.mockReturnValue(ready([home()]));
    show(all());
    expect(within(screen.getByRole("region", { name: "Property and asset values" })).getByRole("columnheader", { name: "Depreciation" })).toBeInTheDocument();
  });
});
