import { addDays, compareDates } from "@/lib/financial-models/calendar/dates";

export function reconciliationHealth(input: { expectedIntervalDays: number | null; graceDays: number; latestObservationDate: string | null; asOfDate: string }): { overdue: boolean; dueDate: string | null } {
  if (input.expectedIntervalDays === null || input.latestObservationDate === null) return { overdue: false, dueDate: null };
  const dueDate = addDays(input.latestObservationDate, input.expectedIntervalDays + input.graceDays);
  return { overdue: compareDates(input.asOfDate, dueDate) > 0, dueDate };
}
