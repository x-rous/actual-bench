import {
  addDays,
  addMonths,
  compareDates,
  dateInMonth,
  DEFAULT_SHORT_MONTH_POLICY,
  parseIsoDate,
  toDayNumber,
  type IsoDate,
  type ShortMonthPolicy,
} from "./dates";

/**
 * Real-date repayment and charge schedules (FR-040, V3 §10.5).
 *
 * Weekly and fortnightly dates step exactly 7 or 14 calendar days from the
 * first date, straight through 29 February and year ends. They are never
 * grouped into 52 or 26 abstract periods per year: a year can hold 53 weekly
 * or 27 fortnightly dates, and the schedule shows them.
 *
 * Month-based frequencies (monthly, quarterly, annual) are counted from the
 * first date, keeping its day of month as the anchor, so a 31st that clamps to
 * 28 or 29 February returns to the 31st in March.
 */

export const SCHEDULE_VERSION = "schedule@1";

export type ScheduleFrequency =
  | "weekly"
  | "fortnightly"
  | "semi-monthly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "custom-dated";

export const SCHEDULE_FREQUENCIES: readonly ScheduleFrequency[] = [
  "weekly",
  "fortnightly",
  "semi-monthly",
  "monthly",
  "quarterly",
  "annual",
  "custom-dated",
];

export type ScheduleSpec =
  | { frequency: "weekly" | "fortnightly"; firstDate: IsoDate }
  | {
      frequency: "monthly" | "quarterly" | "annual";
      firstDate: IsoDate;
      /** Day of month to keep; defaults to `firstDate`'s day. */
      anchorDay?: number;
      shortMonthPolicy?: ShortMonthPolicy;
    }
  | {
      frequency: "semi-monthly";
      firstDate: IsoDate;
      /** The two days of the month, e.g. `[15, 31]` (31 clamps in short months). */
      days: [number, number];
      shortMonthPolicy?: ShortMonthPolicy;
    }
  | { frequency: "custom-dated"; dates: IsoDate[] };

/** Inclusive window of dates to return. */
export type ScheduleWindow = { from: IsoDate; to: IsoDate };

/** Refuses to emit more than this many dates, so a malformed window cannot run away. */
export const MAX_SCHEDULE_DATES = 100_000;

export function generateSchedule(spec: ScheduleSpec, window: ScheduleWindow): IsoDate[] {
  parseIsoDate(window.from);
  parseIsoDate(window.to);
  if (compareDates(window.from, window.to) > 0) throw new RangeError("Schedule window ends before it starts");
  const inWindow = (d: IsoDate) => compareDates(d, window.from) >= 0 && compareDates(d, window.to) <= 0;

  switch (spec.frequency) {
    case "weekly":
    case "fortnightly":
      return stepDays(spec.firstDate, spec.frequency === "weekly" ? 7 : 14, window);
    case "monthly":
    case "quarterly":
    case "annual": {
      const step = spec.frequency === "monthly" ? 1 : spec.frequency === "quarterly" ? 3 : 12;
      const anchor = spec.anchorDay ?? parseIsoDate(spec.firstDate).day;
      const policy = spec.shortMonthPolicy ?? DEFAULT_SHORT_MONTH_POLICY;
      const out: IsoDate[] = [];
      for (let k = 0; ; k++) {
        const date = addMonths(spec.firstDate, k * step, anchor, policy);
        if (compareDates(date, window.to) > 0) break;
        if (compareDates(date, spec.firstDate) >= 0 && inWindow(date)) push(out, date);
      }
      return out;
    }
    case "semi-monthly": {
      const [a, b] = spec.days;
      if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= 31 && a < b)) {
        throw new RangeError(`Semi-monthly days must be two ascending days of the month, got ${a}, ${b}`);
      }
      const policy = spec.shortMonthPolicy ?? DEFAULT_SHORT_MONTH_POLICY;
      const first = parseIsoDate(spec.firstDate);
      const out: IsoDate[] = [];
      for (let k = 0; ; k++) {
        const index = first.year * 12 + (first.month - 1) + k;
        const year = Math.floor(index / 12);
        const month = (index % 12) + 1;
        const firstDay = dateInMonth(year, month, a, policy);
        const secondDay = dateInMonth(year, month, b, policy);
        const pair = secondDay === firstDay ? [firstDay] : [firstDay, secondDay];
        if (compareDates(pair[0], window.to) > 0) break;
        for (const date of pair) {
          if (compareDates(date, spec.firstDate) >= 0 && inWindow(date)) push(out, date);
        }
      }
      return out;
    }
    case "custom-dated": {
      const seen = new Set<number>();
      for (const date of spec.dates) {
        const n = toDayNumber(date);
        if (seen.has(n)) throw new RangeError(`Custom schedule lists ${date} twice`);
        seen.add(n);
      }
      return [...spec.dates].sort((x, y) => compareDates(x, y)).filter(inWindow);
    }
    default:
      throw new RangeError(`Unknown schedule frequency: ${String((spec as { frequency: unknown }).frequency)}`);
  }
}

function stepDays(firstDate: IsoDate, step: number, window: ScheduleWindow): IsoDate[] {
  const first = toDayNumber(firstDate);
  const from = toDayNumber(window.from);
  const to = toDayNumber(window.to);
  // First occurrence on or after the window start, without walking from firstDate.
  const k0 = from <= first ? 0 : Math.ceil((from - first) / step);
  const out: IsoDate[] = [];
  for (let n = first + k0 * step; n <= to; n += step) push(out, addDays(firstDate, n - first));
  return out;
}

function push(out: IsoDate[], date: IsoDate): void {
  if (out.length >= MAX_SCHEDULE_DATES) throw new RangeError(`Schedule exceeds ${MAX_SCHEDULE_DATES} dates`);
  out.push(date);
}
