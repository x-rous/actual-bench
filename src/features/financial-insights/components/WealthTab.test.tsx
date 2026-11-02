import { fireEvent, render, screen } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { compositionSeries, monthlyFlows, netWorthSteps } from "@/lib/financial-insights/breakdowns";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { offeredTabs } from "../hooks/useFinancialInsights";
import type { WealthLoad } from "../hooks/useWealth";
import { WealthTab } from "./WealthTab";
import { TipProvider } from "./charts/Tip";

jest.mock("../hooks/useWealth", () => ({ useWealth: jest.fn() }));
const useWealth = jest.requireMock("../hooks/useWealth").useWealth as jest.Mock;

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const inv: AccountFact = { id: "inv", name: "Brokerage", accountClass: "investment", treatment: "non-current-investment", offBudget: true };
const house: AccountFact = { id: "house", name: "House", accountClass: "property", treatment: null, offBudget: true };
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });

function data(accounts: AccountFact[], movement: MovementRow[], over: Record<string, unknown> = {}) {
  const f: FinancialFacts = { accounts, incomeCategories: new Set(), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! })), reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0 });
  return { ledger, period, summary, composition: compositionSeries(ledger, period, summary.opening), netWorthChange: netWorthSteps(summary), monthly: monthlyFlows(ledger, period, "2026-11-18", true), review: [], registry: { read: true, assets: [], metadata: [], debtLinks: [], assetEntries: [], assetRowCount: 0, savedClassifications: [] }, ...over } as never;
}
const show = (d: never, onDrill = jest.fn()) => render(<TipProvider><WealthTab data={d} onDrill={onDrill} /></TipProvider>);
const funded = [row("2026-09", "chk", -50_000, { transferAccountId: "inv" }), row("2026-09", "inv", 50_000, { transferAccountId: "chk" }), row("2026-09", "inv", 4_000)];
const ready = (rows: WealthLoad extends infer T ? T extends { state: "ready"; rows: infer R } ? R : never : never): WealthLoad => ({ state: "ready", rows });
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

