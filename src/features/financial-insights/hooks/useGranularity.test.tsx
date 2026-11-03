import { act, renderHook } from "@testing-library/react";
import { useGranularity } from "./useGranularity";

describe("the unit of a month-by-month card", () => {
  it("opens by the length of the period", () => {
    expect(renderHook(() => useGranularity(6)).result.current[0]).toBe("month");
    expect(renderHook(() => useGranularity(36)).result.current[0]).toBe("quarter");
    expect(renderHook(() => useGranularity(95)).result.current[0]).toBe("year");
  });

  it("follows the period while the viewer has not chosen", () => {
    const { result, rerender } = renderHook(({ n }) => useGranularity(n), { initialProps: { n: 6 } });
    expect(result.current[0]).toBe("month");
    rerender({ n: 95 });
    expect(result.current[0]).toBe("year");
  });

  it("keeps a choice for the period it was made in, and opens a different period by its own length", () => {
    const { result, rerender } = renderHook(({ n }) => useGranularity(n), { initialProps: { n: 95 } });
    act(() => result.current[1]("month"));
    expect(result.current[0]).toBe("month");
    rerender({ n: 95 });
    expect(result.current[0]).toBe("month");
    rerender({ n: 12 });
    expect(result.current[0]).toBe("month");
    rerender({ n: 36 });
    expect(result.current[0]).toBe("quarter");
  });
});
