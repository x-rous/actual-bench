import { act, renderHook } from "@testing-library/react";
import { useGranularity } from "./useGranularity";

/** `n` consecutive months from `from` (a 1-based month index since year 2000). */
const run = (n: number, from = 1) => Array.from({ length: n }, (_, i) => {
  const index = from - 1 + i;
  return `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
});

describe("the unit of a month-by-month card", () => {
  it("opens by the length of the period", () => {
    expect(renderHook(() => useGranularity(run(6))).result.current[0]).toBe("month");
    expect(renderHook(() => useGranularity(run(36))).result.current[0]).toBe("quarter");
    expect(renderHook(() => useGranularity(run(95))).result.current[0]).toBe("year");
  });

  it("follows the period while the viewer has not chosen", () => {
    const { result, rerender } = renderHook(({ n }) => useGranularity(run(n)), { initialProps: { n: 6 } });
    expect(result.current[0]).toBe("month");
    rerender({ n: 95 });
    expect(result.current[0]).toBe("year");
  });

  it("keeps a choice for the period it was made in, and opens a different period by its own length", () => {
    const { result, rerender } = renderHook(({ n }) => useGranularity(run(n)), { initialProps: { n: 95 } });
    act(() => result.current[1]("month"));
    expect(result.current[0]).toBe("month");
    rerender({ n: 95 });
    expect(result.current[0]).toBe("month");
    rerender({ n: 12 });
    expect(result.current[0]).toBe("month");
    rerender({ n: 36 });
    expect(result.current[0]).toBe("quarter");
  });

  it("opens by its own length again for another run of months of the same length", () => {
    const { result, rerender } = renderHook(({ from }) => useGranularity(run(36, from)), { initialProps: { from: 1 } });
    act(() => result.current[1]("month"));
    expect(result.current[0]).toBe("month");
    rerender({ from: 7 });
    expect(result.current[0]).toBe("quarter");
  });
});
