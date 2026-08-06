"use client";

import type { ReactNode } from "react";
import { formatDelta, formatSigned, formatSummary } from "../../lib/format";
import type {
  BudgetTrendPoint,
  DayProgress,
  DetailsCoverage,
  DetailsTone,
  RelevantStagedImpact,
  ThisMonthMetrics,
  ThisMonthPaceStatus,
} from "../../lib/budgetDetailsMetrics";
import { CoverageStrip, DayProgressBar, StatusChip } from "./DetailsVisuals";
import { InfoTooltip } from "./InfoTooltip";

export function toneClass(tone: DetailsTone): string {
  if (tone === "positive") return "text-emerald-700 dark:text-emerald-400";
  if (tone === "negative") return "text-destructive";
  return "text-foreground";
}

/** Positive value → good, negative → bad, zero → neutral. */
export function toneFromValue(value: number): DetailsTone {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

/**
 * Chip + elapsed-marker props for an in-progress single-month hero, shared by
 * the tracking and envelope panels. Empty for period views / closed months.
 */
export function monthPaceProps(
  thisMonth: ThisMonthMetrics | null | undefined,
  isMonth: boolean
): { chip?: { label: string; tone: DetailsTone }; elapsedFraction?: number } {
  if (!isMonth || !thisMonth) return {};
  return {
    chip: { label: thisMonth.statusLabel, tone: thisMonth.tone },
    elapsedFraction: thisMonth.elapsedFraction,
  };
}

export function DetailsHeader({
  title,
  subtitle,
  rangeLabel,
  coverageLabel,
  coverage,
  dayProgress,
}: {
  title: string;
  subtitle: string;
  rangeLabel: string;
  coverageLabel: string;
  coverage?: DetailsCoverage;
  dayProgress?: DayProgress | null;
}) {
  return (
    <div className="sticky top-0 z-20 -mt-2 bg-background pt-2 pb-2 border-b border-border/40 space-y-1.5">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
          {title}
        </p>
        <p className="text-[10.5px] text-muted-foreground mt-0.5 font-sans tabular-nums truncate">
          {subtitle} · {rangeLabel}
        </p>
      </div>
      {coverage ? (
        <CoverageStrip coverage={coverage} />
      ) : dayProgress ? (
        <DayProgressBar progress={dayProgress} />
      ) : (
        <p className="text-[10.5px] text-muted-foreground">{coverageLabel}</p>
      )}
    </div>
  );
}

export function DetailsSection({
  title,
  children,
  emphasis = false,
}: {
  title?: string;
  children: ReactNode;
  /** Shades the box as the panel's lead/hero, distinguishing it from the
   *  plain detail sections below it. */
  emphasis?: boolean;
}) {
  return (
    <section
      className={`rounded border px-2.5 py-2 ${
        emphasis ? "border-border bg-muted/25" : "border-border/60"
      }`}
    >
      {title && (
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      )}
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

export function MetricLine({
  label,
  value,
  tone = "neutral",
  tooltip,
  onValueClick,
  valueAriaLabel,
}: {
  label: string;
  value: string;
  tone?: DetailsTone;
  tooltip?: string;
  onValueClick?: () => void;
  valueAriaLabel?: string;
}) {
  const valueClass = `font-sans tabular-nums text-right text-[11px] ${toneClass(tone)}`;

  return (
    <div className="flex justify-between items-baseline gap-2">
      {tooltip ? (
        <InfoTooltip content={tooltip} className="shrink-0 text-[11px] text-muted-foreground">
          {label}
        </InfoTooltip>
      ) : (
        <span className="text-muted-foreground shrink-0 text-[11px]">{label}</span>
      )}
      {onValueClick ? (
        <button
          type="button"
          className={`${valueClass} rounded-sm underline decoration-dotted underline-offset-2 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50`}
          onClick={onValueClick}
          aria-label={valueAriaLabel ?? `View ${label}`}
          title={valueAriaLabel ?? `View ${label}`}
        >
          {value}
        </button>
      ) : (
        <span className={valueClass}>{value}</span>
      )}
    </div>
  );
}

export function PrimaryMetric({
  label,
  value,
  helper,
  tone,
  showPlus = false,
  valuePrefix,
  chip,
  hero = false,
  children,
}: {
  label: string;
  value: number | null;
  helper: string;
  tone: DetailsTone;
  showPlus?: boolean;
  valuePrefix?: string;
  /** Optional verdict chip shown top-right (e.g. pace / budget status). */
  chip?: { label: string; tone: DetailsTone };
  /** When true, shades the box as the panel's lead metric. */
  hero?: boolean;
  /** Optional extra content inside the box (e.g. the embedded progress meter). */
  children?: ReactNode;
}) {
  return (
    <DetailsSection emphasis={hero}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-foreground">{label}</p>
          {chip && <StatusChip label={chip.label} tone={chip.tone} />}
        </div>
        {value == null ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
        ) : (
          <>
            <p className={`mt-1 font-sans tabular-nums text-base font-semibold ${toneClass(tone)}`}>
              {valuePrefix}
              {showPlus ? formatDelta(value) : formatSigned(value)}
            </p>
            <p className="text-[10.5px] text-muted-foreground">{helper}</p>
          </>
        )}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </DetailsSection>
  );
}

function paceFillClass(status: ThisMonthPaceStatus): string {
  switch (status) {
    case "over-budget":
      return "bg-destructive/70";
    case "well-over-pace":
    case "slightly-over-pace":
      return "bg-amber-500/70 dark:bg-amber-400/60";
    case "under-pace":
    case "on-pace":
      return "bg-emerald-500/60 dark:bg-emerald-400/55";
    default:
      return "bg-muted-foreground/40";
  }
}

/**
 * The in-progress month, shown on its own so it never blends into the
 * closed-months figures. The fill is how much of the budget is used; the
 * vertical marker is how much of the month has elapsed — so "spent faster
 * than time" reads at a glance.
 */
export function ThisMonthSection({ metrics }: { metrics: ThisMonthMetrics }) {
  const usedPct =
    metrics.usedFraction == null ? null : Math.round(metrics.usedFraction * 100);
  const elapsedPct = Math.min(
    100,
    Math.max(0, Math.round(metrics.elapsedFraction * 100))
  );
  const fillPct =
    metrics.usedFraction == null
      ? 0
      : Math.min(100, Math.round(metrics.usedFraction * 100));

  return (
    <DetailsSection title="This month so far">
      <div className="flex items-baseline justify-between gap-2 -mt-0.5">
        <span className="text-[10.5px] text-muted-foreground">
          {metrics.monthLabel}
        </span>
        <span className="text-[10.5px] text-muted-foreground tabular-nums">
          {metrics.dayLabel} ({elapsedPct}%)
        </span>
      </div>

      <div className="relative h-2">
        <div className="absolute inset-0 rounded-full bg-muted overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${paceFillClass(
              metrics.paceStatus
            )}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <div
          className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-foreground/60"
          style={{ left: `${elapsedPct}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="tabular-nums">
        <span className={`text-[10.5px] font-semibold ${toneClass(metrics.tone)}`}>
          {usedPct == null
            ? metrics.statusLabel
            : `${usedPct}% used · ${metrics.statusLabel}`}
        </span>
      </div>

      <MetricLine
        label={metrics.actualLabel}
        value={`${formatSummary(metrics.actuals)} of ${formatSummary(
          metrics.budgeted
        )}`}
      />
      {metrics.income && (
        <MetricLine
          label="Income received"
          value={`${formatSummary(metrics.income.actuals)} of ${formatSummary(
            metrics.income.budgeted
          )}`}
        />
      )}
    </DetailsSection>
  );
}

export function MiniTrend({
  label,
  points,
}: {
  label: string;
  points: BudgetTrendPoint[];
}) {
  const max = Math.max(
    0,
    ...points.map((point) => (point.value == null ? 0 : Math.abs(point.value)))
  );

  return (
    <DetailsSection title={label}>
      <div className="flex items-end gap-px h-7" aria-label={label}>
        {points.map((point) => {
          if (point.value == null) {
            return (
              <div
                key={point.month}
                className="flex-1 h-[2px] rounded-[1px] bg-muted/40"
                title={`${point.label}: no data`}
              />
            );
          }

          const pct = max > 0 ? Math.abs(point.value) / max : 0;
          const heightPx = Math.max(3, Math.round(pct * 26));
          const color = point.planOnly
            ? "bg-muted-foreground/35"
            : point.value >= 0
            ? "bg-emerald-500/65 dark:bg-emerald-400/55"
            : "bg-destructive/65";

          return (
            <div
              key={point.month}
              className="flex-1 flex flex-col justify-end h-7"
              title={`${point.label}: ${formatSigned(point.value)}${
                point.planOnly ? " plan-only" : ""
              }`}
            >
              <div
                className={`rounded-[1px] ${color}`}
                style={{ height: `${heightPx}px` }}
              />
            </div>
          );
        })}
      </div>
      {points.some((point) => point.planOnly) && (
        <p className="text-[10.5px] text-muted-foreground">
          Future months are muted as plan-only.
        </p>
      )}
    </DetailsSection>
  );
}

export function StagedImpactBlock({
  mode,
  impact,
}: {
  mode: "tracking" | "envelope";
  impact: RelevantStagedImpact | null;
}) {
  if (!impact) return null;

  return (
    <DetailsSection title="Staged Changes">
      <MetricLine
        label="Cells changed"
        value={String(impact.count)}
      />
      {mode === "tracking" ? (
        <MetricLine
          label="Budget plan impact"
          value={formatDelta(impact.budgetDelta)}
          tone={impact.budgetDelta === 0 ? "neutral" : impact.budgetDelta > 0 ? "positive" : "negative"}
        />
      ) : (
        <>
          <MetricLine
            label="Estimated To Budget impact"
            value={formatDelta(impact.estimatedToBudgetImpact)}
            tone={
              impact.estimatedToBudgetImpact === 0
                ? "neutral"
                : impact.estimatedToBudgetImpact > 0
                ? "positive"
                : "negative"
            }
          />
          <p className="text-[10.5px] text-muted-foreground">
            Final balances recalculate after save.
          </p>
        </>
      )}
    </DetailsSection>
  );
}
