import { cronMatchesDay, describeCronExpression, parseCronExpression } from "./cron";
import type { AutomationDefinition } from "@/lib/app-db/types";

/**
 * When does an automation run next? (RD-079 / PR-043b)
 *
 * Pure functions over a definition and a clock — no database, no side effects —
 * in the style of `selectUnattendedFlowsToRun`, so the scheduling rules can be
 * tested exhaustively without a server.
 *
 * All arithmetic goes through `Intl.DateTimeFormat` for the definition's IANA
 * zone rather than a date library. Two DST behaviors are chosen deliberately,
 * because both defaults are otherwise wrong for someone:
 *
 *   * **Skipped local time** (spring forward, e.g. 02:30 on the day 02:00→03:00
 *     doesn't exist): the run happens at the next local minute that *does*
 *     exist. Skipping the day entirely would silently drop a backup.
 *   * **Repeated local time** (fall back, 02:30 happens twice): the run happens
 *     once, at the first occurrence. Running twice would double-post anything
 *     that isn't idempotent.
 */

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday, matching cron's day-of-week numbering. */
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant, in the given zone. */
export function zonedParts(instantMs: number, timezone: string): ZonedParts {
  const parts = formatterFor(timezone).formatToParts(new Date(instantMs));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? "0";

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    // Intl renders midnight as hour 24 in some environments; normalize it.
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
    weekday: WEEKDAY_INDEX[read("weekday")] ?? 0,
  };
}

