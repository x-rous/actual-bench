import {
  browserTimezone,
  formatOffset,
  timezoneOptions,
  zoneCity,
  zoneOffsetMinutes,
} from "./timezones";

describe("time zone choices", () => {
  it("labels offsets the way the tz database does", () => {
    expect(formatOffset(0)).toBe("UTC+00:00");
    expect(formatOffset(240)).toBe("UTC+04:00");
    expect(formatOffset(-300)).toBe("UTC-05:00");
    // Half- and quarter-hour zones are real places, not rounding errors.
    expect(formatOffset(330)).toBe("UTC+05:30");
    expect(formatOffset(345)).toBe("UTC+05:45");
  });

  it("reads the offset that is actually in force, not a tabulated one", () => {
    // New York is UTC-5 in January and UTC-4 in July. A fixed table would be
    // wrong for half the year, which is why this is computed.
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe(-240);
    // Dubai does not observe daylight saving.
    expect(zoneOffsetMinutes("Asia/Dubai", new Date("2026-01-15T12:00:00Z"))).toBe(240);
    expect(zoneOffsetMinutes("Asia/Dubai", new Date("2026-07-15T12:00:00Z"))).toBe(240);
    expect(zoneOffsetMinutes("UTC", new Date("2026-07-15T12:00:00Z"))).toBe(0);
  });

  it("refuses a zone the platform cannot resolve rather than inventing one", () => {
    expect(zoneOffsetMinutes("Mars/Olympus")).toBeNull();
  });

  it("names the place, not the path", () => {
    expect(zoneCity("Asia/Dubai")).toBe("Dubai");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity("UTC")).toBe("UTC");
  });

  it("offers the user's own zone first, then UTC", () => {
    const options = timezoneOptions(new Date("2026-07-15T12:00:00Z"));

    expect(options[0].value).toBe(browserTimezone());
    expect(options.map((option) => option.value)).toContain("UTC");
    if (browserTimezone() !== "UTC") expect(options[1].value).toBe("UTC");
  });

  it("orders the rest west to east, so scanning has a direction", () => {
    const rest = timezoneOptions(new Date("2026-07-15T12:00:00Z")).slice(2);
    const offsets = rest.map((option) => option.offsetMinutes);

    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(rest[0].label).toMatch(/^\(UTC[+-]\d{2}:\d{2}\) /);
  });

  it("never offers a zone it could not resolve", () => {
    const options = timezoneOptions();
    expect(options.every((option) => Number.isFinite(option.offsetMinutes))).toBe(true);
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });
});
