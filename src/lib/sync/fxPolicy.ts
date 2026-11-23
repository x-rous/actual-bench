import { adjustRateByPercent, averageRates, isValidPercent, isValidRate } from "@/lib/fx/fxMath";
import type { SyncFlowPlanConfig } from "./flowConfig";
import type { FxRateInfo } from "./plannedChanges";

/**
 * Which rate a converting flow applies to a row: the daily rate, the mean of the
 * row's month, or one fixed rate, then the flow's bank fee. Rates stay decimal
 * strings and amounts are never touched here.
 */

type FxPolicyConfig = Pick<SyncFlowPlanConfig, "fxRatePolicy" | "fxFixedRate" | "fxMarkupPercent">;

const monthOf = (date: string) => date.slice(0, 7);

function daysInMonth(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** Every day of a month up to and including `today`. */
function monthDatesThrough(month: string, today: string): string[] {
  const out: string[] = [];
  for (let day = 1; day <= daysInMonth(month); day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date <= today) out.push(date);
  }
  return out;
}

/**
 * The dates whose market rates this policy needs. A monthly average needs every
 * day of each month, up to `today`. A fixed rate needs none.
 */
export function fxNeedDates(config: FxPolicyConfig, itemDates: Iterable<string>, today: string): string[] {
  const dates = new Set(itemDates);
  if (config.fxRatePolicy === "fixed") return [];
  if (config.fxRatePolicy !== "monthly_average") return [...dates];
  const out = new Set<string>();
  for (const month of new Set([...dates].map(monthOf))) {
    for (const date of monthDatesThrough(month, today)) out.add(date);
  }
  // A future-dated row keeps its own need, so it reports as waiting for a rate.
  for (const date of dates) if (date > today) out.add(date);
  return [...out];
}

/**
 * Resolves the rate for one row. `null` means the row must wait for a rate.
 * With `today`, a monthly average needs every day of the month up to it: an
 * average of whichever days happened to resolve is not the month's rate.
 */
export function createFxRateResolver(
  config: FxPolicyConfig,
  byDate: ReadonlyMap<string, FxRateInfo> | undefined,
  today?: string
): (date: string, sourceAmount: number) => FxRateInfo | null {
  const monthly = new Map<string, FxRateInfo | null>();

  function monthAverage(month: string): FxRateInfo | null {
    if (monthly.has(month)) return monthly.get(month) ?? null;
    if (today && !monthDatesThrough(month, today).every((date) => byDate?.has(date))) {
      monthly.set(month, null);
      return null;
    }
    const rows = [...(byDate ?? new Map<string, FxRateInfo>()).entries()]
      .filter(([date]) => monthOf(date) === month)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    const info: FxRateInfo | null = rows.length === 0 ? null : {
      rate: averageRates(rows.map(([, row]) => row.rate)),
      effectiveDate: rows[rows.length - 1][0],
      source: "derived",
      provider: rows[0][1].provider,
      fxRateId: null,
    };
    monthly.set(month, info);
    return info;
  }

  function baseRate(date: string): FxRateInfo | null {
    if (config.fxRatePolicy === "fixed") {
      return isValidRate(config.fxFixedRate)
        ? { rate: config.fxFixedRate, effectiveDate: date, source: "manual", provider: null, fxRateId: null }
        : null;
    }
    if (config.fxRatePolicy === "monthly_average") {
      // A future-dated row has no rate of its own yet and must not borrow the month's.
      return byDate?.has(date) ? monthAverage(monthOf(date)) : null;
    }
    return byDate?.get(date) ?? null;
  }

  const markup = config.fxMarkupPercent && isValidPercent(config.fxMarkupPercent) && Number(config.fxMarkupPercent) > 0
    ? config.fxMarkupPercent
    : null;

  return (date, sourceAmount) => {
    const base = baseRate(date);
    if (!base || !markup || sourceAmount === 0) return base;
    // Spending costs more; money received converts to less.
    return { ...base, rate: adjustRateByPercent(base.rate, markup, sourceAmount < 0 ? 1 : -1), source: "derived" };
  };
}
