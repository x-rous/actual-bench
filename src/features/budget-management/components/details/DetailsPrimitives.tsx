"use client";

import type { ReactNode } from "react";
import { formatDelta, formatSigned } from "../../lib/format";
import type {
  BudgetTrendPoint,
  DetailsTone,
  RelevantStagedImpact,
} from "../../lib/budgetDetailsMetrics";

export function toneClass(tone: DetailsTone): string {
  if (tone === "positive") return "text-emerald-700 dark:text-emerald-400";
  if (tone === "negative") return "text-destructive";
  return "text-foreground";
}

export function DetailsHeader({
  title,
  subtitle,
  rangeLabel,
  coverageLabel,
}: {
  title: string;
  subtitle: string;
  rangeLabel: string;
  coverageLabel: string;
}) {
  return (
    <div className="pb-2 border-b border-border/40">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="text-[11px] text-foreground font-medium truncate mt-1">
        {subtitle}
      </p>
      <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-sans tabular-nums">
        {rangeLabel}
      </p>
      <p className="text-[10px] text-muted-foreground/70 mt-1">
        {coverageLabel}
      </p>
    </div>
  );
}

export function DetailsSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-border/60 px-2.5 py-2">
      {title && (
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
}: {
  label: string;
  value: string;
  tone?: DetailsTone;
  tooltip?: string;
}) {
  return (
    <div className="flex justify-between items-baseline gap-2" title={tooltip}>
      <span
        className={`text-muted-foreground shrink-0 text-[11px]${
          tooltip ? " cursor-help" : ""
        }`}
      >
        {label}
      </span>
      <span
        className={`font-sans tabular-nums text-right text-[11px] ${toneClass(tone)}`}
      >
        {value}
      </span>
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
}: {
  label: string;
  value: number | null;
  helper: string;
  tone: DetailsTone;
  showPlus?: boolean;
  valuePrefix?: string;
}) {
  return (
    <DetailsSection>
      <div>
        <p className="text-[11px] font-semibold text-foreground/80">{label}</p>
        {value == null ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
        ) : (
          <>
            <p className={`mt-1 font-sans tabular-nums text-base font-semibold ${toneClass(tone)}`}>
              {valuePrefix}
              {showPlus ? formatDelta(value) : formatSigned(value)}
            </p>
            <p className="text-[10px] text-muted-foreground/70">{helper}</p>
          </>
        )}
      </div>
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
        <p className="text-[10px] text-muted-foreground/70">
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
          <p className="text-[10px] text-muted-foreground/70">
            Final balances recalculate after save.
          </p>
        </>
      )}
    </DetailsSection>
  );
}