describe("Wealth & investments tab states", () => {
  it("draws only what exists: no asset sections without an asset account, no portfolio sections without a portfolio", () => {
    useWealth.mockReturnValue(ready([]));
    const { unmount } = show(data([chk, inv], funded));
    expect(screen.getByRole("region", { name: "Investment accounts" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Asset values" })).not.toBeInTheDocument();
    expect(screen.queryByText("Property equity")).not.toBeInTheDocument();
    unmount();
    useWealth.mockReturnValue(ready([{ kind: "unregistered", accountId: "house", name: "House", accountClass: "property", openingMinor: 0, closingMinor: 0 }]));
    show(data([chk, house], [row("2026-09", "house", 100_000)]));
    expect(screen.queryByRole("region", { name: "Investment accounts" })).not.toBeInTheDocument();
    expect(screen.queryByText("Investment activity")).not.toBeInTheDocument();
    expect(screen.getByText("Property equity")).toBeInTheDocument();
  });

  it("opens the transactions behind funding and investment activity, and says investment activity is not a return", () => {
    useWealth.mockReturnValue(ready([]));
    const onDrill = jest.fn();
    show(data([chk, inv], funded), onDrill);
    fireEvent.click(screen.getByRole("button", { name: /^Brokerage funding \+500\.00/ }));
    expect(onDrill).toHaveBeenCalledWith({ kind: "contributed", accountId: "inv" });
    fireEvent.click(screen.getByRole("button", { name: /^Brokerage investment activity \+40\.00/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "investmentResults", accountId: "inv" });
    expect(screen.getAllByText(/not a return/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\bgain\b|profit/i);
  });

  it("shows loading while the asset accounts are read, and Unavailable (never zero) for equity with a missing input", () => {
    useWealth.mockReturnValue({ state: "loading" });
    const { unmount } = show(data([chk, house], [row("2026-09", "house", 100_000)]));
    expect(screen.getByRole("status")).toHaveTextContent("Reading asset accounts");
    unmount();
    const bridge = { openingMinor: 0, capitalMinor: 100_000, revaluationMinor: 0, depreciationMinor: 0, disposalMinor: 0, otherMinor: 0, closingMinor: 100_000 };
    const point = { assetValueMinor: 100_000, debtMinor: null, equityMinor: null, ltvPercent: null, gaps: ["Actual loan balance is unavailable on that date"] };
    useWealth.mockReturnValue(ready([{ kind: "registered", assetId: "a1", name: "Family home", accountId: "house", accountClass: "property", state: "ready", bridge, linked: true, equity: { start: point, end: point } }]));
    show(data([chk, house], [row("2026-09", "house", 100_000)]));
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(1);
    expect(screen.getByText(/Actual loan balance is unavailable/)).toBeInTheDocument();
  });

  it("says Not linked for an asset without a loan", () => {
    const bridge = { openingMinor: 0, capitalMinor: 100_000, revaluationMinor: 0, depreciationMinor: 0, disposalMinor: 0, otherMinor: 0, closingMinor: 100_000 };
    const point = { assetValueMinor: 100_000, debtMinor: 0, equityMinor: 100_000, ltvPercent: 0, gaps: [] };
    useWealth.mockReturnValue(ready([{ kind: "registered", assetId: "a1", name: "Family home", accountId: "house", accountClass: "property", state: "ready", bridge, linked: false, equity: { start: point, end: point } }]));
    show(data([chk, house], [row("2026-09", "house", 100_000)]));
    expect(screen.getAllByText("Not linked").length).toBe(2);
  });
});

describe("wealth over time and where it is held", () => {
  it("draws both cards from the Summary's classes, switches Line, Bars and Table, and ends at net worth", () => {
    useWealth.mockReturnValue(ready([]));
    show(data([chk, inv], funded));
    expect(screen.getByRole("region", { name: "Where your assets are held" })).toHaveTextContent("Investments");
    expect(screen.getByRole("region", { name: "Where your assets are held" })).toHaveTextContent("Net worth");
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Everything owned" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bars" }));
    expect(screen.getByRole("img", { name: /Net worth, everything owned and debts/ })).toBeInTheDocument();
  });
});

describe("where the change came from", () => {
  it("splits what added value from what moved money and reconciles", () => {
    useWealth.mockReturnValue(ready([]));
    show(data([chk, inv], funded));
    const card = screen.getByRole("region", { name: "What changed your net worth" });
    expect(card).toHaveTextContent("What changed your wealth");
    expect(card).toHaveTextContent("What moved money around");
    expect(card).not.toHaveTextContent("Unexplained difference");
    expect(card).toHaveTextContent("Put into investments");
  });
});

describe("offered tabs", () => {
  it("does not count a current or non-current Other Asset as an asset account", () => {
    const owed: AccountFact = { id: "owed", name: "Owed to me", accountClass: "other-asset", treatment: "current-asset", offBudget: true };
    const gold: AccountFact = { id: "gold", name: "Gold", accountClass: "other-asset", treatment: "fixed-asset", offBudget: true };
    expect(offeredTabs([chk, owed], false).map((t) => t.value)).not.toContain("wealth");
    expect(offeredTabs([chk, gold], false).map((t) => t.value)).toContain("wealth");
  });
  const names = (accounts: AccountFact[], budget = false) => offeredTabs(accounts, budget).map((t) => t.value);
  it("offers Wealth & investments only when the budget holds a portfolio or an asset account, and My budget only when it can be read", () => {
    expect(names([chk])).toEqual(["summary", "money", "spending"]);
    expect(names([chk, inv])).toContain("wealth");
    expect(names([chk, house])).toContain("wealth");
    expect(names([chk, inv], true)).toEqual(["summary", "money", "spending", "budget", "wealth"]);
  });
});
