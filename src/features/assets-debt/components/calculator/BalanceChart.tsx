"use client";

import type { PeriodSummary } from "@/lib/financial-models/loan/model";
import { formatMinor } from "../../lib/money";

/**
 * The debt balance over time, baseline against the alternative (FR-106).
 * A plain SVG with a text summary for screen readers; the schedule table
 * beside it carries every number, so nothing is conveyed by the chart alone.
 */
export function BalanceChart({ baseline, alternative, digits, currency }: { baseline: PeriodSummary[]; alternative: PeriodSummary[] | null; digits: number; currency: string }) {
  const width = 640;
  const height = 180;
  const series = [baseline, ...(alternative ? [alternative] : [])];
  const max = Math.max(1, ...series.flatMap((s) => s.map((p) => p.closingMinor)));
  const points = (s: PeriodSummary[]) => s.map((p, i) => `${(i / Math.max(1, s.length - 1)) * width},${height - (p.closingMinor / max) * height}`).join(" ");
  const last = (s: PeriodSummary[]) => s.at(-1);
  const summary = [
    `Baseline: ${baseline.length} months, closing at ${formatMinor(last(baseline)?.closingMinor ?? 0, digits, currency)}`,
    alternative ? `Alternative: closing at ${formatMinor(last(alternative)?.closingMinor ?? 0, digits, currency)}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" role="img" aria-label={`Balance over time. ${summary}.`} preserveAspectRatio="none">
        <polyline points={points(baseline)} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" />
        {alternative ? <polyline points={points(alternative)} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" className="text-muted-foreground" /> : null}
      </svg>
      <figcaption className="text-[11px] text-muted-foreground">Solid line: baseline. {alternative ? "Dashed line: the alternative you are trying." : ""}</figcaption>
    </figure>
  );
}
