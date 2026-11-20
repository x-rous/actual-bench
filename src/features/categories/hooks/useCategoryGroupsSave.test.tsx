import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCategoryGroupsSave } from "./useCategoryGroupsSave";
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
  return renderHook(() => useCategoryGroupsSave(), {
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe("useCategoryGroupsSave delete phase", () => {
  beforeEach(() => store().discardAll());
  afterEach(() => store().discardAll());

  it("keeps a group whose category move did not save, since deleting it would delete that category", async () => {
    const deleteCategoryGroup = jest.fn(async () => undefined);
    mockGetTransport.mockReturnValue({ mode: "http-api", deleteCategoryGroup } as unknown as ActualBenchTransport);
    store().loadCategoryGroups(
      [
        { id: "old", name: "Old", isIncome: false, hidden: false, categoryIds: ["c1"] },
        { id: "empty", name: "Empty", isIncome: false, hidden: false, categoryIds: [] },
        { id: "new-home", name: "Bills", isIncome: false, hidden: false, categoryIds: [] },
      ],
      [{ id: "c1", name: "Rent", groupId: "old", isIncome: false, hidden: false }]
    );
    // The move out of "old" failed in the categories step, so it is still staged.
    store().stageUpdate("categories", "c1", { groupId: "new-home" });
    store().stageDelete("categoryGroups", "old");
    store().stageDelete("categoryGroups", "empty");

    const { result } = renderSave();
    let summary!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      summary = await result.current.save("delete");
    });

    expect(deleteCategoryGroup).toHaveBeenCalledTimes(1);
    expect(deleteCategoryGroup).toHaveBeenCalledWith("empty", null);
    expect(summary.failed).toEqual([expect.objectContaining({ id: "old" })]);
    expect(store().categoryGroups.old?.isDeleted).toBe(true);
  });
});
