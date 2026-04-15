/**
 * Human-readable recurrence summary for display in the table and drawer.
 * Pure function — no side effects, no imports from outside this module.
 */

import type { RecurConfig } from "@/types/entities";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  if (n === -1) return "last";
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
  if (mod10 === 1) return `${abs}st`;
  if (mod10 === 2) return `${abs}nd`;
  if (mod10 === 3) return `${abs}rd`;
  return `${abs}th`;
}

const WEEKDAY: Record<string, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function formatDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMonthDay(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function weekdayFromIso(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-US", { weekday: "long" });
}

const SINGULAR_LABEL: Record<string, string> = {
  day: "Daily",
  week: "Weekly",
  year: "Yearly",
};

function every(interval: number | undefined, unit: string): string {
  const n = interval ?? 1;
  if (n === 1) return SINGULAR_LABEL[unit] ?? (unit.charAt(0).toUpperCase() + unit.slice(1));
  return `Every ${n} ${unit}s`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a short human-readable summary of a schedule's date field.
 * Returns "" when date is undefined.
 */
export function recurSummary(date: string | RecurConfig | undefined): string {
  if (!date) return "";

  // One-time schedule
  if (typeof date === "string") {
    return `On ${formatDate(date)}`;
  }

  const {
    frequency,
    interval,
    patterns,
    skipWeekend,
    weekendSolveMode,
    endMode,
    endOccurrences,
    endDate,
    start,
  } = date;

  // ── Base frequency phrase ────────────────────────────────────────────────────
  let base: string;

  switch (frequency) {
    case "daily":
      base = every(interval, "day");
      break;
    case "weekly":
      base = `${every(interval, "week")} on ${weekdayFromIso(start)}`;
      break;
    case "yearly":
      base = `${every(interval, "year")} on ${formatMonthDay(start)}`;
      break;
    case "monthly": {
      const prefix = interval && interval > 1 ? `Every ${interval} months` : "Monthly";
      if (patterns && patterns.length > 0) {
        const p = patterns[0];
        if (p.type === "day") {
          const dayLabel = p.value === -1 ? "last day" : `${ordinal(p.value)}`;
          base = `${prefix} on the ${dayLabel}`;
        } else {
          const weekNum = p.value === -1 ? "last" : ordinal(p.value);
          const weekDay = WEEKDAY[p.type] ?? p.type;
          base = `${prefix} on the ${weekNum} ${weekDay}`;
        }
      } else {
        const d = parseIsoDate(start);
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const dayLabel = d.getDate() === lastDayOfMonth ? "last day" : ordinal(d.getDate());
        base = `${prefix} on the ${dayLabel}`;
      }
      break;
    }
    default:
      base = frequency;
  }

  // ── Suffixes ─────────────────────────────────────────────────────────────────
  const parts: string[] = [base];

  if (skipWeekend) {
    const dir = weekendSolveMode === "after" ? "after" : "before";
    parts.push(`weekends → ${dir}`);
  }

  if (endMode === "after_n_occurrences" && endOccurrences) {
    parts.push(`ends after ${endOccurrences}×`);
  } else if (endMode === "on_date" && endDate) {
    parts.push(`ends ${formatDate(endDate)}`);
  }

  return parts.join(" · ");
}

/**
 * Short label used for the frequency filter pill and table badge.
 */
export function frequencyLabel(date: string | RecurConfig | undefined): string {
  if (!date) return "Once";
  if (typeof date === "string") return "Once";
  const f = date.frequency;
  return f.charAt(0).toUpperCase() + f.slice(1);
}
