import { fireEvent, render, screen, within } from "@testing-library/react";
import type { LoadedCategory, LoadedMonthState } from "@/features/budget-management/types";
import { buildBudgetPlan, type MonthRead } from "@/lib/financial-insights/budget";
import { MyBudgetTab } from "./MyBudgetTab";
import { TipProvider } from "./charts/Tip";
import type { BudgetPlanLoad } from "../hooks/useBudgetPlan";

jest.mock("../hooks/useBudgetPlan", () => ({ useBudgetPlan: jest.fn() }));
const useBudgetPlan = jest.requireMock("../hooks/useBudgetPlan").useBudgetPlan as jest.Mock;

const today = "2026-11-18";
const expense = (id: string, budgeted: number, spent: number): LoadedCategory => ({ id, name: id, groupId: "G", groupName: "Daily", isIncome: false, hidden: false, budgeted, actuals: 0 - spent, balance: 0, carryover: false });
const month = (m: string, cats: LoadedCategory[]): MonthRead => ({
  month: m, status: "ok",
  state: {
    summary: { month: m, incomeAvailable: 0, lastMonthOverspent: 0, forNextMonth: 0, totalBudgeted: 0 - cats.reduce((a, c) => a + c.budgeted, 0), toBudget: 0, fromLastMonth: 0, totalIncome: 0, totalSpent: cats.reduce((a, c) => a + c.actuals, 0), totalBalance: 0 },
    groupsById: { G: { id: "G", name: "Daily", isIncome: false, hidden: false, categoryIds: cats.map((c) => c.id), budgeted: 0, actuals: 0, balance: 0 } },
    categoriesById: Object.fromEntries(cats.map((c) => [c.id, c])), groupOrder: ["G"], incomeBudgetFallbackIds: [],
  } as LoadedMonthState,
});
const ready = (reads: MonthRead[]): BudgetPlanLoad => ({ state: "ready", plan: buildBudgetPlan({ mode: "tracking", reads, today }) });
const show = () => render(<TipProvider><MyBudgetTab data={{ period: { label: "Last 6 months", startDate: "2026-05-01", endDate: "2026-10-31" } } as never} today={today} mode="tracking" onDrill={onDrill} /></TipProvider>);
const onDrill = jest.fn();
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

describe("My budget tab states", () => {
  it("says which month is being read while the months load", () => {
    useBudgetPlan.mockReturnValue({ state: "loading", done: 3, total: 24 });
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Reading month 4 of 24");
  });

  it("names a month Actual does not have and one that could not be read; figures that need a failed month are Unavailable", () => {
    useBudgetPlan.mockReturnValue(ready([{ month: "2026-08", status: "unavailable" }, month("2026-09", [expense("food", 30_000, 20_000)]), month("2026-10", [expense("food", 30_000, 35_000)])]));
    const { unmount } = show();
    expect(screen.getByText("Not in your budget:").parentElement).toHaveTextContent("Aug 2026");
    expect(screen.getAllByText("Months over budget")[0].parentElement).toHaveTextContent("1 of 2");
    unmount();
    useBudgetPlan.mockReturnValue(ready([month("2026-08", [expense("food", 30_000, 20_000)]), { month: "2026-09", status: "failed" }, month("2026-10", [expense("food", 30_000, 35_000)])]));
    show();
    expect(screen.getAllByText("Unavailable")).toHaveLength(5);
    expect(screen.getAllByText(/Sep 2026 could not be read/).length).toBeGreaterThan(0);
  });

  it("shows an empty-state sentence, not empty charts, when the period has no completed month", () => {
    useBudgetPlan.mockReturnValue(ready([month("2026-11", [expense("food", 30_000, 10_000)])]));
    show();
    expect(screen.getByText("There is no completed budget month to show")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("opens the transactions behind a month's bar, and shows how far over or under budget each month was", () => {
    useBudgetPlan.mockReturnValue(ready([month("2026-09", [expense("food", 30_000, 40_000)]), month("2026-10", [expense("food", 30_000, 20_000)])]));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Spent, Sep 2026" }));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "budgetCell", name: "All categories", month: "2026-09", amountMinor: 40_000 }));
    // September spent 100.00 more than its 300.00 budget; October spent 100.00 less.
    const chart = screen.getByRole("group", { name: /Spent each month against budgeted/ });
    expect(chart).toHaveTextContent("−100");
    expect(chart).toHaveTextContent("+100");
  });

  it("names the colours of the groups' lines as the monthly chart does: green within budget, pale left, red over", () => {
    useBudgetPlan.mockReturnValue(ready([month("2026-09", [expense("food", 30_000, 40_000)]), month("2026-10", [expense("food", 30_000, 20_000)])]));
    show();
    const card = screen.getByRole("region", { name: "Budgeted vs spent by group" });
    expect(card).toHaveTextContent("Spent within budget");
    expect(card).toHaveTextContent("Budget left");
    expect(card).toHaveTextContent("Over budget");
    expect(card).not.toHaveTextContent("Savings");
    expect(card).not.toHaveTextContent("Extra");
  });

  it("opens the transactions behind a heatmap cell and a ranked row", () => {
    useBudgetPlan.mockReturnValue(ready([month("2026-09", [expense("food", 30_000, 40_000)]), month("2026-10", [expense("food", 30_000, 20_000)])]));
    show();
    fireEvent.click(screen.getByRole("button", { name: /Daily, Sep 2026: spent 400\.00 of 300\.00 budgeted, over its budget/ }));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "budgetCell", categoryIds: ["food"], month: "2026-09", amountMinor: 40_000 }));
    fireEvent.click(screen.getByRole("button", { name: /food spent 600\.00/ }));
    expect(onDrill).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "budgetCell", categoryIds: ["food"], month: "2026-09", throughMonth: "2026-10", amountMinor: 60_000 }));
  });
});

