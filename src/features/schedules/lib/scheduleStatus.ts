import type { Schedule } from "@/types/entities";
import type { ScheduleTxRow } from "./scheduleTransactionsQuery";

export type ScheduleStatus = "paid" | "missed" | "due" | "upcoming" | "scheduled" | "completed";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Derives the display status for a schedule, mirroring Actual Budget's UI logic.
 *
 * - "completed" — user explicitly completed the schedule (manual, one-time)
 * - "paid"      — a linked transaction falls within 14 days before nextDate
 *                 up to today (covers payments made slightly early)
 * - "missed"    — nextDate is in the past with no covering transaction
 * - "due"       — nextDate is today with no covering transaction
 * - "upcoming"  — nextDate is within the upcoming window (driven by the
 *                 `upcomingScheduledTransactionLength` budget preference,
 *                 default 14 days) and no covering transaction
 * - "scheduled" — nextDate is beyond the upcoming window
 *
 * Returns null when status cannot be determined (no nextDate, no transactions).
 */
export function computeScheduleStatus(
  schedule: Schedule,
  transactions: ScheduleTxRow[],
  upcomingDays = 14
): ScheduleStatus | null {
  if (schedule.completed) return "completed";

  const today    = todayStr();
  const nextDate = schedule.nextDate;

  if (!nextDate) {
    return transactions.length > 0 ? "paid" : null;
  }

  // A transaction "covers" the current occurrence when its date falls within
  // 14 days before nextDate up to today. The 14-day cushion allows for
  // transactions posted slightly before the scheduled date.
  const coverWindow = addDaysStr(nextDate, -14);
  const hasCoveringTx = transactions.some(
    (tx) => tx.date >= coverWindow && tx.date <= today
  );

  if (hasCoveringTx)   return "paid";
  if (nextDate < today) return "missed";
  if (nextDate === today) return "due";

  // Future date — "upcoming" within the budget's configured window, "scheduled" beyond it
  const upcomingCutoff = addDaysStr(today, upcomingDays);
  if (nextDate <= upcomingCutoff) return "upcoming";
  return "scheduled";
}

export const STATUS_BADGE: Record<ScheduleStatus, { label: string; className: string }> = {
  paid:      { label: "Paid",      className: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400" },
  missed:    { label: "Missed",    className: "bg-destructive/10 text-destructive dark:bg-destructive/20" },
  due:       { label: "Due",       className: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
  upcoming:  { label: "Upcoming",  className: "bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-500" },
  scheduled: { label: "Scheduled", className: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" },
  completed: { label: "Completed", className: "bg-muted text-muted-foreground" },
};
