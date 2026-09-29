import { checkFixture } from "../__fixtures__/checks";
import { familyStatus, loadFamily } from "../__fixtures__/harness";
import {
  DAY_COUNT_CATALOG,
  isSelectableDayCount,
  resolveDayCountVersion,
  selectableDayCount,
  selectableDayCounts,
} from "./registry";
import { DAY_COUNT_IDS, type DayCountConvention } from "./types";

/*
 * The selectable list is a claim; this test checks it against the fixtures.
 * A convention may be selectable only if its family's SOURCES.md says
 * `status: verified` and every fixture in the family passes through the
 * engine. A convention without that evidence must say why it is unavailable.
 */

function familyPasses(family: string, convention: DayCountConvention): boolean {
  const fixtures = loadFamily(family);
  return fixtures.length > 0 && fixtures.every((fixture) => checkFixture(fixture, convention).length === 0);
}

describe("day-count registry", () => {
  it("lists every convention FR-038 names", () => {
    expect([...DAY_COUNT_IDS].sort()).toEqual(
      ["msrb-g33-30-360", "actual-360", "actual-365-fixed", "actual-actual-calendar", "monthly-30-360-actual-day-allocation"].sort()
    );
    expect(Object.keys(DAY_COUNT_CATALOG).sort()).toEqual([...DAY_COUNT_IDS].sort());
  });

  it.each(DAY_COUNT_IDS.map((id) => [id]))("%s: selectable only with verified sources and passing fixtures", (id) => {
    const entry = DAY_COUNT_CATALOG[id];
    const status = familyStatus(entry.fixtureFamily);
    const evidence = status === "verified" && entry.current !== null && familyPasses(entry.fixtureFamily, entry.current);
    if (entry.selectable) {
      expect({ id, status, evidence }).toEqual({ id, status: "verified", evidence: true });
      expect(entry.unavailableReason).toBeNull();
    } else {
      expect(entry.unavailableReason).toEqual(expect.any(String));
    }
  });

  it("records the current evidence exactly", () => {
    expect(selectableDayCounts()).toEqual(["actual-365-fixed", "actual-actual-calendar", "actual-360"]);
    expect(familyStatus("monthly-alloc")).toBe("no-verified-source");
    expect(familyStatus("msrb-g33-30-360")).toBe("verified");
    // Implemented and oracle-verified, still not selectable.
    expect(DAY_COUNT_CATALOG["monthly-30-360-actual-day-allocation"].current).not.toBeNull();
    expect(familyPasses("monthly-alloc", DAY_COUNT_CATALOG["monthly-30-360-actual-day-allocation"].current!)).toBe(true);
    // Frozen and fixture-backed (both fixtures pass the oracle), but not implemented or exposed.
    expect(DAY_COUNT_CATALOG["msrb-g33-30-360"].current).toBeNull();
    expect(loadFamily("msrb-g33-30-360").map((f) => f.source.coverage).sort()).toEqual(["reference", "synthetic"]);
  });

  it("rejects unknown and unselectable conventions", () => {
    expect(isSelectableDayCount("actual-365-fixed")).toBe(true);
    expect(isSelectableDayCount("msrb-g33-30-360")).toBe(false);
    expect(isSelectableDayCount("monthly-30-360-actual-day-allocation")).toBe(false);
    expect(isSelectableDayCount("30/360")).toBe(false);
    expect(selectableDayCount("msrb-g33-30-360")).toBeNull();
    expect(selectableDayCount("actual-360")?.id).toBe("actual-360");
  });

  it("resolves recorded versions and refuses unknown ones", () => {
    const hit = resolveDayCountVersion("daycount-act365f@1");
    expect(hit.ok && hit.impl.id).toBe("actual-365-fixed");
    const alloc = resolveDayCountVersion("daycount-monthly-alloc@1");
    expect(alloc.ok && alloc.impl.id).toBe("monthly-30-360-actual-day-allocation");
    expect(resolveDayCountVersion("daycount-act365f@2")).toMatchObject({ ok: false, code: "unsupported-engine-version" });
    expect(resolveDayCountVersion("daycount-msrb-g33-30-360@1")).toMatchObject({ ok: false, code: "unsupported-engine-version" });
  });
});
