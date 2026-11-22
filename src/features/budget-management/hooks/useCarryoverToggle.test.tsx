import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCarryoverToggle } from "./useCarryoverToggle";
import type { ConnectionInstance } from "../../../store/connection";

const mockGetTransport = jest.fn();

jest.mock("../../../lib/actual", () => ({
  getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
}));

const mockActiveConnection: ConnectionInstance = {
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

describe("useCarryoverToggle (H6)", () => {
  it("sends one request per category and refreshes every cached month from the start", async () => {
    const transport = {
      batchBudgetUpdates: jest.fn(async (operation: () => Promise<unknown>) => operation()),
      setBudgetCarryover: jest.fn(() => Promise.resolve()),
    };
    mockGetTransport.mockReturnValue(transport);

    const client = new QueryClient();
    for (const month of ["2026-02", "2026-03", "2027-06"]) {
      client.setQueryData(["budget-month-data", "conn-1", month], { month });
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCarryoverToggle(), { wrapper });

    await act(async () => {
      await result.current.run({
        categoryIds: ["cat-1", "cat-2"],
        fromMonth: "2026-03",
        newValue: true,
      });
    });

    // Actual applies the flag from 2026-03 through every later month itself.
    expect(transport.setBudgetCarryover.mock.calls).toEqual([
      ["2026-03", "cat-1", true],
      ["2026-03", "cat-2", true],
    ]);
    const isInvalidated = (month: string) =>
      client.getQueryState(["budget-month-data", "conn-1", month])?.isInvalidated;
    expect(isInvalidated("2026-02")).toBe(false);
    expect(isInvalidated("2026-03")).toBe(true);
    expect(isInvalidated("2027-06")).toBe(true);
  });
});
