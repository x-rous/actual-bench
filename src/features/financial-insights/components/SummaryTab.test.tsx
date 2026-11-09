import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { compositionSeries, debtRepayments, monthlyFlows, netWorthSteps } from "@/lib/financial-insights/breakdowns";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { SummaryTab } from "./SummaryTab";
import { TipProvider } from "./charts/Tip";

jest.mock("../hooks/useCashBufferScenarios", () => ({ useCashBufferScenarios: () => ({ scenarios: [], active: null, loading: false, failed: false, select: jest.fn(), saveScenario: jest.fn(), deleteScenario: jest.fn(), saving: false }) }));
jest.mock("../hooks/useCashBufferSettings", () => ({ useCashBufferSettings: () => ({ settings: { goalMonths: null, averageMonths: 12, method: "average" }, save: jest.fn(), saving: false }) }));

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const inv: AccountFact = { id: "inv", name: "Brokerage", accountClass: "investment", treatment: null, offBudget: true };
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });

function data(accounts: AccountFact[], movement: MovementRow[], over: Record<string, unknown> = {}) {
  const f: FinancialFacts = { accounts, incomeCategories: new Set(), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! })), reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
  return { ledger, period, summary, debt: debtRepayments(ledger, period, new Set(), 0), composition: compositionSeries(ledger, period, summary.opening), netWorthChange: netWorthSteps(summary), monthly: monthlyFlows(ledger, period, "2026-11-18", true), review: [], registry: { read: true, assets: [], metadata: [], debtLinks: [], assetEntries: [], assetRowCount: 0, savedClassifications: [] }, ...over } as never;
}

describe("the Summary's net worth change", () => {
  const show = (movement: MovementRow[]) => render(<TipProvider><SummaryTab data={data([chk, inv], movement, { buffer: { state: "unavailable", reason: "none" }, bufferSpending: [] }) as never} today="2026-11-18" accountNames={new Map()} onDrill={jest.fn()} /></TipProvider>);

  it("draws a bar for net worth at the start and one at the end, with the change as its own figure, and totals what is owned and owed", () => {
    show([row("2026-08", "chk", 50_000), row("2026-09", "chk", 100_000), row("2026-09", "inv", 4_000)]);
    const chart = screen.getByRole("group", { name: "Components of the change in net worth" });
    // The labels are broken over lines in the drawing, so they are compared without the breaks.
    const text = (chart.textContent ?? "").replace(/\s/g, "");
    expect(text).toContain("Networthatthestart");
    expect(text).toContain("Networthattheend");
    expect(text).toContain("500.00");
    expect(text).toContain("1,540.00");
    const card = chart.closest("section") as HTMLElement;
    expect(within(card).getByText("Change").nextElementSibling).toHaveTextContent("+1,040.00");
    expect(screen.queryByRole("group", { name: /Net worth at the start and end of the period, and the change/ })).not.toBeInTheDocument();
    for (const name of ["Total owned", "Total owed", "Net worth"]) expect(screen.getAllByRole("rowheader", { name }).length).toBeGreaterThan(0);
  });

  it("has no start bar, and no change, when the period begins in the budget's first month", () => {
    show([row("2026-09", "chk", 100_000), row("2026-09", "inv", 4_000)]);
    const chart = screen.getByRole("group", { name: "Components of the change in net worth" });
    const text = (chart.textContent ?? "").replace(/\s/g, "");
    expect(text).not.toContain("Networthatthestart");
    expect(text).toContain("Networthattheend");
    expect(within(chart.closest("section") as HTMLElement).getByText("Change").nextElementSibling).toHaveTextContent("-");
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

describe("the Money kept tile and loans", () => {
  const loan: AccountFact = { id: "loan", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true };
  const show = (accounts: AccountFact[], movement: MovementRow[]) => render(<TipProvider><SummaryTab data={data(accounts, movement, { buffer: { state: "unavailable", reason: "none" }, bufferSpending: [] }) as never} today="2026-11-18" accountNames={new Map()} onDrill={jest.fn()} /></TipProvider>);

  it("explains in the (i), not on the tile, that loan principal is not spending and interest is", () => {
    // 5,000.00 received, 1,200.00 paid to the mortgage.
    show([chk, loan], [row("2026-09", "chk", 500_000), row("2026-09", "chk", -120_000, { transferAccountId: "loan" }), row("2026-09", "loan", 120_000, { transferAccountId: "chk" })]);
    expect(screen.queryByText(/paid off loans/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About Money kept" }));
    expect(screen.getByText(/1,200\.00 you paid toward loan principal is not spending/)).toBeInTheDocument();
    expect(screen.getByText(/Interest and fees on your loans are spending and are already in Spent/)).toBeInTheDocument();
  });

  it("says nothing about loans when none was paid", () => {
    show([chk], [row("2026-09", "chk", 500_000)]);
    fireEvent.click(screen.getByRole("button", { name: "About Money kept" }));
    expect(screen.queryByText(/you paid toward loan principal/)).not.toBeInTheDocument();
  });
});
