/**
 * The reporting period of Financial Insights: whole months, with the current month
 * cut off at today. Pure; dates are `YYYY-MM-DD` and months `YYYY-MM`.
 */

export const PERIOD_PRESETS = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-6", label: "Last 6 months" },
  { id: "last-12", label: "Last 12 months" },
  { id: "last-24", label: "Last 2 years" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
  { id: "all", label: "All available" },
] as const;

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]["id"];

/** What the user picked: a preset, or an explicit inclusive range of months. */
export type PeriodChoice = { kind: "preset"; id: PeriodPresetId } | { kind: "custom"; startMonth: string; endMonth: string };

export const DEFAULT_PERIOD: PeriodChoice = { kind: "preset", id: "last-12" };

export type ResolvedPeriod = {
  startMonth: string;
  endMonth: string;
  /** Every month from start to end. */
  months: string[];
  startDate: string;
  /** The last day counted: the end of the month, or today while the end month is the current one. */
  endDate: string;
  /** The end month is the current month, so it is incomplete. */
  partial: boolean;
  label: string;
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + count;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The most months a period can hold. */
export const MAX_PERIOD_MONTHS = 2400;

export function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  for (let month = start; month <= end && months.length < MAX_PERIOD_MONTHS; month = addMonths(month, 1)) months.push(month);
  return months;
}

export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function lastDayOf(month: string): string {
  const day = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/**
 * "Last 6 / 12 / 24 months" (Last 2 years) are the most recent complete months, ending last month, so their averages and charts
 * compare like with like. "This month", "This year" and "All available" run to today and are partial.
 * `firstMonth` is the first month with any data; it only matters for "All available".
 */
export function resolvePeriod(choice: PeriodChoice, today: string, firstMonth: string | null): ResolvedPeriod {
  const current = monthOf(today);
  const year = current.slice(0, 4);
  let startMonth: string;
  let endMonth: string;
  let label: string;
  if (choice.kind === "custom") {
    endMonth = choice.endMonth > current ? current : choice.endMonth;
    startMonth = choice.startMonth > endMonth ? endMonth : choice.startMonth;
    label = "";
  } else {
    label = PERIOD_PRESETS.find((p) => p.id === choice.id)?.label ?? "";
    switch (choice.id) {
      case "this-month": startMonth = endMonth = current; break;
      case "last-month": startMonth = endMonth = addMonths(current, -1); break;
      case "last-6": startMonth = addMonths(current, -6); endMonth = addMonths(current, -1); break;
      case "last-12": startMonth = addMonths(current, -12); endMonth = addMonths(current, -1); break;
      case "last-24": startMonth = addMonths(current, -24); endMonth = addMonths(current, -1); break;
      case "this-year": startMonth = `${year}-01`; endMonth = current; break;
      case "last-year": startMonth = `${Number(year) - 1}-01`; endMonth = `${Number(year) - 1}-12`; break;
      default: startMonth = firstMonth && firstMonth < current ? firstMonth : current; endMonth = current; break;
    }
  }
  // However it was chosen, a period is never longer than the months a chart can hold, so what is drawn ends where the dates beside it do.
  const earliest = addMonths(endMonth, -(MAX_PERIOD_MONTHS - 1));
  const clamped = startMonth < earliest;
  if (clamped) startMonth = earliest;
  // A preset that was cut short says the range it covers, not a name that promises more.
  if (choice.kind === "custom" || clamped) label = startMonth === endMonth ? monthLabel(startMonth) : `${monthLabel(startMonth)} – ${monthLabel(endMonth)}`;
  const partial = endMonth === current;
  return {
    startMonth, endMonth, months: monthsBetween(startMonth, endMonth),
    startDate: `${startMonth}-01`, endDate: partial ? today : lastDayOf(endMonth), partial, label,
  };
}

/** The six complete months before the current month, or fewer where history is shorter. */
export function lastCompleteMonths(today: string, firstMonth: string | null, count = 6): string[] {
  const end = addMonths(monthOf(today), -1);
  const start = addMonths(end, -(count - 1));
  return monthsBetween(firstMonth && firstMonth > start ? firstMonth : start, end);
}

/** `2026-01-01` as `01 Jan 2026`: the way every date on the page is written. Anything that is not a date is returned as it is. */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // A date that is not on the calendar (2026-02-30, 2026-13-45) is not a date: it is returned as it is.
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return iso;
  return `${m[3]} ${MONTH_NAMES[month - 1]} ${m[1]}`;
}
