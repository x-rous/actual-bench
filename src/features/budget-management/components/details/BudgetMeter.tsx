"use client";

import { computeSpendingBar, type SpendingTier } from "../../lib/spendingBar";
import { formatMinor } from "../../lib/format";
import type { BudgetMeterModel } from "../../lib/budgetDetailsMetrics";

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

export function BudgetMeter({ model }: { model: BudgetMeterModel }) {
  const { total, filled, remaining, filledLabel, totalLabel, remainingLabel } = model;
  const bar = computeSpendingBar(total, filled);

  // "0.00 under" is false — when there's no leftover, show just the status word.
  const remainingText =
    remaining === 0 ? remainingLabel : `${formatMinor(Math.abs(remaining))} ${remainingLabel}`;
  const captionLeft = `${filledLabel} ${formatMinor(filled)} of ${formatMinor(total)} ${totalLabel.toLowerCase()}`;
  const isOver = bar.tier === "over" || bar.tier === "unbudgeted";
  // % is only meaningful with a positive track (unfunded spending has total = 0).
  const pct = total > 0 ? Math.round((filled / total) * 100) : null;

  // ARIA determinate range must stay valid: clamp `now` into [0, max]; carry the
  // real amounts (which can exceed the track when over budget) in aria-valuetext.
  const valueMax = Math.max(0, Math.round(total));
  const valueNow = Math.min(Math.max(0, Math.round(filled)), valueMax);

  return (
    <div
      className="rounded border border-border/60 px-2.5 py-2 space-y-1.5"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={`${captionLeft} — ${remainingText}`}
      aria-label={`${captionLeft} — ${remainingText}`}
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
      </div>

      <div className="flex items-baseline justify-between gap-2 text-[10px]">
        <span className="text-muted-foreground/80 tabular-nums truncate">
          {captionLeft}
          {pct !== null && <span className="ml-1 text-muted-foreground/60">· {pct}%</span>}
        </span>
        <span
          className={`shrink-0 font-medium tabular-nums ${
            isOver ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {remainingText}
        </span>
      </div>
    </div>
  );
}
