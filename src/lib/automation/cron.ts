/**
 * A restricted 5-field cron parser (RD-079 / PR-043b).
 *
 * Decision (PR-043's open question, settled here): parse cron in-house rather
 * than add a dependency. The surface we need is small and fixed — `*`, lists,
 * ranges, and steps over five fields — and the alternative is taking a
 * dependency into the server boot path for a few hundred lines of arithmetic we
 * can test exhaustively.
 *
 * Deliberately *not* supported, because each is a way to be surprised by your
 * own schedule: `@reboot`/`@yearly` macros, `L`/`W`/`#` day modifiers, seconds,
 * and years. A schedule Bench cannot explain in one sentence is a schedule that
 * will silently do the wrong thing at 3am.
 *
 * Day-of-month and day-of-week follow the cron convention: when both are
 * restricted, a day matches if *either* matches.
 */

export type CronField = {
  /** Sorted, de-duplicated allowed values. */
  values: number[];
  /** True when the field was `*` (or an equivalent full range). */
  wildcard: boolean;
};

export type CronExpression = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

type FieldSpec = { name: string; min: number; max: number };

const FIELD_SPECS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 7 is accepted for Sunday on input and normalized to 0.
  { name: "day-of-week", min: 0, max: 7 },
];

function parseNumber(raw: string, spec: FieldSpec): number {
  if (!/^\d+$/.test(raw)) {
    throw new CronParseError(`${spec.name}: "${raw}" is not a number`);
  }
  const value = Number(raw);
  if (value < spec.min || value > spec.max) {
    throw new CronParseError(`${spec.name}: ${value} is outside ${spec.min}-${spec.max}`);
  }
  return value;
}

function parseTerm(term: string, spec: FieldSpec, into: Set<number>): boolean {
  const [rangePart, stepPart, ...rest] = term.split("/");
  if (rest.length > 0) throw new CronParseError(`${spec.name}: "${term}" has more than one step`);

  let step = 1;
  if (stepPart !== undefined) {
    step = parseNumber(stepPart, { ...spec, min: 1, max: spec.max });
    if (step < 1) throw new CronParseError(`${spec.name}: step must be at least 1`);
  }

  let start: number;
  let end: number;
  let wildcard = false;

  if (rangePart === "*") {
    start = spec.min;
    end = spec.max;
    wildcard = stepPart === undefined;
  } else if (rangePart.includes("-")) {
    const [from, to, ...extra] = rangePart.split("-");
    if (extra.length > 0) throw new CronParseError(`${spec.name}: "${rangePart}" is not a range`);
    start = parseNumber(from, spec);
    end = parseNumber(to, spec);
    if (end < start) throw new CronParseError(`${spec.name}: range ${rangePart} ends before it starts`);
  } else {
    start = parseNumber(rangePart, spec);
    end = stepPart === undefined ? start : spec.max;
  }

  for (let value = start; value <= end; value += step) into.add(value);
  return wildcard;
}

function parseField(raw: string, spec: FieldSpec): CronField {
  const values = new Set<number>();
  let wildcard = false;

  for (const term of raw.split(",")) {
    const trimmed = term.trim();
    if (!trimmed) throw new CronParseError(`${spec.name}: empty term in "${raw}"`);
    if (parseTerm(trimmed, spec, values)) wildcard = true;
  }

  // Sunday is both 0 and 7 on input; the matcher only ever sees 0.
  if (spec.name === "day-of-week" && values.delete(7)) values.add(0);

  if (values.size === 0) throw new CronParseError(`${spec.name}: "${raw}" matches nothing`);

  return { values: [...values].sort((a, b) => a - b), wildcard };
}

export function parseCronExpression(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(
      `A cron schedule needs exactly 5 fields (minute hour day-of-month month day-of-week); got ${fields.length}`
    );
  }

  return {
    minute: parseField(fields[0], FIELD_SPECS[0]),
    hour: parseField(fields[1], FIELD_SPECS[1]),
    dayOfMonth: parseField(fields[2], FIELD_SPECS[2]),
    month: parseField(fields[3], FIELD_SPECS[3]),
    dayOfWeek: parseField(fields[4], FIELD_SPECS[4]),
  };
}

/** True when this expression can be parsed. For form validation. */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does a calendar day match? Cron's day rule: when both day-of-month and
 * day-of-week are restricted, either matching is enough.
 */
export function cronMatchesDay(
  cron: CronExpression,
  parts: { month: number; day: number; weekday: number }
): boolean {
  if (!cron.month.values.includes(parts.month)) return false;

  const domRestricted = !cron.dayOfMonth.wildcard;
  const dowRestricted = !cron.dayOfWeek.wildcard;
  const domMatch = cron.dayOfMonth.values.includes(parts.day);
  const dowMatch = cron.dayOfWeek.values.includes(parts.weekday);

  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  if (domRestricted) return domMatch;
  if (dowRestricted) return dowMatch;
  return true;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function listNames(values: number[], names: string[]): string {
  const labels = values.map((value) => names[value] ?? String(value));
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A one-line, plain-language reading of a schedule for the Automations list.
 *
 * Falls back to the raw expression rather than guessing: a wrong description of
 * when something runs is worse than no description.
 */
export function describeCronExpression(expression: string): string {
  let cron: CronExpression;
  try {
    cron = parseCronExpression(expression);
  } catch {
    return expression;
  }

  const everyMinute = cron.minute.wildcard;
  const everyHour = cron.hour.wildcard;
  const everyDay = cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard && cron.month.wildcard;

  const times =
    !everyMinute && !everyHour
      ? cron.hour.values
          .flatMap((hour) => cron.minute.values.map((minute) => `${pad(hour)}:${pad(minute)}`))
          .slice(0, 4)
          .join(", ")
      : null;

  const suffix = cron.hour.values.length * cron.minute.values.length > 4 ? " and more" : "";

  if (times && everyDay) {
    return `Daily at ${times}${suffix}`;
  }

  // Each shape below describes *one* restricted day field. When more than one
  // is restricted the sentence would be a half-truth ("Tuesday at 03:00" for a
  // schedule that also only runs on the 5th of January), so fall through to the
  // raw expression instead.
  if (times && !cron.dayOfWeek.wildcard && cron.dayOfMonth.wildcard && cron.month.wildcard) {
    return `${listNames(cron.dayOfWeek.values, WEEKDAY_NAMES)} at ${times}${suffix}`;
  }

  if (times && !cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard && cron.month.wildcard) {
    return `Day ${cron.dayOfMonth.values.join(", ")} of the month at ${times}${suffix}`;
  }

  if (everyMinute && everyHour && everyDay) return "Every minute";

  if (!everyMinute && everyHour && everyDay) {
    return cron.minute.values.length === 1
      ? `Hourly at :${pad(cron.minute.values[0])}`
      : `Hourly at :${cron.minute.values.map(pad).join(", :")}`;
  }

  return expression;
}
