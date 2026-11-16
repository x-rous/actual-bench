import type { RecurConfig, Schedule } from "@/types/entities";
import { scheduleDates } from "./scheduleDates";

type Input = Pick<Schedule, "completed" | "nextDate" | "date">;

const recurring = (nextDate: string, config: Partial<RecurConfig> & Pick<RecurConfig, "frequency" | "start">): Input => ({ completed: false, nextDate, date: { endMode: "never", ...config } });
const datesOf = (schedule: Input, to: string) => {
  const result = scheduleDates(schedule, to);
  if (!result.ok) throw new Error(result.problem);
  return result.dates;
};

// 2026-01-01 is a Thursday; 2026-02-28 and 2026-03-28 are Saturdays.
describe("schedule dates", () => {
  it("gives a one-off schedule's date, only while it is within reach", () => {
    expect(datesOf({ completed: false, nextDate: "2026-04-01", date: "2026-04-01" }, "2026-12-31")).toEqual(["2026-04-01"]);
    expect(datesOf({ completed: false, nextDate: "2026-04-01", date: "2026-04-01" }, "2026-03-31")).toEqual([]);
  });

  it("repeats daily, weekly, monthly and yearly with an interval", () => {
    expect(datesOf(recurring("2026-01-01", { frequency: "daily", interval: 3, start: "2026-01-01" }), "2026-01-10")).toEqual(["2026-01-01", "2026-01-04", "2026-01-07", "2026-01-10"]);
    expect(datesOf(recurring("2026-01-05", { frequency: "weekly", interval: 2, start: "2026-01-05" }), "2026-02-05")).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
    expect(datesOf(recurring("2026-01-15", { frequency: "monthly", interval: 2, start: "2026-01-15" }), "2026-05-31")).toEqual(["2026-01-15", "2026-03-15", "2026-05-15"]);
    expect(datesOf(recurring("2026-02-10", { frequency: "yearly", interval: 2, start: "2026-02-10" }), "2030-12-31")).toEqual(["2026-02-10", "2028-02-10", "2030-02-10"]);
  });

  it("follows monthly day patterns: the last day, and a weekday such as the 2nd Friday", () => {
    expect(datesOf(recurring("2026-01-31", { frequency: "monthly", start: "2026-01-31", patterns: [{ value: -1, type: "day" }] }), "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(datesOf(recurring("2026-01-09", { frequency: "monthly", start: "2026-01-01", patterns: [{ value: 2, type: "FR" }] }), "2026-03-31")).toEqual(["2026-01-09", "2026-02-13", "2026-03-13"]);
  });

  it("moves a weekend occurrence to the Friday before or the Monday after", () => {
    const base = { frequency: "monthly", start: "2026-01-28", skipWeekend: true } as const;
    expect(datesOf(recurring("2026-01-28", { ...base, weekendSolveMode: "before" }), "2026-03-31")).toEqual(["2026-01-28", "2026-02-27", "2026-03-27"]);
    expect(datesOf(recurring("2026-01-28", { ...base, weekendSolveMode: "after" }), "2026-03-31")).toEqual(["2026-01-28", "2026-03-02", "2026-03-30"]);
  });

  it("stops on an end date or after a number of occurrences", () => {
    expect(datesOf(recurring("2026-01-01", { frequency: "daily", start: "2026-01-01", endMode: "on_date", endDate: "2026-01-03" }), "2026-01-10")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(datesOf(recurring("2026-01-05", { frequency: "weekly", start: "2026-01-05", endMode: "after_n_occurrences", endOccurrences: 3 }), "2026-03-01")).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  it("has no dates once completed, and never goes earlier than the saved next date", () => {
    expect(datesOf({ completed: true, nextDate: "2026-01-01", date: "2026-01-01" }, "2026-12-31")).toEqual([]);
    expect(datesOf(recurring("2026-01-05", { frequency: "daily", start: "2026-01-01" }), "2026-01-08")).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]);
  });

  it("says why it cannot work out a schedule instead of guessing", () => {
    expect(scheduleDates({ completed: false, date: "2026-04-01" }, "2026-12-31")).toMatchObject({ ok: false });
  });
});
