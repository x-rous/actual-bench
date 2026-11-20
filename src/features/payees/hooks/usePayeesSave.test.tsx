import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePayeesSave } from "./usePayeesSave";
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

it("merges into a payee before deleting it in the same Save, and reports a cleared name on its row", async () => {
  const calls: string[] = [];
  mockGetTransport.mockReturnValue({
    mode: "http-api",
    mergePayees: jest.fn(async (target: string, ids: string[]) => { calls.push(`merge:${target}<-${ids.join(",")}`); }),
    deletePayee: jest.fn(async (id: string) => { calls.push(`delete:${id}`); }),
    updatePayee: jest.fn(async (id: string) => { calls.push(`update:${id}`); }),
  } as unknown as ActualBenchTransport);
  store().discardAll();
  store().loadPayees([
    { id: "target", name: "Shop" },
    { id: "dupe", name: "Shop Inc" },
    { id: "named", name: "Cafe" },
  ]);
  store().stagePayeeMerge("target", ["dupe"]);
  store().stageDelete("payees", "target");
  store().stageUpdate("payees", "named", { name: " " });

  const client = new QueryClient();
  const { result } = renderHook(() => usePayeesSave(), {
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  let summary!: Awaited<ReturnType<typeof result.current.save>>;
  await act(async () => {
    summary = await result.current.save();
  });

  expect(calls).toEqual(["merge:target<-dupe", "delete:target"]);
  expect(summary.failed).toEqual([expect.objectContaining({ id: "named", message: expect.stringMatching(/needs a name/) })]);
  store().discardAll();
});
