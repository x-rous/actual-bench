import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { compositionSeries, monthlyFlows, netWorthSteps } from "@/lib/financial-insights/breakdowns";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { SummaryTab } from "./SummaryTab";
import { TipProvider } from "./charts/Tip";

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const inv: AccountFact = { id: "inv", name: "Brokerage", accountClass: "investment", treatment: "non-current-investment", offBudget: true };
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });

function data(accounts: AccountFact[], movement: MovementRow[], over: Record<string, unknown> = {}) {
  const f: FinancialFacts = { accounts, incomeCategories: new Set(), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! })), reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0 });
  return { ledger, period, summary, composition: compositionSeries(ledger, period, summary.opening), netWorthChange: netWorthSteps(summary), monthly: monthlyFlows(ledger, period, "2026-11-18", true), review: [], registry: { read: true, assets: [], metadata: [], debtLinks: [], assetEntries: [], assetRowCount: 0, savedClassifications: [] }, ...over } as never;
}

describe("the Summary's net worth change", () => {
  it("states the start, the change and the end, and totals what is owned and owed", () => {
    const d = data([chk, inv], [row("2026-09", "chk", 100_000), row("2026-09", "inv", 4_000)], { buffer: { state: "unavailable", reason: "none" }, bufferSpending: [] });
    render(<TipProvider><SummaryTab data={d as never} today="2026-11-18" accountNames={new Map()} onDrill={jest.fn()} /></TipProvider>);
    const strip = screen.getByRole("group", { name: /Net worth at the start and end of the period, and the change/ });
    expect(strip).toHaveTextContent("Start");
    expect(strip).toHaveTextContent("Change");
    expect(strip).toHaveTextContent("End");
    for (const name of ["Total owned", "Total owed", "Net worth"]) expect(screen.getAllByRole("rowheader", { name }).length).toBeGreaterThan(0);
    expect(within(strip).getAllByText(/\d/).length).toBeGreaterThan(2);
  });
});

describe("the Summary's start and end card", () => {
  const dataWith = () => data([chk, inv, { id: "idle", name: "Idle account", accountClass: "bank", treatment: null, offBudget: false } as AccountFact], [row("2026-09", "chk", 100_000), row("2026-09", "inv", 4_000)], { buffer: { state: "unavailable", reason: "none" }, bufferSpending: [] });
  const open = () => render(<TipProvider><SummaryTab data={dataWith() as never} today="2026-11-18" accountNames={new Map()} onDrill={jest.fn()} /></TipProvider>);

  it("starts collapsed, shows a class's accounts largest first when opened, and keeps the totals", () => {
    open();
    expect(screen.queryByRole("rowheader", { name: /Checking/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cash & bank: show accounts" }));
    expect(screen.getByRole("rowheader", { name: /Checking/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cash & bank: hide accounts" }));
    expect(screen.queryByRole("rowheader", { name: /Checking/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("rowheader", { name: "Net worth" }).length).toBeGreaterThan(0);
  });

  it("leaves out accounts with no balance at the start or the end, and says how many", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cash & bank: show accounts" }));
    expect(screen.queryByRole("rowheader", { name: /Idle account/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 account with no balance at the start or the end is not listed/)).toBeInTheDocument();
  });

  it("offers no expander for a class with no accounts", () => {
    open();
    expect(screen.queryByRole("button", { name: /^Loans: / })).not.toBeInTheDocument();
  });
});
