"use client";

import { formatMonthLabel } from "@/lib/budget/monthMath";
import { formatSummary } from "../../lib/format";
import { InfoTooltip } from "./InfoTooltip";
import type {
  DayProgress,
  DetailsCoverage,
  DetailsTone,
  TrajectoryMetrics,
} from "../../lib/budgetDetailsMetrics";

// Whole-dollar formatting for the chart figures — cents are visual noise here.
function roundedSigned(minor: number): string {
  return `${minor < 0 ? "−" : ""}${formatSummary(Math.abs(minor))}`;
}
function roundedDelta(minor: number): string {
  const sign = minor > 0 ? "+" : minor < 0 ? "−" : "";
  return `${sign}${formatSummary(Math.abs(minor))}`;
}

// ─── coverage strip / day-progress bar ────────────────────────────────────────

export function CoverageStrip({ coverage }: { coverage: DetailsCoverage }) {
  const title = `${coverage.closedCount} of ${coverage.totalMonths} closed · ${coverage.currentCount} in progress · ${coverage.futureCount} planned`;
  return (
    <div className="flex gap-0.5 h-1" title={title} aria-label={title} role="img">
      {coverage.segments.map((status, i) => (
        <span
          key={`${i}-${status}`}
          className={`flex-1 rounded-[1px] ${
            status === "past"
              ? "bg-foreground/35"
              : status === "current-partial"
              ? "bg-primary"
              : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

export function DayProgressBar({ progress }: { progress: DayProgress }) {
  const pct = Math.round(progress.elapsedFraction * 100);
  return (
    <div
      className="relative h-1 rounded-[1px] bg-muted overflow-hidden"
      title={progress.dayLabel}
      aria-label={progress.dayLabel}
      role="img"
    >
      <div
        className={`h-full rounded-[1px] ${
          progress.closed ? "bg-foreground/25" : "bg-primary"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── status chip ──────────────────────────────────────────────────────────────

function chipClasses(tone: DetailsTone): string {
  if (tone === "positive")
    return "text-emerald-700 bg-emerald-500/10 dark:text-emerald-400";
  if (tone === "negative") return "text-destructive bg-destructive/10";
  return "text-muted-foreground bg-muted";
}

function defaultGlyph(tone: DetailsTone): string {
  if (tone === "positive") return "✓";
  if (tone === "negative") return "↑";
  return "•";
}

export function StatusChip({
  label,
  tone,
  glyph,
}: {
  label: string;
  tone: DetailsTone;
  glyph?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold leading-none whitespace-nowrap ${chipClasses(
        tone
      )}`}
    >
      <span aria-hidden="true">{glyph ?? defaultGlyph(tone)}</span>
      {label}
    </span>
  );
}

// ─── trajectory ───────────────────────────────────────────────────────────────

function toneStroke(tone: DetailsTone): string {
  if (tone === "positive") return "var(--color-emerald-500, #10b981)";
  if (tone === "negative") return "var(--color-destructive, #ef4444)";
  return "currentColor";
}

function TrajectorySparkline({
  trajectory,
  lineStroke,
}: {
  trajectory: TrajectoryMetrics;
  lineStroke: string;
}) {
  const pts = trajectory.points;
  const n = pts.length;
  if (n < 2) return null;

  const width = 240;
  const height = 56;
  const padY = 6;
  const xAt = (i: number) => (i / (n - 1)) * width;

  const actualValues = pts
    .map((p) => p.actual)
    .filter((v): v is number => v != null);
  const ys = [
    ...pts.map((p) => p.plan),
    ...actualValues,
    trajectory.projectedValue,
    0,
  ];
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const yAt = (v: number) => padY + (1 - (v - minY) / span) * (height - 2 * padY);

  const planPath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.plan)}`)
    .join(" ");

  const actualPath = pts
    .map((p, i) => (p.actual == null ? null : `${xAt(i)},${yAt(p.actual)}`))
    .filter((s): s is string => s != null)
    .map((s, i) => `${i === 0 ? "M" : "L"}${s}`)
    .join(" ");

  const todayIdx = Math.min(n - 1, Math.max(0, trajectory.todayIndex));
  const todayX = xAt(todayIdx);
  const todayVal = pts[todayIdx]?.actual ?? pts[todayIdx]?.plan ?? 0;
  // Projection = actuals so far, carried to the projected end-of-period value.
  const projectionPath = `M${todayX},${yAt(todayVal)} L${xAt(n - 1)},${yAt(
    trajectory.projectedValue
  )}`;

  // Self-describing chart: the accessible name states the actual figures (not
  // just the shape), and the sr-only list below gives the per-month values that
  // are otherwise only reachable by mouse hover.
  const planWord = trajectory.isSpend ? "budget" : "plan";
  const bankedThrough = pts[todayIdx]?.month;
  const chartLabel =
    `Projected ${trajectory.isSpend ? "spend" : "result"} ${formatSummary(
      trajectory.projectedValue
    )}, full-period ${planWord} ${formatSummary(trajectory.planValue)}, ` +
    `${formatSummary(Math.abs(trajectory.variance))} ${trajectory.varianceLabel} ${planWord}` +
    (bankedThrough ? `; actual banked through ${formatMonthLabel(bankedThrough)}.` : ".");

  return (
    <>
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full h-14 text-muted-foreground"
      role="img"
      aria-label={chartLabel}
    >
      {/* "Now" divider between banked actuals and the projection. */}
      <line
        x1={todayX}
        y1={2}
        x2={todayX}
        y2={height - 2}
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      {/* Plan first, so the actual + projection stay legible above it. */}
      <path
        d={planPath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        opacity={0.85}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={projectionPath}
        fill="none"
        stroke={lineStroke}
        strokeWidth={1.6}
        strokeDasharray="0.1 3.2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={actualPath}
        fill="none"
        stroke={lineStroke}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {/* Invisible hit targets: exact monthly values on mouse hover. Screen
          readers use the sr-only list below instead (the svg is role=img). */}
      {pts.map((p, i) => (
        <circle key={p.month} cx={xAt(i)} cy={yAt(p.actual ?? p.plan)} r={7} fill="transparent">
          <title>
            {`${formatMonthLabel(p.month)} · Plan ${formatSummary(p.plan)}${
              p.actual != null ? ` · Actual ${formatSummary(p.actual)}` : ""
            }`}
          </title>
        </circle>
      ))}
    </svg>
      <ul className="sr-only">
        {pts.map((p) => (
          <li key={p.month}>
            {`${formatMonthLabel(p.month)}: plan ${formatSummary(p.plan)}${
              p.actual != null ? `, actual ${formatSummary(p.actual)}` : ""
            }`}
          </li>
        ))}
      </ul>
    </>
  );
}

function toneText(tone: DetailsTone): string {
  if (tone === "positive") return "text-emerald-700 dark:text-emerald-400";
  if (tone === "negative") return "text-destructive";
  return "text-foreground";
}

export function TrajectorySection({
  trajectory,
}: {
  trajectory: TrajectoryMetrics;
}) {
  const headline = trajectory.isSpend
    ? roundedSigned(trajectory.projectedValue)
    : roundedDelta(trajectory.projectedValue);
  const lineStroke = toneStroke(trajectory.lineTone);
  const n = trajectory.points.length;
  const nowPct =
    n > 1
      ? Math.min(92, Math.max(8, (trajectory.todayIndex / (n - 1)) * 100))
      : 50;

  return (
    <section className="rounded border border-border bg-muted/25 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          {trajectory.label}
        </p>
        <StatusChip label={trajectory.chipLabel} tone={trajectory.chipTone} />
      </div>

      <p
        className={`font-sans tabular-nums text-lg font-semibold leading-none ${toneText(
          trajectory.tone
        )}`}
      >
        {headline}
      </p>

      {trajectory.points.length >= 2 && (
      <div>
        <div className="relative h-3">
          <span
            className="absolute top-0 -translate-x-1/2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
            style={{ left: `${nowPct}%` }}
          >
            Now
          </span>
        </div>
        <TrajectorySparkline trajectory={trajectory} lineStroke={lineStroke} />
        <div className="mt-0.5 flex justify-center gap-3 text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <svg width="16" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="16" y2="2" stroke={lineStroke} strokeWidth="2" />
            </svg>
            Actual
          </span>
          <span className="inline-flex items-center gap-1">
            <svg width="16" height="4" aria-hidden="true">
              <line
                x1="0"
                y1="2"
                x2="16"
                y2="2"
                stroke={lineStroke}
                strokeWidth="2"
                strokeDasharray="0.1 3.2"
                strokeLinecap="round"
              />
            </svg>
            Projection
          </span>
          <span className="inline-flex items-center gap-1">
            <svg width="16" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" opacity="0.85" />
            </svg>
            Plan
          </span>
        </div>
      </div>
      )}

      {trajectory.breakdown && (
        <div className="flex justify-between items-baseline gap-2 pt-0.5 text-[11px] text-muted-foreground tabular-nums">
          <InfoTooltip
            content="Not-yet-closed months (this month + upcoming), projected at their budget — the part of the projection that isn't banked yet."
            className="text-[11px] text-muted-foreground"
          >
            Upcoming plan
            {trajectory.breakdown.openMonthCount > 0
              ? ` · ${trajectory.breakdown.openMonthCount} mo`
              : ""}
          </InfoTooltip>
          <span className="text-right">
            {roundedDelta(trajectory.breakdown.openPlan)}
          </span>
        </div>
      )}

      <div className="flex justify-between items-baseline gap-2">
        <span className="text-muted-foreground text-[11px]">{trajectory.planLabel}</span>
        <span className="font-sans tabular-nums text-right text-[11px] text-foreground">
          {roundedSigned(trajectory.planValue)}
        </span>
      </div>
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-muted-foreground text-[11px]">
          vs {trajectory.isSpend ? "budget" : "plan"}
        </span>
        <span className="font-sans tabular-nums text-right text-[11px] text-muted-foreground">
          {roundedSigned(Math.abs(trajectory.variance))} {trajectory.varianceLabel}
        </span>
      </div>
    </section>
  );
}
