"use client";

import { computeSpendingBar, type SpendingTier } from "../../lib/spendingBar";
import { formatMinor, formatSummary } from "../../lib/format";
import type { BudgetMeterModel, DetailsTone } from "../../lib/budgetDetailsMetrics";
import { PrimaryMetric } from "./DetailsPrimitives";

/**
 * Horizontal budget-vs-spent meter for the details panel (F-086).
 *
 * Renders the panel's hero number as a bar: a track (money available / budgeted),
 * a filled segment (spent / received), the remaining leftover, and a red overflow
 * segment when over. It reuses `computeSpendingBar` so the colour tiers match the
 * in-grid spending bars. The exact numbers stay in the caption and the panel's
 * metric lines — the bar is the glance.
 */

const FILL_CLASS: Record<Exclude<SpendingTier, "none" | "empty">, string> = {
  under: "bg-emerald-500/45 dark:bg-emerald-400/40",
  near: "bg-amber-500/55 dark:bg-amber-500/50",
  over: "bg-amber-500/55 dark:bg-amber-500/50",
  unbudgeted: "bg-destructive/30",
};

export function BudgetMeter({
  model,
  embedded = false,
  elapsedFraction,
}: {
  model: BudgetMeterModel;
  /**
   * When true, the meter renders without its own border/padding and drops the
   * visible remaining-text — used inside the primary-metric box, whose headline
   * (e.g. "Under budget by $80") already states the leftover. The full text is
   * still in the accessible name.
   */
  embedded?: boolean;
  /**
   * For an in-progress month: draws a marker on the bar at the fraction of the
   * month elapsed, so "spent faster than time" reads at a glance (matches the
   * period view's "This month so far" meter).
   */
  elapsedFraction?: number;
}) {
  const { total, filled, remaining, filledLabel, totalLabel, remainingLabel } = model;
  const bar = computeSpendingBar(total, filled);

  // "0.00 under" is false — when there's no leftover, show just the status word.
  const remainingText =
    remaining === 0 ? remainingLabel : `${formatMinor(Math.abs(remaining))} ${remainingLabel}`;
  // Whole-dollar figures on the bar itself — cents are noise here; the exact
  // remaining amount still carries its precision in the status text/aria.
  const captionLeft = `${filledLabel} ${formatSummary(filled)} of ${formatSummary(total)} ${totalLabel.toLowerCase()}`;
  const isOver = bar.tier === "over" || bar.tier === "unbudgeted";
  // % is only meaningful with a positive track (unfunded spending has total = 0).
  const pct = total > 0 ? Math.round((filled / total) * 100) : null;

  // ARIA determinate range must stay valid: clamp `now` into [0, max]; carry the
  // real amounts (which can exceed the track when over budget) in aria-valuetext.
  const valueMax = Math.max(0, Math.round(total));
  const valueNow = Math.min(Math.max(0, Math.round(filled)), valueMax);

  return (
    <div
      className={
        embedded ? "space-y-1.5" : "rounded border border-border/60 px-2.5 py-2 space-y-1.5"
      }
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={`${captionLeft} - ${remainingText}`}
      aria-label={`${captionLeft} - ${remainingText}`}
    >
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]"
        aria-hidden="true"
      >
        {bar.tier !== "empty" && (
          <span
            className={`absolute inset-y-0 left-0 ${
              FILL_CLASS[bar.tier as Exclude<SpendingTier, "none" | "empty">]
            }`}
            style={{ width: `${bar.fill * 100}%` }}
          />
        )}
        {bar.overflow > 0 && (
          <span
            className="absolute inset-y-0 right-0 bg-destructive/55"
            style={{ width: `${bar.overflow * 100}%` }}
          />
        )}
        {elapsedFraction != null && (
          <span
            className="absolute inset-y-0 z-10 w-px bg-foreground/55"
            style={{ left: `${Math.min(100, Math.max(0, elapsedFraction * 100))}%` }}
          />
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2 text-[10.5px]">
        <span className="text-muted-foreground tabular-nums truncate">
          {captionLeft}
          {pct !== null && <span className="ml-1 text-muted-foreground">· {pct}%</span>}
        </span>
        {!embedded && (
          <span
            className={`shrink-0 font-medium tabular-nums ${
              isOver ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {remainingText}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The status headline for a standalone meter box (used in summary contexts where
 * the meter does NOT mirror the panel's primary number). Phrased per mental model:
 * envelope → "Left to spend / Overspent"; tracking expense → "Under/Over budget by";
 * tracking income → "Ahead by / Left to receive". `value` is null on an exact match.
 */
export function meterStatus(model: BudgetMeterModel): {
  label: string;
  value: number | null;
  tone: DetailsTone;
} {
  const { remaining, variant } = model;
  const amount = Math.abs(remaining);
  if (variant === "income") {
    if (remaining < 0) return { label: "Ahead by", value: amount, tone: "positive" };
    if (remaining > 0) return { label: "Left to receive", value: amount, tone: "neutral" };
    return { label: "On plan", value: null, tone: "neutral" };
  }
  if (variant === "envelope") {
    if (remaining < 0) return { label: "Overspent", value: amount, tone: "negative" };
    return { label: "Left to spend", value: amount, tone: remaining > 0 ? "positive" : "neutral" };
  }
  // tracking expense (plan vs actual)
  if (remaining < 0) return { label: "Over budget by", value: amount, tone: "negative" };
  if (remaining > 0) return { label: "Under budget by", value: amount, tone: "positive" };
  return { label: "On budget", value: null, tone: "neutral" };
}

/**
 * Standalone "budget status" box: a bold status headline (mirroring the meter)
 * plus the bar. Used in the period/month summaries, whose primary box already
 * leads with a different number (Actual Result / To Budget).
 */
export function MeterSection({
  model,
  helper,
  elapsedFraction,
  chip,
  hero = false,
}: {
  model: BudgetMeterModel;
  helper: string;
  elapsedFraction?: number;
  chip?: { label: string; tone: DetailsTone };
  hero?: boolean;
}) {
  const status = meterStatus(model);
  return (
    <PrimaryMetric
      label={status.label}
      value={status.value}
      helper={helper}
      tone={status.tone}
      chip={chip}
      hero={hero}
    >
      <BudgetMeter model={model} embedded elapsedFraction={elapsedFraction} />
    </PrimaryMetric>
  );
}