describe("My budget by quarter and year", () => {
  const sixMonths = () => ready(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map((m, i) => month(m, [expense("food", 30_000, i < 3 ? 40_000 : 20_000)])));

  it("offers Monthly, Quarterly and Yearly on both cards, monthly at first", () => {
    useBudgetPlan.mockReturnValue(sixMonths());
    show();
    expect(screen.getByRole("region", { name: "Budgeted vs spent, month by month" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Show the budget by" })).getByRole("button", { name: "Quarterly" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Show categories by" })).getByRole("button", { name: "Yearly" })).toBeInTheDocument();
  });

  it("adds a quarter up, judges it like a month, and opens the transactions of its three months", () => {
    useBudgetPlan.mockReturnValue(sixMonths());
    show();
    fireEvent.click(within(screen.getByRole("group", { name: "Show categories by" })).getByRole("button", { name: "Quarterly" }));
    const card = screen.getByRole("region", { name: "Category by quarter: spent against budget" });
    // Q1: 3 × 400 spent against 3 × 300 budgeted; Q2: 3 × 200 against 3 × 300.
    fireEvent.click(within(card).getByRole("button", { name: /Daily, Q1 2026: spent 1,200\.00 of 900\.00 budgeted, over its budget/ }));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "budgetCell", categoryIds: ["food"], month: "2026-01", throughMonth: "2026-03", amountMinor: 120_000 }));
    expect(within(card).getByRole("button", { name: /Daily, Q2 2026: spent 600\.00 of 900\.00 budgeted, under its budget/ })).toBeInTheDocument();
  });

  it("offers the same buttons on the unplanned spending chart, and regroups it on its own", () => {
    useBudgetPlan.mockReturnValue(ready(["2026-01", "2026-02", "2026-03"].map((m) => month(m, [expense("food", 30_000, 40_000), expense("extra", 0, 10_000)]))));
    show();
    expect(screen.getByRole("region", { name: "Unplanned spending by month" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Show unplanned spending by" })).getByRole("button", { name: "Quarterly" }));
    const card = screen.getByRole("region", { name: "Unplanned spending by quarter" });
    expect(within(card).getByRole("group", { name: "Unplanned spending each quarter" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Budgeted vs spent, month by month" })).toBeInTheDocument();
  });

  it("regroups the chart by year and keeps the two cards independent", () => {
    useBudgetPlan.mockReturnValue(sixMonths());
    show();
    fireEvent.click(within(screen.getByRole("group", { name: "Show the budget by" })).getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("region", { name: "Budgeted vs spent, year by year" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Category by month: spent against budget" })).toBeInTheDocument();
  });
});

describe("My budget: budgeted vs spent by group", () => {
  const twoGroups = () => {
    const cat = (id: string, group: string, budgeted: number, spent: number): LoadedCategory => ({ ...expense(id, budgeted, spent), groupId: group, groupName: group });
    const read = (m: string): MonthRead => ({
      month: m, status: "ok",
      state: {
        ...(month(m, []).status === "ok" ? (month(m, []) as { state: LoadedMonthState }).state : ({} as LoadedMonthState)),
        groupsById: { Daily: { id: "Daily", name: "Daily", isIncome: false, hidden: false, categoryIds: ["food", "fun"], budgeted: 0, actuals: 0, balance: 0 }, Home: { id: "Home", name: "Home", isIncome: false, hidden: false, categoryIds: ["rent"], budgeted: 0, actuals: 0, balance: 0 } },
        categoriesById: Object.fromEntries([cat("food", "Daily", 30_000, 40_000), cat("fun", "Daily", 0, 10_000), cat("rent", "Home", 100_000, 90_000)].map((c) => [c.id, c])),
        groupOrder: ["Daily", "Home"],
      } as LoadedMonthState,
    });
    return ready([read("2026-09"), read("2026-10")]);
  };

  it("lists every group with its spent total and its share, and says how each compares with its budget", () => {
    useBudgetPlan.mockReturnValue(twoGroups());
    show();
    const card = screen.getByRole("region", { name: "Budgeted vs spent by group" });
    // Two months: Daily spent 2 × 500 against 2 × 300; Home spent 2 × 900 against 2 × 1,000. Total 2,800.
    expect(card).toHaveTextContent("Daily");
    expect(card).toHaveTextContent("Home");
    expect(within(card).getByRole("button", { name: "Daily 1,000.00. Show the transactions" })).toBeInTheDocument();
    expect(within(card).getByText("35.7%")).toBeInTheDocument();
    expect(card).toHaveTextContent("-400.00");
    expect(card).toHaveTextContent("+200.00");
    expect(within(card).getAllByTitle("Over budget")).toHaveLength(1);
    expect(within(card).getAllByTitle("Under budget")).toHaveLength(1);
    // One row per group: the name, then budgeted, spent, variance and share in their own columns.
    expect(within(card).getByRole("button", { name: /Expand Daily/ }).closest("div")).toHaveTextContent("600.00");
  });

  it("opens a group into its categories, which carry no budget when none was saved", () => {
    useBudgetPlan.mockReturnValue(twoGroups());
    show();
    const card = screen.getByRole("region", { name: "Budgeted vs spent by group" });
    expect(within(card).queryByText("fun")).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /Expand Daily/ }));
    expect(within(card).getByText("fun")).toBeInTheDocument();
    expect(within(card).getByTitle("No budget saved: all of it is extra")).toHaveTextContent("-200.00");
  });

  it("opens the transactions of a group over the completed months", () => {
    useBudgetPlan.mockReturnValue(twoGroups());
    show();
    const card = screen.getByRole("region", { name: "Budgeted vs spent by group" });
    fireEvent.click(within(card).getByRole("button", { name: "Home 1,800.00. Show the transactions" }));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "budgetCell", categoryIds: ["rent"], month: "2026-09", throughMonth: "2026-10", amountMinor: 180_000 }));
  });

  it("no longer has the card about how the budget has changed, and keeps Where the budget was missed", () => {
    useBudgetPlan.mockReturnValue(twoGroups());
    show();
    expect(screen.queryByText(/How your budget has changed|How your budget \(assignments\) has changed/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Where the budget was missed" })).toBeInTheDocument();
  });
});

describe("My budget cards follow the length of the period", () => {
  const months = (count: number) => Array.from({ length: count }, (_, i) => { const t = 2024 * 12 + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; });

  it("open in quarters for a period of two years or more, and in years beyond five", () => {
    useBudgetPlan.mockReturnValue(ready(months(30).map((m) => month(m, [expense("food", 30_000, 20_000), expense("extra", 0, 10_000)]))));
    const { unmount } = show();
    expect(screen.getByRole("region", { name: "Budgeted vs spent, quarter by quarter" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Category by quarter: spent against budget" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Unplanned spending by quarter" })).toBeInTheDocument();
    unmount();
    useBudgetPlan.mockReturnValue(ready(months(72).map((m) => month(m, [expense("food", 30_000, 20_000)]))));
    show();
    expect(screen.getByRole("region", { name: "Budgeted vs spent, year by year" })).toBeInTheDocument();
  });
});

describe("My budget variance tiles", () => {
  it("show the variance signed, green when under budget and red when over", () => {
    useBudgetPlan.mockReturnValue(ready([month("2026-09", [expense("food", 30_000, 20_000)]), month("2026-10", [expense("food", 30_000, 20_000)])]));
    const { unmount } = show();
    const under = screen.getByText("Expense variance").closest("div")!;
    expect(under).toHaveTextContent("+200.00");
    expect(within(under).getByText("+200.00").className).toMatch(/green/);
    unmount();
    useBudgetPlan.mockReturnValue(ready([month("2026-09", [expense("food", 30_000, 40_000)]), month("2026-10", [expense("food", 30_000, 40_000)])]));
    show();
    const over = screen.getByText("Expense variance").closest("div")!;
    expect(over).toHaveTextContent("-200.00");
    expect(within(over).getByText("-200.00").className).toMatch(/red/);
    expect(screen.getAllByText("Months over budget")[0].closest("div")).toHaveTextContent("100.0% over");
  });
});
