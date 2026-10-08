import { daysBetween } from "./dates";
import { generateSchedule } from "./schedule";

const gaps = (dates: string[]) => dates.slice(1).map((d, i) => daysBetween(dates[i], d));

describe("weekly and fortnightly", () => {
  it("steps exactly 14 days through 29 February and two year ends", () => {
    const dates = generateSchedule(
      { frequency: "fortnightly", firstDate: "2023-12-22" },
      { from: "2023-12-22", to: "2025-01-31" }
    );
    expect(dates.slice(0, 7)).toEqual([
      "2023-12-22",
      "2024-01-05",
      "2024-01-19",
      "2024-02-02",
      "2024-02-16",
      "2024-03-01", // 16 Feb + 14 days, across 29 Feb
      "2024-03-15",
    ]);
    expect(new Set(gaps(dates))).toEqual(new Set([14]));
    // 2023-12-22 + 26 × 14 = 2024-12-20, then across the next year end.
    expect(dates).toContain("2024-12-20");
    expect(dates).toContain("2025-01-03");
  });

  it("puts 53 weekly dates in a year that holds them, not 52", () => {
    const dates = generateSchedule({ frequency: "weekly", firstDate: "2024-01-01" }, { from: "2024-01-01", to: "2024-12-31" });
    expect(dates).toHaveLength(53);
    expect(dates[52]).toBe("2024-12-30");
    expect(new Set(gaps(dates))).toEqual(new Set([7]));
  });

  it("puts 27 fortnightly dates in a year that holds them", () => {
    const dates = generateSchedule({ frequency: "fortnightly", firstDate: "2026-01-01" }, { from: "2026-01-01", to: "2026-12-31" });
    // 1 Jan + 26 × 14 days = 31 Dec in a common year.
    expect(dates).toHaveLength(27);
    expect(dates[26]).toBe("2026-12-31");
  });

  it("starts a window mid-series on the right phase", () => {
    const dates = generateSchedule({ frequency: "fortnightly", firstDate: "2024-01-05" }, { from: "2024-02-20", to: "2024-03-20" });
    expect(dates).toEqual(["2024-03-01", "2024-03-15"]);
  });
});

describe("month-based", () => {
  it("keeps a 31st anchor across short months", () => {
    const dates = generateSchedule({ frequency: "monthly", firstDate: "2024-01-31" }, { from: "2024-01-01", to: "2024-06-30" });
    expect(dates).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31", "2024-06-30"]);
  });

  it("clamps 29 February to 28 February in common years", () => {
    const dates = generateSchedule({ frequency: "annual", firstDate: "2024-02-29" }, { from: "2024-01-01", to: "2028-12-31" });
    expect(dates).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });

  it("steps quarters from the first date", () => {
    const dates = generateSchedule({ frequency: "quarterly", firstDate: "2023-11-30" }, { from: "2024-01-01", to: "2024-12-31" });
    expect(dates).toEqual(["2024-02-29", "2024-05-30", "2024-08-30", "2024-11-30"]);
  });

  it("uses an explicit anchor day", () => {
    const dates = generateSchedule(
      { frequency: "monthly", firstDate: "2024-02-29", anchorDay: 31 },
      { from: "2024-02-01", to: "2024-04-30" }
    );
    expect(dates).toEqual(["2024-02-29", "2024-03-31", "2024-04-30"]);
  });

  it("does not emit an anchored date before the first date", () => {
    const dates = generateSchedule(
      { frequency: "monthly", firstDate: "2024-02-20", anchorDay: 5 },
      { from: "2024-02-01", to: "2024-04-30" }
    );
    expect(dates).toEqual(["2024-03-05", "2024-04-05"]);
  });
});

describe("semi-monthly", () => {
  it("places both days and clamps the later one", () => {
    const dates = generateSchedule(
      { frequency: "semi-monthly", firstDate: "2024-01-15", days: [15, 31] },
      { from: "2024-01-01", to: "2024-04-30" }
    );
    expect(dates).toEqual([
      "2024-01-15",
      "2024-01-31",
      "2024-02-15",
      "2024-02-29",
      "2024-03-15",
      "2024-03-31",
      "2024-04-15",
      "2024-04-30",
    ]);
  });

  it("skips days before the first date and refuses bad day pairs", () => {
    const dates = generateSchedule(
      { frequency: "semi-monthly", firstDate: "2024-01-20", days: [1, 15] },
      { from: "2024-01-01", to: "2024-02-28" }
    );
    expect(dates).toEqual(["2024-02-01", "2024-02-15"]);
    expect(() =>
      generateSchedule({ frequency: "semi-monthly", firstDate: "2024-01-01", days: [15, 15] }, { from: "2024-01-01", to: "2024-02-01" })
    ).toThrow(RangeError);
  });

  it("emits a clamped date only once when both days land on the same day", () => {
    for (const [firstDate, to, expected] of [
      ["2023-01-01", "2023-02-28", ["2023-01-30", "2023-01-31", "2023-02-28"]],
      ["2023-04-01", "2023-04-30", ["2023-04-30"]],
    ] as const) {
      expect(
        generateSchedule(
          { frequency: "semi-monthly", firstDate, days: [30, 31] },
          { from: firstDate, to }
        )
      ).toEqual(expected);
    }
  });
});

describe("custom-dated", () => {
  it("sorts the dates and keeps those in the window", () => {
    const dates = generateSchedule(
      { frequency: "custom-dated", dates: ["2024-03-02", "2024-02-29", "2025-01-01"] },
      { from: "2024-01-01", to: "2024-12-31" }
    );
    expect(dates).toEqual(["2024-02-29", "2024-03-02"]);
  });

  it("refuses a duplicate date", () => {
    expect(() =>
      generateSchedule({ frequency: "custom-dated", dates: ["2024-02-29", "2024-02-29"] }, { from: "2024-01-01", to: "2024-12-31" })
    ).toThrow(/twice/);
  });
});

it("refuses a window that ends before it starts", () => {
  expect(() => generateSchedule({ frequency: "weekly", firstDate: "2024-01-01" }, { from: "2024-02-01", to: "2024-01-01" })).toThrow(
    RangeError
  );
});
