import { addMonths, lastCompleteMonths, resolvePeriod } from "./period";

describe("reporting period", () => {
  const today = "2026-11-18";

  it("makes Last 6 and Last 12 months complete months ending last month", () => {
    const six = resolvePeriod({ kind: "preset", id: "last-6" }, today, null);
    expect([six.startMonth, six.endMonth, six.months.length, six.partial]).toEqual(["2026-05", "2026-10", 6, false]);
    expect(six.endDate).toBe("2026-10-31");
    const twelve = resolvePeriod({ kind: "preset", id: "last-12" }, today, null);
    expect([twelve.startMonth, twelve.endMonth, twelve.months.length]).toEqual(["2025-11", "2026-10", 12]);
  });

  it("lets This month and This year run to today and marks them partial", () => {
    const month = resolvePeriod({ kind: "preset", id: "this-month" }, today, null);
    expect([month.startDate, month.endDate, month.partial]).toEqual(["2026-11-01", today, true]);
    const year = resolvePeriod({ kind: "preset", id: "this-year" }, today, null);
    expect([year.startMonth, year.endMonth, year.partial]).toEqual(["2026-01", "2026-11", true]);
  });

  it("handles last month and last year, across a year boundary", () => {
    expect(resolvePeriod({ kind: "preset", id: "last-month" }, "2027-01-05", null)).toMatchObject({ startMonth: "2026-12", endMonth: "2026-12", partial: false });
    expect(resolvePeriod({ kind: "preset", id: "last-year" }, today, null)).toMatchObject({ startMonth: "2025-01", endMonth: "2025-12", endDate: "2025-12-31" });
    expect(resolvePeriod({ kind: "preset", id: "last-12" }, "2027-01-05", null).startMonth).toBe("2026-01");
  });

  it("starts All available at the first month with data and never goes past today", () => {
    expect(resolvePeriod({ kind: "preset", id: "all" }, today, "2024-03")).toMatchObject({ startMonth: "2024-03", endMonth: "2026-11", partial: true });
    const future = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2027-05" }, today, null);
    expect([future.endMonth, future.partial]).toEqual(["2026-11", true]);
    const inverted = resolvePeriod({ kind: "custom", startMonth: "2026-10", endMonth: "2026-04" }, today, null);
    expect(inverted.months).toEqual(["2026-04"]);
  });

  it("finds the last complete months, shortened by a short history", () => {
    expect(lastCompleteMonths(today, null)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(lastCompleteMonths(today, "2026-09")).toEqual(["2026-09", "2026-10"]);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});
