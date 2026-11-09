import { fireEvent, render, screen } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { compositionSeries, monthlyFlows, netWorthSteps } from "@/lib/financial-insights/breakdowns";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { offeredTabs } from "../hooks/useFinancialInsights";
import { WealthTab } from "./WealthTab";
import { TipProvider } from "./charts/Tip";


const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const inv: AccountFact = { id: "inv", name: "Brokerage", accountClass: "investment", treatment: null, offBudget: true };
const house: AccountFact = { id: "house", name: "House", accountClass: "property", treatment: null, offBudget: true };
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });

function data(accounts: AccountFact[], movement: MovementRow[], over: Record<string, unknown> = {}) {
  const f: FinancialFacts = { accounts, incomeCategories: new Set(), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! })), reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
  return { ledger, period, summary, composition: compositionSeries(ledger, period, summary.opening), netWorthChange: netWorthSteps(summary), monthly: monthlyFlows(ledger, period, "2026-11-18", true), review: [], registry: { read: true, assets: [], metadata: [], debtLinks: [], assetEntries: [], assetRowCount: 0, savedClassifications: [] }, ...over } as never;
}
const show = (d: never, onDrill = jest.fn()) => render(<TipProvider><WealthTab data={d} onDrill={onDrill} /></TipProvider>);
const funded = [row("2026-09", "chk", -50_000, { transferAccountId: "inv" }), row("2026-09", "inv", 50_000, { transferAccountId: "chk" }), row("2026-09", "inv", 4_000)];
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

describe("Investments tab states", () => {
  it("draws the portfolio sections, and nothing about property or other assets", () => {
    show(data([chk, inv, house], [...funded, row("2026-09", "house", 100_000)]));
    expect(screen.getByRole("region", { name: "Investment accounts" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Property and asset values" })).not.toBeInTheDocument();
    expect(screen.queryByText("Property equity")).not.toBeInTheDocument();
  });

  it("carries no section headers: each card has its own title", () => {
    show(data([chk, inv], funded));
    expect(screen.queryByRole("heading", { name: "Investments" })).not.toBeInTheDocument();
    expect(screen.queryByText(/What went into and came out of your investment accounts/)).not.toBeInTheDocument();
  });

  it("shows each account's share of the portfolio only when there is more than one account", () => {
    const second: AccountFact = { id: "inv2", name: "Pension", accountClass: "retirement", treatment: null, offBudget: true };
    const { unmount } = show(data([chk, inv], funded));
    expect(screen.queryByRole("columnheader", { name: "Share" })).not.toBeInTheDocument();
    unmount();
    show(data([chk, inv, second], [...funded, row("2026-09", "inv2", 25_000)]));
    expect(screen.getByRole("columnheader", { name: "Share" })).toBeInTheDocument();
  });

  it("opens the transactions behind funding and investment activity, and says investment activity is not a return", () => {
    const onDrill = jest.fn();
    show(data([chk, inv], funded), onDrill);
    fireEvent.click(screen.getByRole("button", { name: /^Brokerage funding \+500\.00/ }));
    expect(onDrill).toHaveBeenCalledWith({ kind: "contributed", accountId: "inv" });
    fireEvent.click(screen.getByRole("button", { name: /^Brokerage investment activity \+40\.00/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "investmentResults", accountId: "inv" });
    expect(screen.getAllByText(/not a return/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\bgain\b|profit/i);
  });
});

describe("all accounts", () => {
  it("is not on this tab: the account list is on the Summary", () => {
    show(data([chk, inv], funded));
    expect(screen.queryByRole("region", { name: "All accounts" })).not.toBeInTheDocument();
  });
});

describe("wealth over time", () => {
  it("draws the Summary's net worth series as a line, with no Line, Bars or Table switch, and leaves the class split to the Summary", () => {
    show(data([chk, inv], funded));
    expect(screen.queryByRole("region", { name: "Where your assets are held" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bars" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Line" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Net worth, everything owned and debts/ })).toBeInTheDocument();
  });
});

describe("offered tabs", () => {
  const names = (accounts: AccountFact[], budget = false) => offeredTabs(accounts, budget).map((t) => t.value);
  it("offers Investments only when the budget holds an investment or retirement account, and My budget only when it can be read", () => {
    expect(names([chk])).toEqual(["summary", "money", "income", "spending", "statements", "progress"]);
    expect(offeredTabs([chk], false).find((tab) => tab.value === "statements")?.label).toBe("Statements");
    expect(names([chk, inv])).toContain("wealth");
    expect(names([chk, house])).not.toContain("wealth");
    expect(names([chk, inv], true)).toEqual(["summary", "money", "income", "spending", "budget", "wealth", "statements", "progress"]);
  });
});

describe("the Investments tiles", () => {
  it("are five figures about the portfolio, not the whole balance sheet", () => {
    const onDrill = jest.fn();
    show(data([chk, inv], funded), onDrill);
    for (const label of ["Investments", "Put in", "Withdrawn", "Investment activity", "Share of your assets"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.queryByText("Total liabilities")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Put into investments 500\.00/ }));
    expect(onDrill).toHaveBeenCalledWith({ kind: "contributed", portfolio: true });
    expect(screen.getByText("Recorded inside: not a return")).toBeInTheDocument();
  });
});
