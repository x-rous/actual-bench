import { act, renderHook } from "@testing-library/react";
import { useNowMs } from "./useNowMs";

describe("useNowMs", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T10:00:00Z")); });
  afterEach(() => jest.useRealTimers());

  it("starts at the current time and moves on only when the interval passes", () => {
    const { result } = renderHook(() => useNowMs(60_000));
    const start = result.current;
    expect(start).toBe(new Date("2026-11-05T10:00:00Z").getTime());
    act(() => { jest.advanceTimersByTime(59_000); });
    expect(result.current).toBe(start);
    act(() => { jest.advanceTimersByTime(2_000); });
    expect(result.current).toBe(start + 60_000);
  });

  it("stops refreshing when the component goes away", () => {
    const { unmount } = renderHook(() => useNowMs(1_000));
    const clear = jest.spyOn(global, "clearInterval");
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
