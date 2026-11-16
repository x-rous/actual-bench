import type { Schedule } from "@/types/entities";

/**
 * The upcoming dates of an Actual schedule, following Actual's own recurrence rules (interval, monthly patterns, end
 * conditions, weekend shift). Calendar arithmetic in UTC, so a date never shifts with the time zone. The schedule's saved
 * next date is the lower bound: it already carries skips and postponements. Actual does not expose skips of later
 * occurrences, so those cannot be known here.
 */

const DAY = 86_400_000;
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
const stamp = (value: string) => Date.parse(`${value}T00:00:00Z`);
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(stamp(value)) && iso(stamp(value)) === value;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export type ScheduleDates = { ok: true; dates: string[] } | { ok: false; problem: string };

const problem = (text: string): ScheduleDates => ({ ok: false, problem: text });

/** Dates from the schedule's next date up to `to` (inclusive), in order. */
export function scheduleDates(schedule: Pick<Schedule, "completed" | "nextDate" | "date">, to: string): ScheduleDates {
  if (schedule.completed) return { ok: true, dates: [] };
  const next = schedule.nextDate;
  if (!isDate(next)) return problem("Actual gives no next date for it");
  if (typeof schedule.date === "string") return { ok: true, dates: next <= to ? [next] : [] };
  const config = schedule.date;
  if (!config || !isDate(config.start)) return problem("its recurrence could not be read");
  const interval = config.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 10_000 || !["daily", "weekly", "monthly", "yearly"].includes(config.frequency)) return problem("its recurrence is not supported");
  const endMode = config.endMode ?? "never";
  if (endMode === "on_date" && !isDate(config.endDate)) return problem("its end date could not be read");
  if (endMode === "after_n_occurrences" && (!Number.isSafeInteger(config.endOccurrences) || (config.endOccurrences ?? 0) < 1)) return problem("its end could not be read");
  const patterns = config.frequency === "monthly" ? config.patterns ?? [] : [];
  for (const p of patterns) {
    const fine = Number.isInteger(p.value) && p.value !== 0 && (p.type === "day" ? p.value >= -31 && p.value <= 31 : WEEKDAYS.includes(p.type) && p.value >= -5 && p.value <= 5);
    if (!fine) return problem("its monthly pattern is not supported");
  }

  const start = stamp(config.start), startDate = new Date(start), last = stamp(to) + 3 * DAY;
  if ((last - start) / DAY > 40_000) return problem("it started too long ago to work out");
  const counts = [0, 0];
  const dates = new Set<string>();
  if (next <= to) dates.add(next);
  for (let value = start; value <= last; value += DAY) {
    const date = new Date(value), day = date.getUTCDate();
    const monthDays = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const days = (value - start) / DAY;
    const monthsApart = (date.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + date.getUTCMonth() - startDate.getUTCMonth();
    let rules: number[] = [];
    if (config.frequency === "daily" && days % interval === 0) rules = [0];
    if (config.frequency === "weekly" && days % (7 * interval) === 0) rules = [0];
    if (config.frequency === "monthly" && monthsApart % interval === 0) {
      if (!patterns.length && day === startDate.getUTCDate()) rules = [0];
      if (patterns.some((p) => p.type === "day" && day === (p.value < 0 ? monthDays + p.value + 1 : p.value))) rules.push(0);
      if (patterns.some((p) => p.type === WEEKDAYS[date.getUTCDay()] && p.value === (p.value < 0 ? -Math.floor((monthDays - day) / 7) - 1 : Math.floor((day - 1) / 7) + 1))) rules.push(1);
    }
    if (config.frequency === "yearly" && (date.getUTCFullYear() - startDate.getUTCFullYear()) % interval === 0 && date.getUTCMonth() === startDate.getUTCMonth() && day === startDate.getUTCDate()) rules = [0];
    if (!rules.length) continue;
    if (endMode === "on_date" && iso(value) > config.endDate!) continue;
    const eligible = rules.map((rule) => { counts[rule]++; return endMode !== "after_n_occurrences" || counts[rule] <= config.endOccurrences!; }).some(Boolean);
    if (!eligible) continue;
    let shifted = value;
    if (config.skipWeekend && (date.getUTCDay() === 0 || date.getUTCDay() === 6)) {
      shifted += config.weekendSolveMode === "before" ? -(date.getUTCDay() === 6 ? 1 : 2) * DAY : (date.getUTCDay() === 6 ? 2 : 1) * DAY;
    }
    const actual = iso(shifted);
    if (actual > next && actual <= to) dates.add(actual);
  }
  return { ok: true, dates: [...dates].sort() };
}
