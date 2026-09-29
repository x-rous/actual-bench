import { createVersionRegistry, type VersionLookup, type VersionRegistry } from "../versions";
import { actual360 } from "./act360";
import { actual365Fixed } from "./act365f";
import { actualActualCalendar } from "./actact";
import { monthly30360ActualDayAllocation } from "./monthly-30-360-alloc";
import { DAY_COUNT_IDS, type DayCountConvention, type DayCountId } from "./types";

/**
 * Which day-count conventions exist, and which a user may select (FR-038,
 * FR-050, FR-215).
 *
 * Implemented is not selectable. A convention is selectable only when its
 * fixture family's SOURCES.md is `status: verified` and every fixture in that
 * family passes through the engine; `registry.test.ts` reads the fixtures and
 * fails if this table claims more than they show. Each convention stands
 * alone: one family's missing source never holds back another.
 */

export type DayCountEntry = {
  id: DayCountId;
  /** Fixture family under loan/__fixtures__/. */
  fixtureFamily: string;
  /** Current implementation, or null while the convention is gated. */
  current: DayCountConvention | null;
  selectable: boolean;
  /** Why a convention is not selectable. */
  unavailableReason: string | null;
};

export const DAY_COUNT_CATALOG: Readonly<Record<DayCountId, DayCountEntry>> = {
  "actual-365-fixed": {
    id: "actual-365-fixed",
    fixtureFamily: "act365f",
    current: actual365Fixed,
    selectable: true,
    unavailableReason: null,
  },
  "actual-actual-calendar": {
    id: "actual-actual-calendar",
    fixtureFamily: "actact",
    current: actualActualCalendar,
    selectable: true,
    unavailableReason: null,
  },
  "actual-360": {
    id: "actual-360",
    fixtureFamily: "act360",
    current: actual360,
    selectable: true,
    unavailableReason: null,
  },
  "monthly-30-360-actual-day-allocation": {
    id: "monthly-30-360-actual-day-allocation",
    fixtureFamily: "monthly-alloc",
    current: monthly30360ActualDayAllocation,
    selectable: false,
    unavailableReason: "No verified published source yet (loan/__fixtures__/monthly-alloc/SOURCES.md).",
  },
  "msrb-g33-30-360": {
    id: "msrb-g33-30-360",
    fixtureFamily: "msrb-g33-30-360",
    current: null,
    selectable: false,
    unavailableReason:
      "Frozen and fixture-backed (MSRB Rule G-33(e)), but not implemented or exposed: no loan source yet requires this day count (loan/daycount/THIRTY_360.md).",
  },
};

export function isDayCountId(value: string): value is DayCountId {
  return (DAY_COUNT_IDS as readonly string[]).includes(value);
}

export function isSelectableDayCount(value: string): value is DayCountId {
  return isDayCountId(value) && DAY_COUNT_CATALOG[value].selectable;
}

export function selectableDayCounts(): DayCountId[] {
  return DAY_COUNT_IDS.filter((id) => DAY_COUNT_CATALOG[id].selectable);
}

/** The convention to calculate with, or null when it is unknown or not selectable. */
export function selectableDayCount(value: string): DayCountConvention | null {
  return isSelectableDayCount(value) ? DAY_COUNT_CATALOG[value].current : null;
}

// Every version of every implemented convention stays callable by id, so a
// stored result can be recomputed with the version that produced it (FR-183).
const registries = new Map<string, VersionRegistry<DayCountConvention>>();
for (const entry of Object.values(DAY_COUNT_CATALOG)) {
  if (!entry.current) continue;
  const name = entry.current.version.split("@")[0];
  const registry = createVersionRegistry<DayCountConvention>(name);
  registry.register(entry.current.version, entry.current);
  registries.set(name, registry);
}

/** Look up a recorded day-count version such as `daycount-act365f@1`. */
export function resolveDayCountVersion(version: string): VersionLookup<DayCountConvention> {
  const registry = registries.get(version.split("@")[0]);
  return registry ? registry.resolve(version) : { ok: false, code: "unsupported-engine-version", version };
}
