import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import {
  MonthsDataProvider,
  useEffectiveCategory,
  useMonthsStructure,
} from "./MonthsDataContext";
import type { LoadedCategory, LoadedMonthState } from "../types";

const mockGetBudgetMonth = jest.fn();
jest.mock("@/lib/actual", () => ({
  getTransport: () => ({ getBudgetMonth: (month: string) => mockGetBudgetMonth(month) }),
}));
jest.mock("@/store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1" })),
  selectActiveInstance: jest.fn(),
}));
jest.mock("../hooks/useBudgetMode", () => ({
  useBudgetMode: () => ({ data: "envelope" }),
}));
jest.mock("../hooks/useIncomeBudgets", () => ({
  useIncomeBudgets: () => ({ data: undefined }),
}));

function category(id: string, budgeted: number): LoadedCategory {
  return {
    id,
    name: id,
    groupId: "g1",
    groupName: "Group",
    isIncome: false,
    hidden: false,
    budgeted,
    actuals: 0,
    balance: budgeted,
    carryover: false,
  };
}

function monthState(month: string): LoadedMonthState {
  return {
    summary: {
      month,
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: 0,
      toBudget: 1000,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: 0,
      totalBalance: 0,
    },
    groupsById: {
      g1: {
        id: "g1",
        name: "Group",
        isIncome: false,
        hidden: false,
        categoryIds: ["a", "b"],
        budgeted: 200,
        actuals: 0,
        balance: 200,
      },
    },
    categoriesById: { a: category("a", 100), b: category("b", 100) },
    groupOrder: ["g1"],
    incomeBudgetFallbackIds: [],
  };
}

describe("MonthsDataProvider re-renders (P1)", () => {
  beforeEach(() => useBudgetEditsStore.getState().discardAll());

  it("re-renders only the cells whose figures change", () => {
    const months = ["2026-01", "2026-02"];
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    for (const m of months) {
      client.setQueryData(["budget-month-data", "conn-1", m], monthState(m));
    }

    const renders: Record<string, number> = {};
    function Cell({ month, id }: { month: string; id: string }) {
      const cat = useEffectiveCategory(month, id);
      const key = `${month}:${id}`;
      renders[key] = (renders[key] ?? 0) + 1;
      return <span data-testid={key}>{cat?.budgeted}</span>;
    }
    let shellRenders = 0;
    function Shell() {
      useMonthsStructure();
      shellRenders++;
      return (
        <>
          {months.flatMap((m) =>
            ["a", "b"].map((id) => <Cell key={`${m}:${id}`} month={m} id={id} />)
          )}
        </>
      );
    }

    const view = render(
      <QueryClientProvider client={client}>
        <MonthsDataProvider months={months} availableMonths={months}>
          <Shell />
        </MonthsDataProvider>
      </QueryClientProvider>
    );
    const before = { ...renders };
    const shellBefore = shellRenders;

    // Stage Jan "a": Jan "a" changes, and its balance carries into Feb "a".
    act(() => {
      useBudgetEditsStore.getState().stageEdit({
        month: "2026-01",
        categoryId: "a",
        nextBudgeted: 150,
        previousBudgeted: 100,
        source: "manual",
      });
    });
    expect(view.getByTestId("2026-01:a").textContent).toBe("150");
    expect(renders["2026-01:a"]).toBeGreaterThan(before["2026-01:a"]!);
    expect(renders["2026-02:a"]).toBeGreaterThan(before["2026-02:a"]!);
    expect(renders["2026-01:b"]).toBe(before["2026-01:b"]);
    expect(renders["2026-02:b"]).toBe(before["2026-02:b"]);
    expect(shellRenders).toBe(shellBefore);

    // A second edit elsewhere must not re-render Feb "a", whose carried
    // figures are unchanged (structural sharing).
    const afterFirst = { ...renders };
    act(() => {
      useBudgetEditsStore.getState().stageEdit({
        month: "2026-02",
        categoryId: "b",
        nextBudgeted: 120,
        previousBudgeted: 100,
        source: "manual",
      });
    });
    expect(renders["2026-02:b"]).toBeGreaterThan(afterFirst["2026-02:b"]!);
    expect(renders["2026-02:a"]).toBe(afterFirst["2026-02:a"]);
    expect(renders["2026-01:a"]).toBe(afterFirst["2026-01:a"]);
  });
});

