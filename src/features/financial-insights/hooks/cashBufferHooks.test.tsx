import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { DEFAULT_BUFFER_SETTINGS, NO_ADJUSTMENTS, type BufferSettings } from "@/lib/financial-insights/bufferScenario";
import type { CashBufferScenarioRecord } from "@/lib/app-db/types";
import { useCashBufferScenarios } from "./useCashBufferScenarios";
import { useCashBufferSettings } from "./useCashBufferSettings";

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1", budgetSyncId: "budget-1" })),
  selectActiveInstance: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

describe("the cash buffer settings", () => {
  const goal = (months: number): BufferSettings => ({ ...DEFAULT_BUFFER_SETTINGS, goalMonths: months });

  afterEach(() => jest.clearAllMocks());

  it("shows the latest choice at once and ends on what the database holds after two quick saves", async () => {
    let stored: BufferSettings = DEFAULT_BUFFER_SETTINGS;
    const releases: (() => void)[] = [];
    global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return Promise.resolve(json({ settings: stored }));
      const next = (JSON.parse(String(init.body)) as { settings: BufferSettings }).settings;
      stored = next;
      return new Promise((resolve) => releases.push(() => resolve(json({ settings: next }))));
    }) as jest.Mock;
    const { result } = renderHook(() => useCashBufferSettings(), { wrapper });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    act(() => { result.current.save(goal(3)); });
    act(() => { result.current.save(goal(6)); });
    // The screen already shows the latest choice.
    await waitFor(() => expect(result.current.settings.goalMonths).toBe(6));
    // The second save waits for the first, so the database applies them in the order they were made.
    await act(async () => { releases[0](); });
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => { releases[1](); });
    await waitFor(() => expect(result.current.saving).toBe(false));
    await waitFor(() => expect(result.current.settings.goalMonths).toBe(6));
    expect(stored.goalMonths).toBe(6);
  });

  it("sends two quick saves one after the other, so the database ends on the later choice", async () => {
    const order: string[] = [];
    let running = 0, overlapped = false;
    global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return json({ settings: DEFAULT_BUFFER_SETTINGS });
      running += 1; overlapped ||= running > 1;
      order.push(String((JSON.parse(String(init.body)) as { settings: BufferSettings }).settings.goalMonths));
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return json({ settings: DEFAULT_BUFFER_SETTINGS });
    }) as jest.Mock;
    const { result } = renderHook(() => useCashBufferSettings(), { wrapper });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    act(() => { result.current.save(goal(3)); result.current.save(goal(6)); });
    await waitFor(() => expect(order).toEqual(["3", "6"]));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(overlapped).toBe(false);
  });

  it("says the settings already loaded stay in use when only a later refresh fails", async () => {
    let fail = false;
    global.fetch = jest.fn(async () => (fail ? json({}, false) : json({ settings: goal(6) }))) as jest.Mock;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useCashBufferSettings(), { wrapper: shared });
    await waitFor(() => expect(result.current.settings.goalMonths).toBe(6));
    expect(toast.error).not.toHaveBeenCalled();
    fail = true;
    await act(async () => { await client.refetchQueries({ queryKey: ["cashBufferSettings", "budget-1"] }); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("already loaded"), expect.objectContaining({ id: "cash-buffer-settings-load" })));
    expect(result.current.settings.goalMonths).toBe(6);
  });

  it("says the defaults are in use when the saved settings cannot be read", async () => {
    global.fetch = jest.fn(async () => json({}, false)) as jest.Mock;
    const { result } = renderHook(() => useCashBufferSettings(), { wrapper });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("defaults are used"), expect.objectContaining({ id: "cash-buffer-settings-load" })));
    expect(result.current.settings).toEqual(DEFAULT_BUFFER_SETTINGS);
  });
});

describe("the cash buffer scenarios", () => {
  it("shows the scenario it just saved by its own id, whatever else was saved around the same time", async () => {
    const record = (id: string, name: string, updatedAt: string): CashBufferScenarioRecord => ({ budgetSyncId: "budget-1", id, name, adjustments: NO_ADJUSTMENTS, result: null, createdAt: updatedAt, updatedAt });
    // Another tab saved a scenario later than ours, so "the newest" is not ours.
    const other = record("other", "From another tab", "2099-01-01T00:00:00.000Z");
    global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return json({ scenarios: [] });
      const body = JSON.parse(String(init.body)) as { id: string; name: string };
      return json({ scenarios: [other, record(body.id, body.name, "2026-11-05T00:00:00.000Z")] });
    }) as jest.Mock;
    const { result } = renderHook(() => useCashBufferScenarios(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saved: CashBufferScenarioRecord | null = null;
    await act(async () => { saved = await result.current.saveScenario({ name: "Lean months", adjustments: NO_ADJUSTMENTS, result: null }); });
    expect(saved).toMatchObject({ name: "Lean months" });
    const sent = JSON.parse(String((global.fetch as jest.Mock).mock.calls.find(([, i]) => i?.method === "PUT")[1].body)) as { id: string };
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(result.current.active?.name).toBe("Lean months"));
  });
});
