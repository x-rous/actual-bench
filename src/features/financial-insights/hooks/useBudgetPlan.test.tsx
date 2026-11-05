import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBudgetPlan } from "./useBudgetPlan";
import type { ReadyData } from "./useFinancialInsights";

jest.mock("@/store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1", budgetSyncId: "budget-1" })),
  selectActiveInstance: jest.fn(),
}));
jest.mock("@/features/budget-management/hooks/useAvailableMonths", () => ({ useAvailableMonths: () => ({ data: undefined, isLoading: false }) }));
jest.mock("@/features/budget-management/lib/monthDataQuery", () => ({
  budgetMonthDataQueryOptions: (_connection: unknown, month: string) => ({ queryKey: ["budget-month-data", "conn-1", month] }),
}));
jest.mock("@/features/budget-management/lib/ensureMonthsData", () => ({ ensureMonthsData: jest.fn() }));
// The plan itself is tested on its own; here it only hands back what was read.
jest.mock("@/lib/financial-insights/budget", () => ({ buildBudgetPlan: ({ reads }: { reads: unknown[] }) => ({ reads }) }));

const { ensureMonthsData } = jest.requireMock("@/features/budget-management/lib/ensureMonthsData") as { ensureMonthsData: jest.Mock };

const monthsOf = (count: number) => Array.from({ length: count }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
const dataFor = (months: string[]) => ({ period: { months }, ledger: {}, breakdown: {} }) as unknown as ReadyData;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
type Reads = { plan: { reads: { month: string; status: string }[] } };

describe("useBudgetPlan", () => {
  afterEach(() => jest.clearAllMocks());

  it("keeps a few months in flight at once, never more than four, and returns them in period order", async () => {
    let running = 0, peak = 0;
    ensureMonthsData.mockImplementation(async (_client, _connection, [month]: string[]) => {
      running += 1; peak = Math.max(peak, running);
      // Later months finish sooner, so an unordered result would show.
      await new Promise((r) => setTimeout(r, 30 - Number(month.slice(5))));
      running -= 1;
      return { monthDataMap: {}, unavailable: [], failed: [] };
    });
    const months = monthsOf(10);
    const { result } = renderHook(() => useBudgetPlan(dataFor(months), "2026-12-15", "envelope"), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect((result.current as unknown as Reads).plan.reads.map((r) => r.month)).toEqual(months);
  });

  it("reports each month's own outcome, so one failed or missing month does not hide the rest", async () => {
    ensureMonthsData.mockImplementation(async (_client, _connection, [month]: string[]) => ({
      monthDataMap: {}, unavailable: month === "2026-02" ? [month] : [], failed: month === "2026-03" ? [month] : [],
    }));
    const { result } = renderHook(() => useBudgetPlan(dataFor(monthsOf(4)), "2026-12-15", "envelope"), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    // Nothing is in the cache here, so the months that did not fail or go missing report "failed" too.
    expect((result.current as unknown as Reads).plan.reads.map((r) => `${r.month}:${r.status}`)).toEqual(["2026-01:failed", "2026-02:unavailable", "2026-03:failed", "2026-04:failed"]);
  });

  it("counts months as they are read, so the progress reaches the total", async () => {
    const release: (() => void)[] = [];
    ensureMonthsData.mockImplementation(() => new Promise((resolve) => release.push(() => resolve({ monthDataMap: {}, unavailable: [], failed: [] }))));
    const { result } = renderHook(() => useBudgetPlan(dataFor(monthsOf(6)), "2026-12-15", "envelope"), { wrapper });
    await waitFor(() => expect(release).toHaveLength(4));
    expect(result.current).toMatchObject({ state: "loading", done: 0, total: 6 });
    release.splice(0).forEach((r) => r());
    await waitFor(() => expect(release).toHaveLength(2));
    expect(result.current).toMatchObject({ state: "loading", done: 4, total: 6 });
    release.splice(0).forEach((r) => r());
    await waitFor(() => expect(result.current.state).toBe("ready"));
  });
});
