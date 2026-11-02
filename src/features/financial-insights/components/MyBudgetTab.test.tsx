import { fireEvent, render, screen } from "@testing-library/react";
import type { LoadedCategory, LoadedMonthState } from "@/features/budget-management/types";
import { buildBudgetPlan, type MonthRead } from "@/lib/financial-insights/budget";
import { MyBudgetTab } from "./MyBudgetTab";
import { TipProvider } from "./charts/Tip";
import type { BudgetPlanLoad } from "../hooks/useBudgetPlan";

jest.mock("../hooks/useBudgetPlan", () => ({ PLAN_MONTH_CAP: 24, useBudgetPlan: jest.fn() }));
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
const ready = (reads: MonthRead[], capped: string | null = null): BudgetPlanLoad => ({ state: "ready", plan: buildBudgetPlan({ mode: "tracking", reads, today }), cappedFrom: capped, periodMonths: reads.length });
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

  it("opens the transactions behind a heatmap cell and a ranked row", () => {
    useBudgetPlan.mockReturnValue(ready([month("2026-09", [expense("food", 30_000, 40_000)]), month("2026-10", [expense("food", 30_000, 20_000)])]));
    show();
    fireEvent.click(screen.getByRole("button", { name: /Daily, Sep 2026: spent 400\.00 of 300\.00 budgeted, over its budget/ }));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "budgetCell", categoryIds: ["food"], month: "2026-09", amountMinor: 40_000 }));
    fireEvent.click(screen.getByRole("button", { name: /food spent 600\.00/ }));
    expect(onDrill).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "budgetCell", categoryIds: ["food"], month: "2026-09", throughMonth: "2026-10", amountMinor: 60_000 }));
  });
});
