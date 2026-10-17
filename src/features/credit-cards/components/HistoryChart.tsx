"use client";

import { addMonths } from "@/lib/financial-models/calendar/dates";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";

export const HistoryTrend = dynamic(() => import("@/features/assets-debt/components/chart/HistoryTrend"), { ssr: false, loading: () => <div className="h-[180px] animate-pulse rounded bg-muted/40" aria-hidden /> });

const MonthlyBars = dynamic(() => import("@/features/assets-debt/components/chart/CardStatementTrend"), { ssr: false, loading: () => <div className="h-[180px] animate-pulse rounded bg-muted/40" aria-hidden /> });

/** Same interactive chart library and visual conventions as the loan calculator. */
export function HistoryChart({ title, points, percent = false, tone = "debt", zeroReference = false, historical = true, monthly = false, allowSingle = true, observationLabel, kind }: { kind?: "bar" | "line"; allowSingle?: boolean; monthly?: boolean; observationLabel?: string; title: string; points: { date: string; label?: string; value: number | null; source?: string; breakdown?: { label: string; value: number | null }[] }[]; historical?: boolean; zeroReference?: boolean; percent?: boolean; tone?: "debt" | "interest" | "utilization" }) {
  const [showReference, setShowReference] = useState(zeroReference);
  const chartPoints = points.flatMap((point, index) => {
    const previous = points[index - 1];
    const gap = historical && previous && point.date.slice(0, 7) > addMonths(previous.date, 1).slice(0, 7);
    return gap ? [{ date: addMonths(previous.date, 1), value: null }, point] : [point];
  });
  if (points.filter((point) => point.value !== null).length < (allowSingle ? 1 : 2)) return <div className="flex min-w-0 flex-col rounded-lg border border-border bg-background p-4"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-3 text-xs text-muted-foreground">{allowSingle ? "No known values in the tracked history yet." : "At least two statement periods with known values are needed for a trend."}</p></div>;
  return <figure className="flex min-w-0 flex-col rounded-lg border border-border bg-background p-4">
    <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
    {kind === "bar" ? <MonthlyBars title={title} points={chartPoints} monthly={monthly} tone={tone} zeroReference={showReference} percent={percent} /> : <HistoryTrend title={title} points={chartPoints} percent={percent} tone={tone} zeroReference={showReference} fullDates={!monthly} discrete={historical} solid />}

    {zeroReference && <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={showReference} onCheckedChange={setShowReference} aria-label={`Show zero reference for ${title}`} />Hypothetical zero-interest baseline</label>}
    {historical && observationLabel && <p className="mt-1 text-xs text-muted-foreground">{observationLabel}</p>}

  </figure>;
}
