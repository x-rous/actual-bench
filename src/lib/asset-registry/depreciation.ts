import { z } from "zod";
import { daysInMonth, isIsoDate, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { divRoundInt } from "@/lib/financial-models/money";
import { dateSchema, type BookMetadata } from "./models";

/** Money is nonnegative integer minor units in the budget's ledger representation; rates are basis points. */
export const DEPRECIATION_METHODS = { "straight-line": "Straight-line", "declining-balance": "Declining balance" } as const;
export type DepreciationMethod = keyof typeof DEPRECIATION_METHODS;
export type DepreciationSettings = {
  assetId: string; method: DepreciationMethod; basisMinor: number; residualMinor: number; startDate: string;
  lifeMonths: number | null; annualRateBps: number | null; updatedAt: string;
};
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const depreciationInputSchema = z.object({
  method: z.enum(["straight-line", "declining-balance"]), basisMinor: money, residualMinor: money, startDate: dateSchema,
  lifeMonths: z.number().int().min(1).max(1200).nullable(), annualRateBps: z.number().int().min(1).max(10000).nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.residualMinor > v.basisMinor) ctx.addIssue({ code: "custom", message: "Residual value cannot exceed the depreciable basis" });
  if (v.method === "straight-line" ? v.lifeMonths === null || v.annualRateBps !== null : v.annualRateBps === null || v.lifeMonths !== null) {
    ctx.addIssue({ code: "custom", message: v.method === "straight-line" ? "Straight-line needs a useful life in months and no rate" : "Declining balance needs an annual rate and no useful life" });
  }
});
export type DepreciationInput = z.infer<typeof depreciationInputSchema>;
export type ScheduleRow = {
  /** `YYYY-MM`; the identity of the posted month across schedule edits. */
  period: string; /** The calendar last day of the period. */ postDate: string;
  /** Planned decrease, a positive integer; zero once the residual is reached. */ amountMinor: number; closingMinor: number;
};
const MAX_ROWS = 1200;
export const monthEnd = (period: string): string => {
  const [year, month] = period.split("-").map(Number);
  return `${period}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
};
const periodAt = (startPeriod: string, offset: number): string => {
  const [year, month] = startPeriod.split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`.padStart(7, "0");
};
export const monthsBetween = (fromPeriod: string, toPeriod: string): number => {
  const [fy, fm] = fromPeriod.split("-").map(Number); const [ty, tm] = toPeriod.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};
/**
 * Pure monthly forecast; it never reads or writes Actual. The first calendar month of `startDate` is a full period.
 * Straight-line rounds the cumulative amount (basis − residual) × n / life half-even, so it lands exactly on the residual.
 * Declining balance depreciates each month by balance × rate / 12 (half-even), never below the residual.
 * Rows run `months` periods from the start (capped), skipping nothing, so identities are stable across edits.
 */
export function depreciationSchedule(settings: Omit<DepreciationSettings, "assetId" | "updatedAt">, months: number): ScheduleRow[] {
  if (!isIsoDate(settings.startDate)) throw new Error("Invalid depreciation start date");
  const start = settings.startDate.slice(0, 7);
  const rows: ScheduleRow[] = [];
  let previous = settings.basisMinor;
  const depreciable = BigInt(settings.basisMinor - settings.residualMinor);
  for (let i = 1; i <= Math.min(Math.max(months, 0), MAX_ROWS); i++) {
    const closing = settings.method === "straight-line"
      ? settings.basisMinor - Number(divRoundInt(depreciable * BigInt(Math.min(i, settings.lifeMonths ?? 1)), BigInt(settings.lifeMonths ?? 1), "half-even"))
      : Math.max(settings.residualMinor, previous - Number(divRoundInt(BigInt(previous) * BigInt(settings.annualRateBps ?? 0), BigInt(120000), "half-even")));
    const period = periodAt(start, i - 1);
    rows.push({ period, postDate: monthEnd(period), amountMinor: previous - closing, closingMinor: closing });
    previous = closing;
  }
  return rows;
}
/** Months to show: through the end of the schedule's life, or a year past the current month, whichever the method defines. */
export function forecastMonths(settings: Pick<DepreciationSettings, "method" | "startDate" | "lifeMonths">, today: string): number {
  const horizon = Math.max(12, monthsBetween(settings.startDate.slice(0, 7), today.slice(0, 7)) + 13);
  return settings.method === "straight-line" ? Math.min(settings.lifeMonths ?? horizon, Math.max(horizon, 12)) : horizon;
}
export type PeriodState = "forecast" | "due" | "posted" | "missing" | "complete";
export type PeriodStatus = ScheduleRow & {
  state: PeriodState;
  /** The Bench association for this month, if any (posted or missing). */
  association: BookMetadata | null;
};
/**
 * Merge a forecast with the saved month associations. `actualIds` is the set of transaction IDs currently present in the
 * asset account: an association whose row is gone is "missing", never silently reposted. A month is due only once its end
 * date has arrived (`postDate <= today`), and a month with no planned decrease is complete.
 */
export function periodStatuses(rows: ScheduleRow[], metadata: BookMetadata[], assetId: string, actualIds: ReadonlySet<string>, today: string): PeriodStatus[] {
  const byPeriod = new Map(metadata.filter((m) => m.assetId === assetId && m.depreciationPeriod).map((m) => [m.depreciationPeriod!, m]));
  return rows.map((row) => {
    const association = byPeriod.get(row.period) ?? null;
    const state: PeriodState = association ? (actualIds.has(association.actualTransactionId) ? "posted" : "missing")
      : row.amountMinor === 0 ? "complete" : row.postDate <= today ? "due" : "forecast";
    return { ...row, state, association };
  });
}
export const isPeriod = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && parseIsoDate(`${value}-01`).month >= 1;
/** Posted months whose Actual row is gone: flagged for attention, never a reason to block other actions. */
export const missingMonths = (metadata: BookMetadata[], assetId: string, actualIds: ReadonlySet<string>): string[] =>
  metadata.filter((m) => m.assetId === assetId && m.depreciationPeriod && !actualIds.has(m.actualTransactionId)).map((m) => m.depreciationPeriod!).sort();
