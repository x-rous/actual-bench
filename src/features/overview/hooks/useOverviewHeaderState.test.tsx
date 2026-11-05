import { act, renderHook } from "@testing-library/react";
import { useOverviewHeaderState } from "./useOverviewHeaderState";

const refresh = jest.fn();

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T10:00:00Z")); refresh.mockReset(); });
afterEach(() => jest.useRealTimers());

describe("the overview header state", () => {
  it("says nothing until the statistics have been read", () => {
    const { result } = renderHook(() => useOverviewHeaderState({ loadedAt: null, refresh }));
    expect(result.current.refreshStatusLabel).toBeNull();
  });

  it("takes the first read as the time of the last refresh, however long ago it was", () => {
    const { result } = renderHook(() => useOverviewHeaderState({ loadedAt: Date.now() - 5 * 60_000, refresh }));
    expect(result.current.refreshStatusLabel).toBe("Last refreshed 5m ago");
  });

  it("moves to the refresh's own time after a successful one, and keeps the old time after a failed one", async () => {
    const { result } = renderHook(() => useOverviewHeaderState({ loadedAt: Date.now() - 30 * 60_000, refresh }));
    refresh.mockResolvedValueOnce({ ok: false, hasPartialFailure: true });
    await act(async () => { await result.current.handleRefresh(); });
    expect(result.current.refreshStatusLabel).toBe("Last refreshed 30m ago");
    refresh.mockResolvedValueOnce({ ok: true, hasPartialFailure: false });
    await act(async () => { await result.current.handleRefresh(); });
    expect(result.current.refreshStatusLabel).toBe("Updated just now");
  });

  it("counts on from the first read as time passes", () => {
    const { result } = renderHook(() => useOverviewHeaderState({ loadedAt: Date.now(), refresh }));
    expect(result.current.refreshStatusLabel).toBe("Updated just now");
    act(() => { jest.advanceTimersByTime(45_000); });
    expect(result.current.refreshStatusLabel).toBe("Updated 45s ago");
  });
});
