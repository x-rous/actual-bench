import { adjustBusinessDay, adjustSchedule, businessDayProblem, isBusinessDay, isoWeekday, type BusinessDayConvention } from "./businessDays";

const weekend: Omit<BusinessDayConvention, "adjustment"> = { nonBusinessWeekdays: [6, 7], holidays: ["2024-12-31"] };
const of = (adjustment: BusinessDayConvention["adjustment"]): BusinessDayConvention => ({ adjustment, ...weekend });

describe("business-day adjustment", () => {
  it("numbers ISO weekdays from Monday", () => {
    expect(isoWeekday("2024-01-01")).toBe(1);
    expect(isoWeekday("2024-09-01")).toBe(7);
    expect(isoWeekday("1970-01-01")).toBe(4);
    expect(isoWeekday("1969-12-28")).toBe(7);
  });

  it("treats configured weekdays and saved holidays as non-business days", () => {
    expect(isBusinessDay("2024-11-30", of("following"))).toBe(false);
    expect(isBusinessDay("2024-12-31", of("following"))).toBe(false);
    expect(isBusinessDay("2024-12-30", of("following"))).toBe(true);
  });

  it.each([
    // Saturday 30 Nov 2024: the next business day is in December.
    ["following", "2024-11-30", "2024-12-02"],
    ["modified-following", "2024-11-30", "2024-11-29"],
    ["preceding", "2024-11-30", "2024-11-29"],
    ["modified-preceding", "2024-11-30", "2024-11-29"],
    // Sunday 1 Sep 2024.
    ["following", "2024-09-01", "2024-09-02"],
    ["modified-following", "2024-09-01", "2024-09-02"],
    ["preceding", "2024-09-01", "2024-08-30"],
    ["modified-preceding", "2024-09-01", "2024-09-02"],
    // A holiday on a weekday.
    ["following", "2024-12-31", "2025-01-01"],
    ["modified-following", "2024-12-31", "2024-12-30"],
    ["none", "2024-09-01", "2024-09-01"],
  ] as const)("%s moves %s to %s", (adjustment, date, expected) => {
    expect(adjustBusinessDay(date, of(adjustment))).toBe(expected);
  });

  it("leaves business days alone and keeps a schedule ordered without duplicates", () => {
    expect(adjustBusinessDay("2024-12-02", of("preceding"))).toBe("2024-12-02");
    expect(adjustSchedule(["2024-11-29", "2024-11-30", "2024-12-01"], of("preceding"))).toEqual(["2024-11-29"]);
    expect(adjustSchedule(["2024-09-01"], null)).toEqual(["2024-09-01"]);
  });

  it("rejects unusable conventions", () => {
    expect(businessDayProblem({ adjustment: "following", nonBusinessWeekdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] })?.field).toBe("nonBusinessWeekdays");
    expect(businessDayProblem({ adjustment: "following", nonBusinessWeekdays: [7, 7], holidays: [] })?.field).toBe("nonBusinessWeekdays");
    expect(businessDayProblem({ adjustment: "following", nonBusinessWeekdays: [7], holidays: ["2024-02-01", "2024-01-01"] })?.field).toBe("holidays");
    expect(businessDayProblem({ adjustment: "following", nonBusinessWeekdays: [7], holidays: ["2024-01-01"] })).toBeNull();
  });
});
