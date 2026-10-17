"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Area, CartesianGrid, ComposedChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addDays, addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { BalanceDay, BalanceEvent, DailyBalanceHistory } from "@/features/credit-cards/lib/balanceHistory";
import { formatChartDate as formatCardDate } from "./chartMeta";

const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const money = (minor: number | null | undefined) => minor == null ? "Unavailable" : formatAmount(minor, 2);

export default function BalanceHistoryPlot({ history, creditLimitMinor, onStatement, onPayment }: { history: DailyBalanceHistory; creditLimitMinor: number | null; onStatement?: (id: string) => void; onPayment?: (id: string) => void }) {
  const pattern = `interest-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [focused, setFocused] = useState<BalanceEvent[] | null>(null);
  const top = Math.max(100, Math.ceil((history.highest?.valueMinor ?? 0) * 1.15 / Math.pow(10, Math.floor(Math.log10(history.highest?.valueMinor || 100)))) * Math.pow(10, Math.floor(Math.log10(history.highest?.valueMinor || 100))));
  const ticks: number[] = [];
  for (let month = `${history.from.slice(0, 7)}-01`; month <= history.until; month = addMonths(month, 1, 1)) if (month >= history.from) ticks.push(timestamp(month));
  const data = [...history.points, ...Array.from({ length: Math.max(0, daysBetween(history.today, history.until)) }, (_, index): BalanceDay => ({ date: addDays(history.today, index + 1), valueMinor: null, onCardMinor: null, planMinor: null, transitMinor: null, interest: null }))].map((point) => ({ ...point, timestamp: timestamp(point.date) }));
  const groups = new Map<string, BalanceEvent[]>();
  for (const event of history.events.filter((entry) => entry.kind !== "statement")) { const key = `${event.kind}:${event.date}`; groups.set(key, [...(groups.get(key) ?? []), event]); }
  const activate = (event: BalanceEvent) => event.kind === "payment" ? onPayment?.(event.id) : event.statementId && onStatement?.(event.statementId);
  const interaction = (events: BalanceEvent[]) => {
    const event = events[0], actionable = events.length === 1 && (event.kind === "payment" ? onPayment : event.statementId && onStatement);
    return { tabIndex: 0, role: actionable ? "button" : "img", "aria-label": `${event.kind === "due" ? "Payment due" : event.kind === "statement" ? "Statement closes" : "Payment"} ${formatCardDate(event.date)}${event.amountMinor !== null ? ` · ${money(event.amountMinor)}` : ""}${event.estimated ? " · estimated" : ""}${event.pending ? " · pending" : ""}${events.length > 1 ? ` · ${events.length} entries` : ""}`,
      onMouseEnter: () => setFocused(events), onMouseLeave: () => setFocused(null), onFocus: () => setFocused(events), onBlur: () => setFocused(null), onClick: () => { if (actionable) activate(event); }, onKeyDown: (key: KeyboardEvent<SVGGElement>) => { if (actionable && ["Enter", " "].includes(key.key)) { key.preventDefault(); activate(event); } }, className: "outline-none focus-visible:[&>circle]:stroke-foreground focus-visible:[&>polygon]:stroke-foreground" };
  };
  const compact = (minor: number) => Math.abs(minor) >= 100000 ? `${(minor / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : (minor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return <div className="relative h-[284px] min-w-[640px]" role="group" aria-label="Daily debt chart. Use arrow keys to inspect days; focus a statement or key date for details.">
    <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 900, height: 260 }}>
      <ComposedChart data={data} margin={{ top: 38, right: 20, bottom: 0, left: 0 }} accessibilityLayer>
        <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--chart-rate-change)" opacity="0.06" /><path d="M-1 1 1-1 M0 6 6 0 M5 7 7 5" stroke="var(--chart-rate-change)" strokeWidth="2" opacity="0.3" /></pattern></defs>
        <CartesianGrid vertical={false} stroke="var(--border)" opacity={0.5} />
        <XAxis dataKey="timestamp" type="number" scale="time" domain={[timestamp(history.from), timestamp(history.until)]} allowDataOverflow ticks={ticks} tickFormatter={(value: number) => formatCardDate(new Date(value).toISOString().slice(0, 10)).slice(3, 6)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} height={28} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
        <YAxis domain={[-top * 0.16, top]} ticks={[0, top / 4, top / 2, top * 0.75, top]} tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={50} axisLine={false} tickLine={false} />
        <ReferenceArea x1={timestamp(history.today)} x2={timestamp(history.until)} fill="var(--muted)" fillOpacity={0.18} stroke="none" />
        {history.bands.map((band) => <ReferenceArea key={`${band.from}-${band.kind}`} x1={timestamp(band.from)} x2={Math.min(timestamp(addDays(band.to, 1)), timestamp(history.today))} y1={0} y2={top} fill={band.kind === "free" ? "var(--chart-1)" : `url(#${pattern})`} fillOpacity={band.kind === "free" ? 0.05 : 1} stroke={band.kind === "free" ? "var(--chart-1)" : "none"} strokeOpacity={0.12} />)}
        <Area dataKey="valueMinor" name="Total owed" type="stepAfter" stroke="var(--muted-foreground)" strokeWidth={1.5} fill="var(--chart-3)" fillOpacity={0.1} baseValue={0} connectNulls={false} dot={false} activeDot={{ r: 3, fill: "var(--foreground)", stroke: "var(--background)" }} isAnimationActive={false} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ReferenceLine x={timestamp(history.today)} stroke="var(--foreground)" strokeDasharray="3 3" label={{ value: `Today · ${money(history.currentMinor)}`, position: "insideTopRight", fill: "var(--foreground)", fontSize: 11 }} />
        {history.events.filter((event) => event.kind === "statement" && event.amountMinor !== null).map((event, index) => <ReferenceDot key={event.id} x={timestamp(event.date)} y={event.amountMinor!} shape={({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) => <g {...interaction([event])}><circle cx={cx} cy={cy} r="5" fill="var(--foreground)" stroke="var(--background)" strokeWidth="2" /><text x={cx + 7} y={cy - 18 - index % 2 * 12} fill="var(--foreground)" fontSize="10" fontWeight="600" pointerEvents="none">{money(event.amountMinor)}</text>{creditLimitMinor !== null && creditLimitMinor > 0 && <text x={cx + 7} y={cy - 6 - index % 2 * 12} fill="var(--muted-foreground)" fontSize="10" pointerEvents="none">{(event.amountMinor! / creditLimitMinor * 100).toFixed(0)}% of limit</text>}</g>} />)}
        {[...groups.entries()].map(([key, events]) => { const event = events[0], due = event.kind === "due", pending = events.some((entry) => entry.pending); return <ReferenceDot key={key} x={timestamp(event.date)} y={-top * (due ? 0.105 : 0.055)} shape={({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) => <g {...interaction(events)}>{due ? <polygon points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`} fill="var(--background)" stroke="var(--chart-1)" strokeWidth="1.7" opacity={event.estimated ? 0.5 : 1} strokeDasharray={event.estimated ? "2 1" : undefined} /> : <circle cx={cx} cy={cy} r="4.5" fill={pending ? "var(--background)" : "var(--chart-2)"} stroke={pending ? "var(--chart-rate-change)" : "var(--chart-2)"} strokeWidth="1.5" />}{events.length > 1 && <text x={cx + 6} y={cy - 3} fontSize="9" fill="var(--muted-foreground)">{events.length}</text>}</g>} />; })}
        <Tooltip filterNull={false} active={focused ? false : undefined} isAnimationActive={false} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={({ active, payload }) => {
          const point = payload?.find((entry) => entry.dataKey === "valueMinor")?.payload as BalanceDay | undefined;
          return active && point && point.date <= history.today ? <div className="min-w-52 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg"><p className="mb-2 font-semibold">{formatCardDate(point.date)}</p><dl className="space-y-1"><div className="flex justify-between gap-4"><dt>Total owed</dt><dd className="font-semibold">{money(point.valueMinor)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">On card</dt><dd>{money(point.onCardMinor)}</dd></div>{point.planMinor !== null && point.planMinor !== 0 && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Assigned plan principal</dt><dd>{money(point.planMinor)}</dd></div>}{point.transitMinor !== null && point.transitMinor !== 0 && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Transfer in transit</dt><dd>{money(point.transitMinor)}</dd></div>}</dl><p className="mt-2 text-muted-foreground">{point.interest === "free" ? "Inferred interest-free window" : point.interest === "charged" ? "Interest posted in this statement period; shaded interval is inferred" : "Interest state not inferred"}</p></div> : null;
        }} />
      </ComposedChart>
    </ResponsiveContainer>
    <span className="pointer-events-none absolute bottom-[52px] left-0 text-[10px] text-muted-foreground">Key dates</span>
    <div className="pointer-events-none absolute bottom-0 right-0 flex gap-3 bg-background/90 text-[10px] text-muted-foreground"><span>◇ Due · dashed = expected</span><span>● Payment · ○ Pending</span></div>
    {focused && <div role="tooltip" className="pointer-events-none absolute right-3 top-4 z-10 max-w-72 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg"><p className="font-semibold">{formatCardDate(focused[0].date)}</p>{focused.map((event) => <div key={event.id} className="mt-2"><p>{event.kind === "statement" ? "Statement closes · total owed" : event.kind === "due" ? event.estimated ? "Expected payment due date" : "Payment due date" : event.pending ? "Payment · clearing pending" : "Confirmed payment"}</p>{event.label && <p className="text-muted-foreground">{event.label}</p>}{event.amountMinor !== null && <p className="font-semibold tabular-nums">{money(event.amountMinor)}</p>}</div>)}</div>}
  </div>;
}