/** Zone offset in ms at a given instant (UTC + offset = local). */
function offsetAt(instantMs: number, timezone: string): number {
  const parts = zonedParts(instantMs, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  // Instants carry seconds we dropped above; compare on the same minute floor.
  return asUtc - Math.floor(instantMs / 60_000) * 60_000;
}

/**
 * The instant at which the given wall-clock time occurs in a zone.
 *
 * Two passes: guess with the offset at the naive instant, then re-read the
 * offset at the guess and correct. That resolves ordinary cases exactly and
 * lands adjacent to the boundary in DST cases, which the caller then verifies.
 */
export function instantFromLocal(
  local: Omit<ZonedParts, "weekday">,
  timezone: string
): number {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let instant = naive - offsetAt(naive, timezone);
  instant = naive - offsetAt(instant, timezone);
  return instant;
}

function sameWallClock(instantMs: number, local: Omit<ZonedParts, "weekday">, timezone: string): boolean {
  const parts = zonedParts(instantMs, timezone);
  return (
    parts.year === local.year &&
    parts.month === local.month &&
    parts.day === local.day &&
    parts.hour === local.hour &&
    parts.minute === local.minute
  );
}

/**
 * Resolve a wall-clock time to the instant a run should happen, honoring the
 * two DST rules above. Returns null when the time cannot be placed at all.
 */
function resolveLocalFireTime(
  local: Omit<ZonedParts, "weekday">,
  timezone: string
): number | null {
  const instant = instantFromLocal(local, timezone);

  if (sameWallClock(instant, local, timezone)) {
    // Repeated local hour: take the *first* occurrence, so a fall-back night
    // fires once. If an hour earlier still reads as the same wall clock, that
    // earlier instant is the first one.
    const anHourEarlier = instant - 3_600_000;
    if (sameWallClock(anHourEarlier, local, timezone)) return anHourEarlier;
    return instant;
  }

  // Skipped local hour. The wall-clock time never happens, so the run belongs
  // at the moment the gap closes — 03:00 for an 02:30 schedule, not 03:30.
  // That is the first instant on the same local day at or after the target, so
  // scan the window around the transition and take the earliest one.
  //
  // Only reachable when the fast path above missed, which is at most one hour
  // of local times once or twice a year; the scan cost never touches the
  // ordinary case.
  const windowStart = instant - 180 * 60_000;
  for (let offset = 0; offset <= 360; offset += 1) {
    const candidate = windowStart + offset * 60_000;
    const parts = zonedParts(candidate, timezone);
    if (
      parts.year === local.year &&
      parts.month === local.month &&
      parts.day === local.day &&
      (parts.hour > local.hour || (parts.hour === local.hour && parts.minute >= local.minute))
    ) {
      return candidate;
    }
  }

  return null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Search horizon. A schedule that never fires within four years is a mistake,
 * not a schedule, and the caller surfaces it as one rather than looping. */
const MAX_SEARCH_DAYS = 366 * 4;

/**
 * The next instant at or after `afterMs` (exclusive) matching a cron
 * expression in a zone, or null if the expression can never fire.
 */
export function nextCronRun(
  expression: string,
  timezone: string,
  afterMs: number
): number | null {
  const cron = parseCronExpression(expression);
  const start = zonedParts(afterMs, timezone);

  let year = start.year;
  let month = start.month;
  let day = start.day;

  for (let dayOffset = 0; dayOffset <= MAX_SEARCH_DAYS; dayOffset += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

    if (cronMatchesDay(cron, { month, day, weekday })) {
      for (const hour of cron.hour.values) {
        for (const minute of cron.minute.values) {
          const local = { year, month, day, hour, minute };
          const instant = resolveLocalFireTime(local, timezone);
          if (instant !== null && instant > afterMs) return instant;
        }
      }
    }

    day += 1;
    if (day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }

  return null;
}

/**
 * The floor on unattended frequency, inherited from RD-058: each run opens and
 * syncs a whole budget, so a one-minute schedule would spend all its time
 * re-opening budgets. Applied to interval schedules; a cron schedule is the
 * user being explicit, and is trusted as written.
 */
export const MIN_INTERVAL_MINUTES = 15;

export function nextIntervalRun(
  intervalMinutes: number,
  lastRunAtMs: number | null,
  nowMs: number
): number {
  const effective = Math.max(intervalMinutes, MIN_INTERVAL_MINUTES);
  if (lastRunAtMs === null) return nowMs;
  return lastRunAtMs + effective * 60_000;
}

export type DueInput = {
  definition: Pick<
    AutomationDefinition,
    | "scheduleKind"
    | "intervalMinutes"
    | "cronExpression"
    | "timezone"
    | "enabled"
    | "autoPausedAt"
    | "consecutiveFailures"
    | "failurePolicy"
  >;
  /** Start of the definition's most recent run, ms. */
  lastRunAtMs: number | null;
  nowMs: number;
  /**
   * A stored "not before" floor (`next_run_at`), honoured in addition to the
   * schedule. It carries a position the schedule alone cannot know — chiefly a
   * flow migrated onto the engine, whose last run predates any automation run
   * history and which would otherwise be treated as never-run and fire at once.
   *
   * Cleared whenever the schedule is edited, so a shortened interval takes
   * effect immediately rather than waiting out a floor set under the old one.
   */
  notBeforeMs?: number | null;
};

/**
 * The next run instant, or null when the automation will never run as
 * configured (disabled, paused, or an unfireable expression).
 *
 * For cron this is the next occurrence **after the last run**, not after now.
 * Searching from `now` was a bug: the answer was then always in the future, so
 * `isDue` could never be true and cron automations never fired at all.
 *
 * Measuring from the last run also gives the right catch-up behaviour for free.
 * A server that was down for three days has one occurrence due immediately;
 * once it runs, `lastRunAtMs` moves to that moment and the following occurrence
 * is back in the future — so a missed daily job runs **once**, not once per
 * missed day.
 */
export function nextRunAt(input: DueInput): number | null {
  const { definition, lastRunAtMs, nowMs } = input;
  if (!definition.enabled || definition.autoPausedAt) return null;

  if (definition.scheduleKind === "cron") {
    if (!definition.cronExpression) return null;
    // Never run: the first occurrence is the next one after now, so creating an
    // automation does not fire it immediately.
    const from = lastRunAtMs ?? nowMs;
    try {
      return nextCronRun(definition.cronExpression, definition.timezone, from);
    } catch {
      return null;
    }
  }

  if (!definition.intervalMinutes) return null;
  return nextIntervalRun(definition.intervalMinutes, lastRunAtMs, nowMs);
}

/**
 * How long after a failed run the schedule is held back.
 *
 * Doubles with each consecutive failure up to the policy ceiling. Applied at
 * *selection* time rather than only stored on the row: a persisted "next run"
 * that the selector ignored would push the displayed time out while the
 * automation kept retrying on its normal schedule underneath.
 */
export function backoffDelayMinutes(
  consecutiveFailures: number,
  policy: { backoffMinutes: number; backoffCeilingMinutes: number }
): number {
  if (consecutiveFailures <= 0) return 0;
  const raw = policy.backoffMinutes * 2 ** (consecutiveFailures - 1);
  return Math.min(raw, policy.backoffCeilingMinutes);
}

/** The instant a failing automation may next be attempted, or null if free. */
export function backoffUntil(input: DueInput): number | null {
  const { definition, lastRunAtMs } = input;
  if (definition.consecutiveFailures <= 0 || lastRunAtMs === null) return null;
  const delayMs =
    backoffDelayMinutes(definition.consecutiveFailures, definition.failurePolicy) * 60_000;
  return lastRunAtMs + delayMs;
}

export function isDue(input: DueInput): boolean {
  const next = nextRunAt(input);
  if (next === null || next > input.nowMs) return false;

  const until = backoffUntil(input);
  if (until !== null && until > input.nowMs) return false;

  return input.notBeforeMs == null || input.notBeforeMs <= input.nowMs;
}

/** When the automation will actually be attempted next: schedule, backoff and
 * any stored floor, whichever is latest. */
export function effectiveNextRunAt(input: DueInput): number | null {
  const next = nextRunAt(input);
  if (next === null) return null;

  const candidates = [next, backoffUntil(input), input.notBeforeMs ?? null].filter(
    (value): value is number => value !== null && value !== undefined
  );
  return Math.max(...candidates);
}

/** Plain-language schedule for the Automations list. */
export function describeSchedule(
  definition: Pick<AutomationDefinition, "scheduleKind" | "intervalMinutes" | "cronExpression" | "timezone">
): string {
  if (definition.scheduleKind === "cron") {
    if (!definition.cronExpression) return "No schedule";
    return `${describeCronExpression(definition.cronExpression)} (${definition.timezone})`;
  }

  const minutes = Math.max(definition.intervalMinutes ?? 0, MIN_INTERVAL_MINUTES);
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  return `Every ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
