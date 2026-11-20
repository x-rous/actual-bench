import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSchedulesSave } from "./useSchedulesSave";
import { useStagedStore } from "../../../store/staged";
import type { ActualBenchTransport } from "../../../lib/actual";
import type { Schedule } from "@/types/entities";

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
  return renderHook(() => useSchedulesSave(), {
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

const schedule = (id: string, overrides: Partial<Schedule> = {}): Schedule => ({
  id,
  name: id,
  postsTransaction: false,
  payeeId: null,
  accountId: null,
  amount: 100,
  amountOp: "isapprox",
  date: "2026-12-01",
  completed: false,
  ...overrides,
} as Schedule);

describe("useSchedulesSave", () => {
  beforeEach(() => store().discardAll());
  afterEach(() => store().discardAll());

  it("uses the real ids of payees and accounts created earlier in the same Save", async () => {
    const createSchedule = jest.fn(async () => ({ id: "server-schedule" }));
    mockGetTransport.mockReturnValue({ mode: "http-api", createSchedule, getSchedules: jest.fn(async () => []) } as unknown as ActualBenchTransport);
    store().stageNew("schedules", schedule("tmp-s", { name: "Rent", payeeId: "tmp-payee", accountId: "tmp-account" }));

    const { result } = renderSave();
    await act(async () => {
      await result.current.save({ "tmp-payee": "server-payee", "tmp-account": "server-account" });
    });

    expect(createSchedule).toHaveBeenCalledWith(expect.objectContaining({ name: "Rent", payeeId: "server-payee", accountId: "server-account" }));
  });

  it("reports duplicate names, a missing date and an unsaved payee on their rows instead of writing them", async () => {
    const createSchedule = jest.fn(async () => ({ id: "server-schedule" }));
    mockGetTransport.mockReturnValue({ mode: "http-api", createSchedule, getSchedules: jest.fn(async () => []) } as unknown as ActualBenchTransport);
    store().stageNew("payees", { id: "tmp-payee", name: "Landlord" });
    store().stageNew("schedules", schedule("a", { name: "Rent" }));
    store().stageNew("schedules", schedule("b", { name: " rent " }));
    store().stageNew("schedules", schedule("c", { name: "Gym", date: undefined as unknown as Schedule["date"] }));
    store().stageNew("schedules", schedule("d", { name: "Water", payeeId: "tmp-payee" }));

    const { result } = renderSave();
    let summary!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      summary = await result.current.save();
    });

    expect(createSchedule).not.toHaveBeenCalled();
    const messages = Object.fromEntries(summary.failed.map((f) => [f.id, f.status === "error" ? f.message : ""]));
    expect(messages.a).toMatch(/must be unique/);
    expect(messages.b).toMatch(/must be unique/);
    expect(messages.c).toBe("A date is required.");
    expect(messages.d).toMatch(/payee has not been saved/);
  });
});
