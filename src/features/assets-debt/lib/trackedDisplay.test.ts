import { scheduleSource } from "../components/simulator/ScheduleTable";
import { withTracking, type ChartData } from "./results";

describe("the Source column of a tracked loan", () => {
  const tracked = { startDate: "2023-12-01", today: "2026-10-29", missingDueDates: [] as string[], anchorDate: "2026-09-25" };

  it("says From Actual only up to the last real event, so a projected payment this month is not", () => {
    expect(scheduleSource("2026-09", tracked)).toBe("From Actual");
    expect(scheduleSource("2026-10", tracked)).toBe("");
    expect(scheduleSource("2026-11", tracked)).toBe("");
    // Without an anchor it falls back to today.
    expect(scheduleSource("2026-10", { ...tracked, anchorDate: undefined })).toBe("From Actual");
  });

  it("follows the installment numbers when it has them: an installment paid early in the month before its due date is not before tracking", () => {
    // Tracked from installment 1 (due 2023-12-01), which was paid on 2023-11-25: the row for 2023-11 is tracked.
    expect(scheduleSource("2023-11", { ...tracked, installmentsBefore: 0 }, 1)).toBe("From Actual");
    expect(scheduleSource("2023-11", { ...tracked, installmentsBefore: 0 })).toBe("From Actual");
    // Tracked from installment 13: installments 1 to 12 are before tracking, 13 is not.
    expect(scheduleSource("2024-11", { ...tracked, startDate: "2025-01-01", installmentsBefore: 12 }, 12)).toBe("Before tracking");
    expect(scheduleSource("2024-12", { ...tracked, startDate: "2025-01-01", installmentsBefore: 12 }, 13)).toBe("From Actual");
  });

  it("still marks what came before tracking and a payment not found in Actual", () => {
    expect(scheduleSource("2023-11", tracked)).toBe("Before tracking");
    expect(scheduleSource("2026-10", { ...tracked, missingDueDates: ["2026-10-01"] })).toBe("Not found in Actual");
  });
});

describe("the Before tracking shading on the chart", () => {
  const data = { points: [{ period: "2023-10" }, { period: "2023-12" }], series: ["balance"], rateChanges: [], payoff: null } as unknown as ChartData;
  const tracked = { startDate: "2023-12-01", today: "2026-10-29", actual: [] };

  it("says Contract only for a loan with installments before the tracking start", () => {
    const early = { points: [{ period: "2023-11" }, { period: "2024-01" }], series: ["balance"], rateChanges: [], payoff: null } as unknown as ChartData;
    const base = { startDate: "2023-12-01", today: "2026-10-29", actual: [], anchor: { date: "2026-10-22" } };
    expect(withTracking(early, { ...base, installmentsBefore: 0 }, "month").points.map((p) => p.source)).toEqual(["actual", "actual"]);
    expect(withTracking(early, { ...base, installmentsBefore: 3 }, "month").points.map((p) => p.source)).toEqual(["contract", "actual"]);
  });

  it("is only drawn when installments come before the tracking start", () => {
    expect(withTracking(data, { ...tracked, installmentsBefore: 0 }, "month").tracking?.untrackedBefore).toBe(false);
    expect(withTracking(data, { ...tracked, installmentsBefore: 12 }, "month").tracking?.untrackedBefore).toBe(true);
  });
});
