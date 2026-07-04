import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBudgetSave } from "./useBudgetSave";
import type { ConnectionInstance } from "../../../store/connection";
import type { BudgetCellKey, StagedBudgetEdit, StagedHold } from "../types";

const mockGetTransport = jest.fn();

jest.mock("../../../lib/actual", () => ({
  getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
}));

let mockActiveConnection: ConnectionInstance = {
  id: "conn-1",
  label: "Direct",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "password",
  budgetSyncId: "budget-1",
};

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => mockActiveConnection),
  selectActiveInstance: jest.fn(),
}));

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeRawMonth() {
  return {
    month: "2026-01",
    incomeAvailable: 0,
    lastMonthOverspent: 0,
    forNextMonth: 0,
    totalBudgeted: 0,
    toBudget: 0,
    fromLastMonth: 0,
    totalIncome: 0,
    totalSpent: 0,
    totalBalance: 0,
    categoryGroups: [
      {
        id: "group-1",
        name: "Expenses",
        is_income: false as const,
        hidden: false,
        budgeted: 0,
        spent: 0,
        balance: 0,
        categories: [
          {
            id: "cat-1",
            name: "Groceries",
            group_id: "group-1",
            is_income: false,
            hidden: false,
            budgeted: 100,
            spent: 0,
            balance: 100,
            carryover: false,
          },
        ],
      },
    ],
  };
}

function makeTransport() {
  return {
    mode: "browser-api",
    sync: jest.fn(() => Promise.resolve()),
    batchBudgetUpdates: jest.fn(async (operation: () => Promise<unknown>) => operation()),
    getBudgetMonths: jest.fn(() => Promise.resolve(["2026-01"])),
    getBudgetMonth: jest.fn(() => Promise.resolve(makeRawMonth())),
    setBudgetAmount: jest.fn(() => Promise.resolve()),
    holdBudgetForNextMonth: jest.fn(() => Promise.resolve()),
    resetBudgetHold: jest.fn(() => Promise.resolve()),
    transferBudget: jest.fn(() => Promise.resolve()),
  } as {
    sync: jest.Mock;
    batchBudgetUpdates: jest.Mock;
    getBudgetMonths: jest.Mock;
    getBudgetMonth: jest.Mock;
    setBudgetAmount: jest.Mock;
    holdBudgetForNextMonth: jest.Mock;
  };
}

describe("useBudgetSave", () => {
  beforeEach(() => {
    mockGetTransport.mockReset();
    mockActiveConnection = {
      id: "conn-1",
      label: "Direct",
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      serverPassword: "password",
      budgetSyncId: "budget-1",
    };
  });

  it("saves Direct budget edits and holds through a transport budget batch then syncs", async () => {
    const transport = makeTransport();
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    };
    const hold: StagedHold = {
      month: "2026-01",
      previousAmount: 0,
      nextAmount: 25,
    };

    await act(async () => {
      await result.current.save(
        { ["2026-01:cat-1" as BudgetCellKey]: edit },
        { "2026-01": hold }
      );
    });

    expect(transport.getBudgetMonths).toHaveBeenCalledTimes(1);
    expect(transport.batchBudgetUpdates).toHaveBeenCalledTimes(1);
    expect(transport.holdBudgetForNextMonth).toHaveBeenCalledWith("2026-01", 25);
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
    expect(transport.sync).not.toHaveBeenCalled();
  });
});
