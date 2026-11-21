import { parseCronExpression, CronParseError, type CronExpression } from "./cron";

/**
 * A cron expression read back field by field (RD-079), so the schedule
 * picker can show what each of the five fields means and point at the one
 * that is wrong. Browser-safe and pure.
 */

// ── reading a cron expression field by field ─────────────────────────────────

export const CRON_FIELDS = [
  { key: "minute", label: "Minute", unit: "minute", units: "minutes" },
  { key: "hour", label: "Hour", unit: "hour", units: "hours" },
  { key: "dayOfMonth", label: "Day", unit: "day of the month", units: "days" },
  { key: "month", label: "Month", unit: "month", units: "months" },
  { key: "dayOfWeek", label: "Weekday", unit: "day of the week", units: "days" },
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function name(field: (typeof CRON_FIELDS)[number]["key"], value: number): string {
  if (field === "dayOfWeek") return WEEKDAYS[value] ?? String(value);
  if (field === "month") return MONTHS[value - 1] ?? String(value);
  if (field === "minute") return `:${String(value).padStart(2, "0")}`;
  if (field === "hour") return `${String(value).padStart(2, "0")}h`;
  return String(value);
}

/** Consecutive values joined into ranges: [1,2,3,5] → "Mon–Wed, Fri". */
function compress(field: (typeof CRON_FIELDS)[number]["key"], values: number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; ) {
    let end = index;
    while (end + 1 < values.length && values[end + 1] === values[end] + 1) end += 1;
    parts.push(end - index >= 2 ? `${name(field, values[index])}–${name(field, values[end])}` : values.slice(index, end + 1).map((value) => name(field, value)).join(", "));
    index = end + 1;
  }
  const text = parts.join(", ");
  return text.length > 28 ? `${values.length} ${CRON_FIELDS.find((entry) => entry.key === field)?.units ?? "values"}` : text;
}

export type CronFieldReading = {
  key: (typeof CRON_FIELDS)[number]["key"];
  label: string;
  token: string;
  /** Plain reading of this field, or the reason it is invalid. */
  reading: string;
  valid: boolean;
};

/** Each of the five fields with what it means, so a typo shows where it is. */
export function readCronFields(expression: string): CronFieldReading[] {
  const tokens = expression.trim().split(/\s+/).filter(Boolean);
  const fields = CRON_FIELDS.map((field, index): CronFieldReading => {
    const token = tokens[index] ?? "";
    if (!token) return { key: field.key, label: field.label, token: "", reading: "missing", valid: false };
    const probe = CRON_FIELDS.map((_, position) => (position === index ? token : "*")).join(" ");
    let parsed: CronExpression;
    try {
      parsed = parseCronExpression(probe);
    } catch (error) {
      const message = error instanceof CronParseError ? error.message.replace(/^[a-z-]+: /, "") : "not valid";
      return { key: field.key, label: field.label, token, reading: message, valid: false };
    }
    const values = parsed[field.key];
    const step = /^\*\/(\d+)$/.exec(token);
    const reading = values.wildcard
      ? `every ${field.unit}`
      : step
        ? `every ${step[1]} ${field.units}`
        : compress(field.key, values.values);
    return { key: field.key, label: field.label, token, reading, valid: true };
  });
  if (tokens.length > 5) {
    fields.push({ key: "dayOfWeek", label: "Extra", token: tokens.slice(5).join(" "), reading: "only five fields are allowed", valid: false });
  }
  return fields;
}
