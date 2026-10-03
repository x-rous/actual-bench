import type { Schedule } from "@/types/entities";
import { computeScheduleStatus } from "./scheduleStatus";

/**
 * Actual 26.10 keeps an automatically posted schedule on the day it ran
 * (shown as paid) instead of jumping straight to the next date, so `nextDate`
 * can be today with a transaction already posted for it.
 */

const NOW = new Date(2026, 9, 3, 12, 0, 0); // 3 Oct 2026, local time

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

const schedule = (over: Partial<Schedule> = {}) =>
  ({ id: "s1", name: "Rent", completed: false, nextDate: "2026-10-03", ...over }) as Schedule;
const tx = (date: string) => ({ date }) as never;

describe("computeScheduleStatus", () => {
  it("is paid when today's occurrence has already posted", () => {
    expect(computeScheduleStatus(schedule(), [tx("2026-10-03")])).toBe("paid");
  });

  it("is due when today's occurrence has not posted yet", () => {
    expect(computeScheduleStatus(schedule(), [])).toBe("due");
  });

  it("is missed when an earlier occurrence never posted", () => {
    expect(computeScheduleStatus(schedule({ nextDate: "2026-10-01" }), [])).toBe("missed");
  });

  it("counts a payment made up to 14 days early", () => {
    expect(computeScheduleStatus(schedule({ nextDate: "2026-10-10" }), [tx("2026-10-02")])).toBe("paid");
  });

  it("is completed whatever the dates say", () => {
    expect(computeScheduleStatus(schedule({ completed: true }), [])).toBe("completed");
  });
});
