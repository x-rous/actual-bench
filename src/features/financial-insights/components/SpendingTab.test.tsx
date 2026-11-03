import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { monthlyFlows, spendingBreakdown, spendingFacts, spendingGroups, type CategoryInfo } from "@/lib/financial-insights/breakdowns";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { SpendingTab } from "./SpendingTab";
import { TipProvider } from "./charts/Tip";

jest.mock("../hooks/useFinancialInsights", () => ({ usePayeeSpending: () => ({ payees: null, isLoading: true, isError: false, retry: jest.fn() }) }));

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const food: CategoryInfo = { id: "food", name: "Groceries", groupName: "Food", hidden: false, isIncome: false, order: 0 };
const row = (month: string, amountMinor: number): MovementRow => ({ month, accountId: "chk", categoryId: "food", transferAccountId: null, amountMinor, count: 1 });
const today = "2026-11-18";

/** Nov 2025 to Oct 2026: two partial quarters (Q4 2025 holds Nov and Dec only) and a whole year of months. */
function data() {
  const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const f: FinancialFacts = { accounts: [chk], incomeCategories: new Set(), movement: months.map((m) => row(m, -10_000)), excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: [], reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: "2025-11", endMonth: "2026-10" }, today, ledger.firstMonth);
  const monthly = monthlyFlows(ledger, period, today, true);
  const categories = new Map([[food.id, food]]);
  const breakdown = spendingBreakdown(ledger, period, categories, monthly);
  return { ledger, period, summary: summarize(ledger, period, { unavailableReason: null, rowCount: 0 }), monthly, breakdown, spending: spendingFacts(breakdown, monthly), groups: spendingGroups(breakdown) } as never;
}
const show = (onDrill = jest.fn()) => render(<TipProvider><SpendingTab data={data()} today={today} onDrill={onDrill} /></TipProvider>);
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

describe("Spending by month, quarter or year", () => {
  it("reads monthly at first, and offers quarterly and yearly on both cards", () => {
    show();
    expect(screen.getByRole("region", { name: "Spending each month" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Category by month" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Show spending by" })).toHaveTextContent("Mo");
    expect(within(screen.getByRole("group", { name: "Show spending by" })).getByRole("button", { name: "Quarterly" })).toHaveTextContent("Qtr");
    expect(screen.getByRole("group", { name: "Show categories by" })).toHaveTextContent("Yr");
  });

  it("regroups the spending chart by quarter, marking the quarters the period only partly covers", () => {
    show();
    fireEvent.click(within(screen.getByRole("group", { name: "Show spending by" })).getByRole("button", { name: "Quarterly" }));
    const card = screen.getByRole("region", { name: "Spending each quarter" });
    expect(card).toHaveTextContent("Q4 2025 and Q4 2026");
    expect(screen.getByRole("group", { name: "Spending each quarter" })).toBeInTheDocument();
  });

  it("regroups the category table by year, with the whole-year total and the transactions of the year", () => {
    const onDrill = jest.fn();
    show(onDrill);
    fireEvent.click(within(screen.getByRole("group", { name: "Show categories by" })).getByRole("button", { name: "Yearly" }));
    const card = screen.getByRole("region", { name: "Category by year" });
    expect(card).toHaveTextContent("2025*");
    expect(card).toHaveTextContent("2026*");
    expect(within(card).getByRole("button", { name: /Food, 2025: 200\.00/ })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /Food, 2026: 1,000\.00/ }));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "category", month: "2026-01", throughMonth: "2026-10", amountMinor: 100_000 }));
  });

  it("keeps the two cards independent", () => {
    show();
    fireEvent.click(within(screen.getByRole("group", { name: "Show spending by" })).getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("region", { name: "Spending each year" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Category by month" })).toBeInTheDocument();
  });
});

describe("Spending cards follow the length of the period", () => {
  it("opens in quarters for a long period", () => {
    const months = Array.from({ length: 30 }, (_, i) => { const t = 2024 * 12 + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; });
    const f: FinancialFacts = { accounts: [chk], incomeCategories: new Set(), movement: months.map((m) => row(m, -10_000)), excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: [], reclassified: [], loanCosts: [] };
    const ledger = buildLedger(f);
    const period = resolvePeriod({ kind: "custom", startMonth: months[0], endMonth: months[months.length - 1] }, "2026-11-18", ledger.firstMonth);
    const monthly = monthlyFlows(ledger, period, "2026-11-18", true);
    const breakdown = spendingBreakdown(ledger, period, new Map([[food.id, food]]), monthly);
    render(<TipProvider><SpendingTab data={{ ledger, period, summary: summarize(ledger, period, { unavailableReason: null, rowCount: 0 }), monthly, breakdown, spending: spendingFacts(breakdown, monthly), groups: spendingGroups(breakdown) } as never} today="2026-11-18" onDrill={jest.fn()} /></TipProvider>);
    expect(screen.getByRole("region", { name: "Spending each quarter" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Category by quarter" })).toBeInTheDocument();
  });
});