describe("MonthsDataProvider Envelope carry", () => {
  beforeEach(() => useBudgetEditsStore.getState().discardAll());

  it("replays an edit in a month before the window with Actual's rules", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    // March: "a" overspent by 80 (not rollover). April: balance 0.
    const march = monthState("2026-03");
    march.categoriesById.a = { ...category("a", 0), actuals: -80, balance: -80 };
    const april = monthState("2026-04");
    april.categoriesById.a = { ...category("a", 0), balance: 0 };
    april.summary.lastMonthOverspent = -80;
    client.setQueryData(["budget-month-data", "conn-1", "2026-03"], march);
    client.setQueryData(["budget-month-data", "conn-1", "2026-04"], april);

    function AprilBalance() {
      const cat = useEffectiveCategory("2026-04", "a");
      return <span data-testid="balance">{cat?.balance}</span>;
    }
    const view = render(
      <QueryClientProvider client={client}>
        <MonthsDataProvider months={["2026-04"]} availableMonths={["2026-03", "2026-04"]}>
          <AprilBalance />
        </MonthsDataProvider>
      </QueryClientProvider>
    );

    // Covering March's overspend (March is out of view) clears it; April's
    // balance does not gain 80, as Actual resets a negative balance.
    act(() => {
      useBudgetEditsStore.getState().stageEdit({
        month: "2026-03",
        categoryId: "a",
        nextBudgeted: 80,
        previousBudgeted: 0,
        source: "manual",
      });
    });
    expect(view.getByTestId("balance").textContent).toBe("0");
  });

  function renderAprilWithMarchEdit(client: QueryClient) {
    const april = monthState("2026-04");
    april.categoriesById.a = { ...category("a", 0), balance: 0 };
    client.setQueryData(["budget-month-data", "conn-1", "2026-04"], april);
    // Staged while March was in view; March is no longer in the cache.
    useBudgetEditsStore.getState().stageEdit({
      month: "2026-03",
      categoryId: "a",
      nextBudgeted: 80,
      previousBudgeted: 0,
      source: "manual",
    });

    function Probe() {
      const cat = useEffectiveCategory("2026-04", "a");
      const { isLoading, carryError } = useMonthsStructure();
      return (
        <>
          <span data-testid="balance">{cat === undefined ? "none" : cat.balance}</span>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="carry-error">{carryError?.month ?? ""}</span>
        </>
      );
    }
    return render(
      <QueryClientProvider client={client}>
        <MonthsDataProvider months={["2026-04"]} availableMonths={["2026-03", "2026-04"]}>
          <Probe />
        </MonthsDataProvider>
      </QueryClientProvider>
    );
  }

  it("holds back the window's figures while a month with earlier edits is loading", async () => {
    let resolveMarch: (value: unknown) => void = () => {};
    mockGetBudgetMonth.mockImplementation(
      () => new Promise((resolve) => (resolveMarch = resolve))
    );
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const view = renderAprilWithMarchEdit(client);

    expect(view.getByTestId("balance").textContent).toBe("none");
    expect(view.getByTestId("loading").textContent).toBe("true");

    const march = monthState("2026-03");
    march.categoriesById.a = { ...category("a", 0), actuals: -80, balance: -80 };
    client.setQueryData(["budget-month-data", "conn-1", "2026-03"], march);
    resolveMarch(undefined);

    // Once March is known, its overspend is covered and April stays at 0.
    await waitFor(() => expect(view.getByTestId("balance").textContent).toBe("0"));
    expect(view.getByTestId("loading").textContent).toBe("false");
  });

  it("reports a month with earlier edits that could not be loaded", async () => {
    mockGetBudgetMonth.mockRejectedValue(new Error("offline"));
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const view = renderAprilWithMarchEdit(client);

    await waitFor(() => expect(view.getByTestId("carry-error").textContent).toBe("2026-03"));
    expect(view.getByTestId("balance").textContent).toBe("none");
    expect(view.getByTestId("loading").textContent).toBe("false");
  });
});
