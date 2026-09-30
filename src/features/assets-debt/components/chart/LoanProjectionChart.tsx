"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMinor } from "../../lib/money";
import type { ChartData, SeriesId } from "../../lib/results";

/**
 * The loan chart (P1.3b T223; FR-223). The only module that imports Recharts,
 * and it only renders: the series and their values come from the pure
 * `chartSeries()` (lib/results.ts), which reads engine output. Series are
 * told apart by name, dash pattern and colour; Recharts' accessibility layer
 * lets the keyboard step through points; animation is off under reduced motion.
 */

export const SERIES_META: Record<SeriesId, { label: string; color: string; dash?: string; axis: "balance" | "interest" }> = {
  balance: { label: "Loan balance", color: "var(--primary)", axis: "balance" },
  comparison: { label: "Saved loan balance", color: "var(--chart-3)", dash: "6 4", axis: "balance" },
  offsetBalance: { label: "Offset balance", color: "var(--chart-2)", dash: "2 3", axis: "balance" },
  interestBearing: { label: "Interest-bearing balance", color: "var(--chart-4)", dash: "8 3 2 3", axis: "balance" },
  cumulativeInterest: { label: "Interest paid so far", color: "var(--chart-5)", dash: "1 3", axis: "interest" },
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export default function LoanProjectionChart({ data, visible, currency, digits, height = 320 }: { data: ChartData; visible: SeriesId[]; currency: string; digits: number; height?: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const money = (v: number) => formatMinor(Math.round(v), digits, currency);
  const compact = (v: number) => {
    const major = v / 10 ** digits;
    return Math.abs(major) >= 1_000_000 ? `${(major / 1_000_000).toFixed(1)}M` : Math.abs(major) >= 1_000 ? `${Math.round(major / 1_000)}k` : String(Math.round(major));
  };
  const hasInterestAxis = visible.includes("cumulativeInterest");
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height }}>
        <ComposedChart data={data.points} margin={{ top: 8, right: hasInterestAxis ? 8 : 16, bottom: 4, left: 8 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis yAxisId="balance" tickFormatter={compact} tick={{ fontSize: 11 }} width={48} />
          {hasInterestAxis ? <YAxis yAxisId="interest" orientation="right" tickFormatter={compact} tick={{ fontSize: 11 }} width={48} /> : null}
          <Tooltip formatter={(value, name) => [money(Number(value)), SERIES_META[name as SeriesId]?.label ?? String(name)]} labelFormatter={(label) => `Period ${label}`} isAnimationActive={!reducedMotion} />
          {visible.map((id) => (
            <Line
              key={id}
              yAxisId={SERIES_META[id].axis}
              type="monotone"
              dataKey={id}
              name={id}
              stroke={SERIES_META[id].color}
              strokeWidth={id === "balance" ? 2.5 : 1.75}
              strokeDasharray={SERIES_META[id].dash}
              dot={false}
              connectNulls
              isAnimationActive={!reducedMotion}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
