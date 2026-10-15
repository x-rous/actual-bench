"use client";

import { addMonths } from "@/lib/financial-models/calendar/dates";
import { formatCardDate } from "../lib/displayDates";
import { formatCardMonth } from "../lib/portfolioView";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatAmount } from "@/features/assets-debt/lib/money";

export const HistoryTrend = dynamic(() => import("@/features/assets-debt/components/chart/HistoryTrend"), { ssr: false, loading: () => <div className="h-[180px] animate-pulse rounded bg-muted/40" aria-hidden /> });

const MonthlyBars = dynamic(() => import("@/features/assets-debt/components/chart/CardStatementTrend"), { ssr: false, loading: () => <div className="h-[180px] animate-pulse rounded bg-muted/40" aria-hidden /> });

/** Same interactive chart library and visual conventions as the loan calculator. */
export function HistoryChart({ title, points, percent = false, tone = "debt", zeroReference = false, historical = true, monthly = false, allowSingle = true, observationLabel, kind }: { kind?: "bar" | "line"; allowSingle?: boolean; monthly?: boolean; observationLabel?: string; title: string; points: { date: string; label?: string; value: number | null; source?: string; breakdown?: { label: string; value: number | null }[] }[]; historical?: boolean; zeroReference?: boolean; percent?: boolean; tone?: "debt" | "interest" | "utilization" }) {
  const [showReference, setShowReference] = useState(zeroReference);
  const [showValues, setShowValues] = useState(false);
  const chartPoints = points.flatMap((point, index) => {
    const previous = points[index - 1];
    const gap = historical && previous && point.date.slice(0, 7) > addMonths(previous.date, 1).slice(0, 7);
    return gap ? [{ date: addMonths(previous.date, 1), value: null }, point] : [point];
  });
  if (points.filter((point) => point.value !== null).length < (allowSingle ? 1 : 2)) return <div className="flex min-w-0 flex-col rounded-lg border border-border p-3"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-3 text-xs text-muted-foreground">{allowSingle ? "No known values in the tracked history yet." : "At least two statement periods with known values are needed for a trend."}</p></div>;
  const display = (value: number) => percent ? `${value.toFixed(1)}%` : formatAmount(value, 2);
  return <figure className="flex min-w-0 flex-col rounded-lg border border-border p-3">
    <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
    {kind === "bar" ? <MonthlyBars title={title} points={chartPoints} monthly={monthly} tone={tone} zeroReference={showReference} percent={percent} /> : <HistoryTrend title={title} points={chartPoints} percent={percent} tone={tone} zeroReference={showReference} fullDates={!monthly} discrete={historical} solid />}

    {zeroReference && <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={showReference} onCheckedChange={setShowReference} aria-label={`Show zero reference for ${title}`} />Hypothetical zero-interest baseline</label>}
    {historical && observationLabel && <p className="mt-1 text-xs text-muted-foreground">{observationLabel}</p>}
    <div className="mt-auto pt-2"><Button variant="outline" size="xs" onClick={() => setShowValues(true)}>View trend values</Button></div><Dialog open={showValues} onOpenChange={setShowValues}><DialogContent><DialogTitle>{title} values</DialogTitle><DialogDescription>{historical ? "Values for the loaded statement periods." : "Illustrative future values, including accrued interest at the simulation endpoint."}</DialogDescription><div className="max-h-[60dvh] overflow-auto"><table className="w-full text-xs text-left"><thead className="bg-muted"><tr><th scope="col">{monthly ? "Month" : historical ? "Statement" : "Date"}</th><th scope="col">{title}</th></tr></thead><tbody>{points.map((point) => <tr key={point.date}><td>{monthly ? formatCardMonth(point.date) : formatCardDate(point.date)}</td><td>{point.value === null ? "Missing evidence" : display(point.value)}</td></tr>)}</tbody></table></div><div className="flex justify-end"><Button variant="outline" onClick={() => setShowValues(false)}>Close</Button></div></DialogContent></Dialog>
  </figure>;
}
