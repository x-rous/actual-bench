import { checkFixture } from "../__fixtures__/checks";
import { loadFamily } from "../__fixtures__/harness";
import { DAY_COUNT_CATALOG } from "./registry";

/*
 * Each implemented convention against its own fixture family. Expected values
 * come from the published sources or the independent oracle; this file only
 * runs the engine's primitives and compares, row by row, to the minor unit.
 */

const implemented = Object.values(DAY_COUNT_CATALOG).filter((e) => e.current !== null);

describe.each(implemented.map((e) => [e.id, e] as const))("%s fixtures", (_id, entry) => {
  const fixtures = loadFamily(entry.fixtureFamily);

  it("has at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))("%s matches to the minor unit", (_name, fixture) => {
    expect((fixture.input as { convention: string }).convention).toBe(entry.id);
    expect(checkFixture(fixture, entry.current!)).toEqual([]);
  });
});
