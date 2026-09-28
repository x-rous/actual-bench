import { compareRows, loadFamily } from "../__fixtures__/harness";
import { dec, toMinor } from "../../money/kernel";
import type { RoundingMode } from "../../money/rounding";
import { daysBetween } from "../../calendar/dates";
import { DAY_COUNT_CATALOG } from "./registry";
import { periodInterest, type DayCountId } from "./types";

/*
 * Each implemented convention against its own fixture family. Expected values
 * come from the published sources or the independent oracle; this file only
 * runs the engine and compares, row by row, to the minor unit.
 */

type PeriodInterestInput = {
  kind: "period-interest";
  convention: DayCountId;
  currency: { code: string; minorDigits: number };
  principal: string;
  annualRate: string;
  rounding: RoundingMode;
};

const implemented = Object.values(DAY_COUNT_CATALOG).filter((e) => e.current !== null);

describe.each(implemented.map((e) => [e.id, e] as const))("%s fixtures", (_id, entry) => {
  const fixtures = loadFamily(entry.fixtureFamily);

  it("has at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))("%s matches to the minor unit", (_name, fixture) => {
    const input = fixture.input as PeriodInterestInput;
    expect(input.kind).toBe("period-interest");
    expect(input.convention).toBe(entry.id);
    const convention = entry.current!;
    const actual = fixture.expected.map((row) => ({
      start: row.start,
      end: row.end,
      days: String(daysBetween(row.start, row.end)),
      interest_minor: String(
        toMinor(
          periodInterest(dec(input.principal), dec(input.annualRate), convention, row.start, row.end, input.currency.minorDigits, input.rounding),
          input.currency.minorDigits,
          "down"
        )
      ),
    }));
    expect(compareRows(fixture.expected, actual)).toEqual([]);
  });
});
