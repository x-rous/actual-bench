import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCategoriesSave } from "./useCategoriesSave";
import { useStagedStore } from "../../../store/staged";
import type { ActualBenchTransport } from "../../../lib/actual";

const mockGetTransport = jest.fn();

jest.mock("../../../lib/actual", () => {
  const actualTransport = jest.requireActual("../../../lib/actual/transport") as typeof import("../../../lib/actual/transport");
  return {
    getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
    settleTransportWrites: actualTransport.settleTransportWrites,
    syncTransportAfterChanges: jest.fn(async () => undefined),
  };
});

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1", label: "HTTP API", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "key", budgetSyncId: "budget-1" })),
  selectActiveInstance: jest.fn(),
}));

const store = () => useStagedStore.getState();

function renderSave() {
  const client = new QueryClient();
  return renderHook(() => useCategoriesSave(), {
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe("useCategoriesSave", () => {
  beforeEach(() => store().discardAll());
  afterEach(() => store().discardAll());

  it("saves a move to another group (a new group by its real id), and a delete's transfer category", async () => {
    const updateCategory = jest.fn(async () => undefined);
    const deleteCategory = jest.fn(async () => undefined);
    mockGetTransport.mockReturnValue({ mode: "http-api", updateCategory, deleteCategory } as unknown as ActualBenchTransport);
    store().loadCategoryGroups(
      [{ id: "g1", name: "Bills", isIncome: false, hidden: false, categoryIds: ["c1", "c2", "c3"] }],
      [
        { id: "c1", name: "Rent", groupId: "g1", isIncome: false, hidden: false },
        { id: "c2", name: "Power", groupId: "g1", isIncome: false, hidden: false },
        { id: "c3", name: "Old", groupId: "g1", isIncome: false, hidden: false },
      ]
    );
    store().stageUpdate("categories", "c1", { groupId: "tmp-group" });
    store().stageUpdate("categories", "c2", { name: "Electricity" });
    store().stageDelete("categories", "c3");
    store().stageDeleteTransfer("categories", "c3", "c1");

    const { result } = renderSave();
    await act(async () => {
      await result.current.save({ "tmp-group": "server-group" });
    });

    expect(updateCategory).toHaveBeenCalledWith("c1", { name: "Rent", hidden: false, groupId: "server-group" });
    // A rename leaves the group alone.
    expect(updateCategory).toHaveBeenCalledWith("c2", { name: "Electricity", hidden: false });
    expect(deleteCategory).toHaveBeenCalledWith("c3", "c1");
  });
});
