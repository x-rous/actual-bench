import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { compositionSeries, debtRepayments, monthlyFlows, netWorthSteps } from "@/lib/financial-insights/breakdowns";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { MoneyTab } from "./MoneyTab";
import { SummaryTab } from "./SummaryTab";
import { WealthTab } from "./WealthTab";
import { TipProvider } from "./charts/Tip";

jest.mock("../hooks/useCashBufferScenarios", () => ({ useCashBufferScenarios: () => ({ scenarios: [], active: null, loading: false, failed: false, select: jest.fn(), saveScenario: jest.fn(), deleteScenario: jest.fn(), saving: false }) }));
jest.mock("../hooks/useCashBufferSettings", () => ({ useCashBufferSettings: () => ({ settings: { goalMonths: null, averageMonths: 12, method: "average" }, save: jest.fn(), saving: false }) }));

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const inv: AccountFact = { id: "inv", name: "Brokerage", accountClass: "investment", treatment: "non-current-investment", offBudget: true };
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });
const today = "2026-11-18";

const monthsFrom = (from: string, count: number) => { const [y, m] = from.split("-").map(Number); return Array.from({ length: count }, (_, i) => { const t = y * 12 + (m - 1) + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }); };

/** `count` months ending Oct 2026, with income and spending each month. */
function data(count: number) {
  const months = monthsFrom(monthsFromEnd(count), count);
  const movement = months.flatMap((m): MovementRow[] => [row(m, "chk", 50_000, { categoryId: "pay" }), row(m, "chk", -30_000, { categoryId: "food" }), row(m, "inv", 1_000)]);
  const f: FinancialFacts = { accounts: [chk, inv], incomeCategories: new Set(["pay"]), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: movement.filter((r) => r.amountMinor > 0 && r.accountId === "chk").map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor })), transfersIn: [], reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: months[0], endMonth: "2026-10" }, today, ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
  return { ledger, period, summary, composition: compositionSeries(ledger, period, summary.opening), netWorthChange: netWorthSteps(summary), monthly: monthlyFlows(ledger, period, today, true), debt: debtRepayments(ledger, period, new Set<string>(), 0), schedules: [], review: [], buffer: { state: "unavailable", reason: "none" }, bufferSpending: [], registry: { read: true, assets: [], metadata: [], debtLinks: [] } } as never;
}
function monthsFromEnd(count: number) { const t = 2026 * 12 + 9 - (count - 1); return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }
const ui = (node: React.ReactElement) => render(<TipProvider>{node}</TipProvider>);
const pills = (name: string) => within(screen.getByRole("group", { name }));
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

describe("balances by month, quarter or year", () => {
  it("opens in months for a short period and in quarters for a long one, and the viewer can change it", () => {
    const { unmount } = ui(<SummaryTab data={data(12)} today={today} accountNames={new Map()} onDrill={jest.fn()} />);
    expect(screen.getByRole("region", { name: "What you own and owe, month by month" })).toBeInTheDocument();
    unmount();
    ui(<SummaryTab data={data(36)} today={today} accountNames={new Map()} onDrill={jest.fn()} />);
    expect(screen.getByRole("region", { name: "What you own and owe, quarter by quarter" })).toBeInTheDocument();
    fireEvent.click(pills("Show balances by").getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("region", { name: "What you own and owe, year by year" })).toBeInTheDocument();
    fireEvent.click(pills("Show balances by").getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("region", { name: "What you own and owe, month by month" })).toBeInTheDocument();
  });

  it("opens a six-year period in years", () => {
    ui(<SummaryTab data={data(72)} today={today} accountNames={new Map()} onDrill={jest.fn()} />);
    expect(screen.getByRole("region", { name: "What you own and owe, year by year" })).toBeInTheDocument();
  });

  it("offers the same buttons on Your wealth over time", () => {
    ui(<WealthTab data={data(36)} onDrill={jest.fn()} />);
    expect(screen.getByRole("group", { name: "Show wealth by" })).toBeInTheDocument();
    fireEvent.click(pills("Show wealth by").getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("group", { name: /Net worth, everything owned and debts at each year end/ })).toBeInTheDocument();
  });
});

describe("money in and out by month, quarter or year", () => {
  it("opens in quarters for a long period, and marks the years the period only partly covers", () => {
    ui(<MoneyTab data={data(24)} onDrill={jest.fn()} />);
    const card = screen.getByRole("region", { name: "Money in, money out" });
    expect(within(card).getByRole("group", { name: "Show money in and out by" })).toBeInTheDocument();
    fireEvent.click(pills("Show money in and out by").getByRole("button", { name: "Yearly" }));
    expect(card).toHaveTextContent("2024 and 2026 are partial");
    fireEvent.click(pills("Show money in and out by").getByRole("button", { name: "Monthly" }));
    expect(card).not.toHaveTextContent("is partial");
  });
});

describe("investments and loan principal by month, quarter or year", () => {
  const rich = () => {
    const base = data(24) as unknown as { monthly: { contributed: number; withdrawn: number; repaid: number; borrowed: number }[] };
    base.monthly = base.monthly.map((m, i) => ({ ...m, contributed: i % 3 === 0 ? 1_000 : 0, withdrawn: 0, repaid: 500, borrowed: i === 5 ? 9_000 : 0 }));
    return base as never;
  };

  it("offers its own buttons on each card, opening in quarters for a long period", () => {
    ui(<MoneyTab data={rich()} onDrill={jest.fn()} />);
    expect(screen.getByRole("region", { name: "Investments" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Show investments by" })).getByRole("button", { name: "Quarterly" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "Show payments to loans by" })).getByRole("button", { name: "Quarterly" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the cards independent, and adds the borrowing of a quarter up", () => {
    ui(<MoneyTab data={rich()} onDrill={jest.fn()} />);
    fireEvent.click(pills("Show payments to loans by").getByRole("button", { name: "Yearly" }));
    expect(pills("Show payments to loans by").getByRole("button", { name: "Yearly" })).toHaveAttribute("aria-pressed", "true");
    expect(pills("Show investments by").getByRole("button", { name: "Quarterly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Paid to loans" })).toHaveTextContent("borrowed (received from loans)");
  });
});

describe("the portfolio value card by month, quarter or year", () => {
  it("opens by the length of the period, and the viewer can change it", () => {
    ui(<WealthTab data={data(36)} onDrill={jest.fn()} />);
    expect(pills("Show the portfolio by").getByRole("button", { name: "Quarterly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Portfolio value and changes by quarter" })).toBeInTheDocument();
    fireEvent.click(pills("Show the portfolio by").getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("region", { name: "Portfolio value and changes by year" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /What changed the value of the portfolio in each year/ })).toBeInTheDocument();
  });
});
