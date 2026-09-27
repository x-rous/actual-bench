import {
  DEFAULT_DATE_FORMAT,
  dateFormatHint,
  formatTypedDate,
  normalizeDateFormat,
  parseTypedDate,
} from "./typedDate";

const NOW = new Date(2026, 8, 27);

describe("typed dates, read the way Actual reads them", () => {
  it("reads a full date in the budget's format", () => {
    expect(parseTypedDate("15/08/2026", "dd/MM/yyyy", NOW)).toBe("2026-08-15");
    expect(parseTypedDate("08/15/2026", "MM/dd/yyyy", NOW)).toBe("2026-08-15");
    expect(parseTypedDate("15.08.2026", "dd.MM.yyyy", NOW)).toBe("2026-08-15");
    expect(parseTypedDate("2026-08-15", "yyyy-MM-dd", NOW)).toBe("2026-08-15");
  });

  it("takes one-digit days and months", () => {
    expect(parseTypedDate("5/8/2026", "dd/MM/yyyy", NOW)).toBe("2026-08-05");
  });

  it("reads day and month alone as this year", () => {
    expect(parseTypedDate("15/8", "dd/MM/yyyy", NOW)).toBe("2026-08-15");
    expect(parseTypedDate("8/15", "MM/dd/yyyy", NOW)).toBe("2026-08-15");
  });

  it("reads a two-digit year", () => {
    expect(parseTypedDate("15/8/26", "dd/MM/yyyy", NOW)).toBe("2026-08-15");
  });

  it("always understands a pasted ISO date", () => {
    expect(parseTypedDate("2026-08-15", "dd/MM/yyyy", NOW)).toBe("2026-08-15");
  });

  it("refuses what is not a date rather than guessing", () => {
    expect(parseTypedDate("31/02/2026", "dd/MM/yyyy", NOW)).toBeNull();
    expect(parseTypedDate("15/13/2026", "dd/MM/yyyy", NOW)).toBeNull();
    expect(parseTypedDate("not a date", "dd/MM/yyyy", NOW)).toBeNull();
    expect(parseTypedDate("   ", "dd/MM/yyyy", NOW)).toBeNull();
  });

  it("shows a stored date in the budget's format", () => {
    expect(formatTypedDate("2026-08-15", "dd/MM/yyyy")).toBe("15/08/2026");
    expect(formatTypedDate("2026-08-15", "MM/dd/yyyy")).toBe("08/15/2026");
    expect(formatTypedDate(null, "dd/MM/yyyy")).toBe("");
  });

  it("falls back to Actual's default for an unknown format", () => {
    expect(normalizeDateFormat(undefined)).toBe(DEFAULT_DATE_FORMAT);
    expect(normalizeDateFormat("nonsense")).toBe(DEFAULT_DATE_FORMAT);
    expect(normalizeDateFormat("dd.MM.yyyy")).toBe("dd.MM.yyyy");
    expect(dateFormatHint("dd/MM/yyyy")).toBe("dd/mm/yyyy");
  });
});
