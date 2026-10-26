"use client";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { TIMELINE_AXIS_WIDTH, TIMELINE_MARGIN } from "./AssetValueTimeline";

type Point = { label: string; title: string; income: number; expenses: number; net: number; investment: number; disposal: number; projected: boolean };
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const compact = (minor: number) => Math.abs(minor) >= 100000 ? `${(minor / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : (minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
const COLORS = { income: "#16a34a", expenses: "#dc2626", capital: "#64748b", disposal: "#0ea5e9" };

/** Operating income (up) and expenses (down) with the net line; capital movements only as bars when asked. */
export default function AssetCashflowTimeline({ points, includeCapital, showNet, onSelect, onActive }: { points: Point[]; includeCapital: boolean; showNet: boolean; onSelect: (index: number) => void; onActive?: (index: number | null) => void }) {
  const future = points.filter((p) => p.projected);
  const data = points.map((p) => ({ ...p, net: p.projected ? null : p.net }));
  const hasCapital = points.some((p) => p.investment !== 0 || p.disposal !== 0);
  return <div className="h-[230px] w-full" role="img" aria-label="Operating income and expenses over time with the net operating result">
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 230 }}>
      <ComposedChart data={data} margin={TIMELINE_MARGIN} stackOffset="sign" onMouseMove={(state) => { const i = Number(state?.activeTooltipIndex); onActive?.(Number.isInteger(i) ? i : null); }} onMouseLeave={() => onActive?.(null)}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        {future.length > 0 && <ReferenceArea x1={future[0].label} x2={future[future.length - 1].label} fill="var(--muted)" fillOpacity={0.45} ifOverflow="visible" label={{ value: "Not recorded yet", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />}
        <XAxis dataKey="label" scale="band" interval={0} tick={AXIS} />
        <YAxis tickFormatter={compact} tick={AXIS} width={TIMELINE_AXIS_WIDTH} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }} content={({ active, payload }) => {
          const p = payload?.[0]?.payload as Point | undefined;
          if (!active || !p) return null;
          if (p.projected) return <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg"><p className="mb-1 font-medium text-popover-foreground">{p.title}</p>Not recorded yet</div>;
          const row = (label: string, value: number, color?: string) => <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground">{color && <span className="size-2 rounded-sm" style={{ background: color }} aria-hidden />}{label}</span><span className="font-medium tabular-nums">{formatAmount(value, 2)}</span></div>;
          return <div className="min-w-56 space-y-1 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"><p className="mb-1 font-medium">{p.title}</p>
            {row("Operating income", p.income, COLORS.income)}{row("Operating expenses", p.expenses, COLORS.expenses)}{row("Net operating result", p.net)}
            {(p.investment !== 0 || p.disposal !== 0) && <div className="mt-1 space-y-1 border-t pt-1"><p className="text-[11px] text-muted-foreground">Capital movements{includeCapital ? "" : " (not in bars)"}</p>
              {p.investment !== 0 && row("Purchases and payments", p.investment, COLORS.capital)}{p.disposal !== 0 && row("Disposal proceeds, net of selling costs", p.disposal, COLORS.disposal)}</div>}
          </div>;
        }} />
        <Bar dataKey="income" name="Operating income" stackId="m" fill={COLORS.income} maxBarSize={36} cursor="pointer" onClick={(_, index) => onSelect(index)} isAnimationActive="auto" />
        <Bar dataKey="expenses" name="Operating expenses" stackId="m" fill={COLORS.expenses} maxBarSize={36} cursor="pointer" onClick={(_, index) => onSelect(index)} isAnimationActive="auto" />
        {includeCapital && hasCapital && <>
          <Bar dataKey="disposal" name="Disposal proceeds (net)" stackId="m" fill={COLORS.disposal} fillOpacity={0.75} maxBarSize={36} isAnimationActive="auto" />
          <Bar dataKey="investment" name="Purchases and payments" stackId="m" fill={COLORS.capital} fillOpacity={0.75} maxBarSize={36} isAnimationActive="auto" />
        </>}
        {showNet && <Line type="linear" dataKey="net" name="Net operating result" connectNulls={false} stroke="var(--foreground)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive="auto" />}
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}
