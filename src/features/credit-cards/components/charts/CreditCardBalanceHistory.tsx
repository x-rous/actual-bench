"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { addDays, addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { BalanceBill, BalanceChartData, BalanceDay, BalanceEvent } from "../../lib/balanceHistory";
import type { Tone } from "../../lib/derive/status";
import { formatChartDate as formatCardDate } from "@/features/assets-debt/components/chart/chartMeta";

const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const money = (minor: number | null | undefined) => (minor == null ? "Unavailable" : formatAmount(minor, 2));
const compact = (minor: number) => (Math.abs(minor) >= 100000
  ? `${(minor / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  : (minor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const CHART_LABEL = "Daily debt chart. Use arrow keys to inspect days; Tab to the markers, then arrow keys to move between statements and bills.";
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };
const PLOT_HEIGHT = 260;
const LANE_HEIGHT = 64;
const Y_AXIS_WIDTH = 56;
const MARGIN = { right: 24, left: 0 };

/** Bill outcome colours follow the payment badge tones (§9.13). */
const TONE_CLASS: Record<Tone, string> = {
  success: "fill-green-600 stroke-green-600",
  attention: "fill-amber-500 stroke-amber-600",
  danger: "fill-red-600 stroke-red-600",
  info: "fill-background stroke-blue-600",
  neutral: "fill-background stroke-muted-foreground",
  muted: "fill-background stroke-muted-foreground",
};

type Props = {
  history: BalanceChartData;
  /** The credit limit in effect on a date (limit changes applied); null when none is set. */
  limitAt: (date: string) => number | null;
  onStatement?: (id: string) => void;
  onPayment?: (id: string) => void;
};

/**
 * Y ticks in round steps (5K or 10K for typical limits, owner decision 18 Oct 2026). The top is the
 * credit limit and only goes higher when the balance does; without a limit it follows the balance.
 */
export function axisTicks(highestMinor: number, limitMinor: number | null) {
  // The step follows the larger of the limit and the balance, so a balance above the limit never yields 30+ ticks.
  const scale = Math.max(100, highestMinor, limitMinor && limitMinor > 0 ? limitMinor : 0);
  const steps = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000]
    .map((major) => major * 100);
  const step = steps.find((value) => scale / value <= 5) ?? steps.at(-1)!;
  const top = Math.max(limitMinor && limitMinor > 0 ? Math.ceil(limitMinor / step) * step : 0, Math.ceil(Math.max(1, highestMinor) / step) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
}

const percentOf = (value: number | null, limit: number | null) =>
  (value !== null && limit ? `${Math.round(value / limit * 100)}% of limit` : null);

function billName(bill: BalanceBill) {
  return `Bill due ${formatCardDate(bill.dueDate)} · ${bill.status.label}${bill.amountDueMinor !== null ? ` · ${money(bill.amountDueMinor)} due` : ""}`;
}

function BillDetails({ bill }: { bill: BalanceBill }) {
  return <>
    <p className="font-semibold">Bill due {formatCardDate(bill.dueDate)}</p>
    <p className="mt-1">{bill.status.label}{bill.status.line ? ` · ${bill.status.line}` : ""}</p>
    {bill.amountDueMinor !== null && <p className="text-muted-foreground">Amount due {money(bill.amountDueMinor)} · closed {formatCardDate(bill.closingDate)}</p>}
    {bill.payments.length > 0 && <ul className="mt-2 space-y-0.5">{bill.payments.map((payment) => <li key={payment.id} className="flex justify-between gap-4">
      <span>{formatCardDate(payment.date)} · {payment.label}{payment.pending ? " · pending" : ""}</span>
      <span className="tabular-nums">{money(payment.amountMinor)}</span>
    </li>)}</ul>}
    {bill.costsMinor ? <p className="mt-2 text-amber-800 dark:text-amber-300">Interest &amp; fees on this statement {money(bill.costsMinor)}</p> : null}
  </>;
}

function DayTooltip({ point, events, limit }: { point: BalanceDay & { projectedMinor?: number | null }; events: BalanceEvent[]; limit: number | null }) {
  const row = (label: string, value: number | null, strong = false) => <div className="flex justify-between gap-4">
    <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
    <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{money(value)}</dd>
  </div>;
  if (point.valueMinor === null && point.projectedMinor != null) {
    return <div className="min-w-52 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1 font-semibold">{formatCardDate(point.date)}</p>
      <p className="text-muted-foreground">If you pay Left to pay by the due date and spend nothing more</p>
      <dl className="mt-1">{row("Total owed", point.projectedMinor, true)}</dl>
    </div>;
  }
  const share = percentOf(point.valueMinor, limit);
  return <div className="min-w-56 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
    <p className="mb-2 font-semibold">{formatCardDate(point.date)}</p>
    <dl className="space-y-1">
      {row("Total owed", point.valueMinor, true)}
      {share && <div className="flex justify-between gap-4 text-muted-foreground"><dt>Credit used</dt><dd>{share}</dd></div>}
      {point.planMinor !== null && point.planMinor !== 0 && <>
        {row("On card", point.onCardMinor)}
        {row("In plan accounts", point.planMinor)}
      </>}
      {point.transitMinor !== null && point.transitMinor !== 0 && row("Transfer in transit", point.transitMinor)}
    </dl>
    {events.length > 0 && <ul className="mt-2 space-y-0.5 border-t pt-2">{events.map((event) => <li key={event.id} className="flex justify-between gap-4">
      <span>{event.kind === "statement" ? "Statement closed" : `Payment${event.pending ? " · pending" : ""}${event.label ? ` · ${event.label}` : ""}`}</span>
      {event.kind === "payment" && <span className="tabular-nums">{money(event.amountMinor)}</span>}
    </li>)}</ul>}
    {point.interest && <p className="mt-2 text-muted-foreground">
      {point.interest === "free" ? "Interest-free: the bill was paid in full by its due date" : "Interest was charged for this statement period"}
    </p>}
  </div>;
}

type Marker = { key: string; date: string; label: string; actionable: boolean; activate: () => void; details: ReactNode };
type Popover = { key: string; x: number; y: number; width: number; details: ReactNode };

/**
 * Daily Total owed (§9.6) over statement cycles, with a key-dates lane underneath: one marker per bill,
 * coloured by its outcome, and the interest and fees each statement charged. The dashed step shows the
 * balance if Left to pay is paid by the due date.
 */
export default function BalanceHistoryPlot({ history, limitAt, onStatement }: Props) {
  const pattern = `interest-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const box = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [roving, setRoving] = useState(0);
  const highest = history.highest?.valueMinor ?? 0;
  const monthTicks: number[] = [];
  for (let month = `${history.from.slice(0, 7)}-01`; month <= history.until; month = addMonths(month, 1, 1)) {
    if (month >= history.from) monthTicks.push(timestamp(month));
  }
  const projection = history.projection;
  const future = Array.from({ length: Math.max(0, daysBetween(history.today, history.until)) }, (_, index) => addDays(history.today, index + 1));
  const projected = (date: string) => (!projection ? null : date < projection.to ? projection.startMinor : projection.endMinor);
  const data = [
    ...history.points.map((point) => ({ ...point, timestamp: timestamp(point.date), projectedMinor: point.date === history.today ? projection?.startMinor ?? null : null })),
    ...future.map((date) => ({
      date, valueMinor: null, onCardMinor: null, planMinor: null, transitMinor: null, interest: null, timestamp: timestamp(date), projectedMinor: projected(date),
    })),
  ].map((point) => ({ ...point, limitMinor: limitAt(point.date) }));
  // The limit is a step: one label where each limit starts in the range (the first day, then each change).
  const limitStarts = data.filter((point, index) => point.limitMinor && point.limitMinor > 0 && (index === 0 || point.limitMinor !== data[index - 1].limitMinor));
  const showLimit = limitStarts.length > 0;
  const highestLimit = Math.max(0, ...data.map((point) => point.limitMinor ?? 0));
  const ticks = axisTicks(Math.max(highest, history.projection?.startMinor ?? 0), highestLimit || null);
  const top = ticks.at(-1)!;
  const domain = [timestamp(history.from), timestamp(history.until)];
  const lane = data.map((point) => ({ timestamp: point.timestamp, lane: 1 }));
  const eventsOn = (date: string) => history.events.filter((event) => event.date === date);

  const statements = history.events.filter((event) => event.kind === "statement" && event.amountMinor !== null);
  const markers: Marker[] = [
    ...statements.map((event): Marker => ({
      key: event.id,
      date: event.date,
      label: `Statement closes ${formatCardDate(event.date)} · ${money(event.amountMinor)} owed`,
      actionable: Boolean(onStatement && event.statementId),
      activate: () => { if (event.statementId) onStatement?.(event.statementId); },
      details: <>
        <p className="font-semibold">Statement closed {formatCardDate(event.date)}</p>
        <p className="mt-1">Total owed {money(event.amountMinor)}</p>
        {percentOf(event.amountMinor, limitAt(event.date)) && <p className="text-muted-foreground">{percentOf(event.amountMinor, limitAt(event.date))}</p>}
      </>,
    })),
    ...history.bills.map((bill): Marker => ({
      key: `bill-${bill.statementId}`,
      date: bill.dueDate,
      label: billName(bill),
      actionable: Boolean(onStatement),
      activate: () => onStatement?.(bill.statementId),
      details: <BillDetails bill={bill} />,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const indexOf = (key: string) => markers.findIndex((marker) => marker.key === key);

  const show = (marker: Marker, x: number, y: number) => setPopover({ key: marker.key, x, y, width: box.current?.offsetWidth ?? 900, details: marker.details });
  const focusMarker = (index: number) => {
    const next = Math.max(0, Math.min(markers.length - 1, index));
    setRoving(next);
    box.current?.querySelector<SVGGElement>(`[data-marker="${markers[next].key}"]`)?.focus();
  };
  const interaction = (marker: Marker, x: number, y: number) => ({
    tabIndex: indexOf(marker.key) === Math.min(roving, markers.length - 1) ? 0 : -1,
    "data-marker": marker.key,
    role: marker.actionable ? "button" : "img",
    "aria-label": marker.label,
    onMouseEnter: () => show(marker, x, y),
    onMouseLeave: () => setPopover(null),
    onFocus: () => { setRoving(indexOf(marker.key)); show(marker, x, y); },
    onBlur: () => setPopover(null),
    onClick: () => { if (marker.actionable) marker.activate(); },
    onKeyDown: (key: KeyboardEvent<SVGGElement>) => {
      if (marker.actionable && ["Enter", " "].includes(key.key)) {
        key.preventDefault();
        marker.activate();
      } else if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(key.key)) {
        key.preventDefault();
        const at = indexOf(marker.key);
        focusMarker(key.key === "Home" ? 0 : key.key === "End" ? markers.length - 1 : at + (key.key === "ArrowRight" ? 1 : -1));
      }
    },
    className: "cursor-pointer outline-none focus-visible:[&>*]:stroke-foreground focus-visible:[&>*]:stroke-[2.5]",
  });
  type Shape = { cx?: number; cy?: number };
  // Labels stagger when two statements are close (under 9% of the range apart), so they never overlap.
  const span = Math.max(1, daysBetween(history.from, history.until));
  const raised = new Set<string>();
  statements.forEach((event, index) => {
    const previous = statements[index - 1];
    if (previous && !raised.has(previous.id) && daysBetween(previous.date, event.date) / span < 0.09) raised.add(event.id);
  });
  const statementDot = (event: BalanceEvent) => function StatementDot({ cx = 0, cy = 0 }: Shape) {
    const marker = markers.find((entry) => entry.key === event.id)!;
    const share = percentOf(event.amountMinor, limitAt(event.date));
    const lift = raised.has(event.id) ? 24 : 0;
    const below = cy - 30 - lift < 4;
    const y = below ? cy + 16 : cy - 20 - lift;
    const anchor = cx < 50 ? "start" : "middle";
    return <g {...interaction(marker, cx, cy)}>
      <circle cx={cx} cy={cy} r="4" fill="var(--foreground)" stroke="var(--background)" strokeWidth="2" />
      <text x={cx} y={y} textAnchor={anchor} fontSize="10" fontWeight="600" fill="var(--foreground)" stroke="var(--background)" strokeWidth="3"
        paintOrder="stroke" pointerEvents="none">{money(event.amountMinor)}</text>
      {share && <text x={cx} y={y + 11} textAnchor={anchor} fontSize="10" fill="var(--muted-foreground)" stroke="var(--background)" strokeWidth="3"
        paintOrder="stroke" pointerEvents="none">{share}</text>}
    </g>;
  };
  const billDot = (bill: BalanceBill) => function BillDot({ cx = 0, cy = 0 }: Shape) {
    const marker = markers.find((entry) => entry.key === `bill-${bill.statementId}`)!;
    return <g {...interaction(marker, cx, cy + PLOT_HEIGHT)}>
      <polygon points={`${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}`} className={TONE_CLASS[bill.status.tone]} strokeWidth="1.7" />
    </g>;
  };
  const maxCost = Math.max(1, ...history.bills.map((bill) => bill.costsMinor ?? 0));
  const costBar = (bill: BalanceBill) => function CostBar({ cx = 0, cy = 0 }: Shape) {
    const height = Math.max(2, (bill.costsMinor ?? 0) / maxCost * 16);
    return <g aria-hidden>
      <rect x={cx - 3} y={cy - height} width={6} height={height} rx={1} className="fill-amber-500" opacity={0.85} />
      <text x={cx + 6} y={cy - 1} fontSize="10" className="fill-amber-700 dark:fill-amber-400">{compact(bill.costsMinor ?? 0)}</text>
    </g>;
  };

  return <div ref={box} className="relative min-w-160" role="group" aria-label={CHART_LABEL}>
    <ResponsiveContainer width="100%" height={PLOT_HEIGHT} initialDimension={{ width: 900, height: PLOT_HEIGHT }}>
      <ComposedChart data={data} margin={{ ...MARGIN, top: 40, bottom: 0 }} accessibilityLayer>
        <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="var(--chart-rate-change)" opacity="0.06" />
          <path d="M-1 1 1-1 M0 6 6 0 M5 7 7 5" stroke="var(--chart-rate-change)" strokeWidth="2" opacity="0.3" />
        </pattern></defs>
        {history.cycles.map((cycle, index) => index % 2 === 1 && <ReferenceArea key={cycle.statementId} x1={timestamp(cycle.from)}
          x2={timestamp(addDays(cycle.to, 1))} fill="var(--muted)" fillOpacity={0.35} stroke="none" />)}
        <CartesianGrid vertical={false} stroke="var(--border)" opacity={0.5} />
        {monthTicks.map((tick) => <ReferenceLine key={tick} x={tick} stroke="var(--border)" />)}
        <XAxis dataKey="timestamp" type="number" scale="time" domain={domain} allowDataOverflow ticks={monthTicks} hide />
        <YAxis domain={[0, top]} ticks={ticks} tickFormatter={compact} tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
        {history.bands.map((band) => <ReferenceArea
          key={`${band.from}-${band.kind}`}
          x1={timestamp(band.from)}
          x2={Math.min(timestamp(addDays(band.to, 1)), timestamp(history.today))}
          y1={0}
          y2={top}
          fill={band.kind === "free" ? "var(--chart-1)" : `url(#${pattern})`}
          fillOpacity={band.kind === "free" ? 0.06 : 1}
          stroke="none"
        />)}
        {showLimit && <Line dataKey="limitMinor" name="Limit" type="stepAfter" stroke="var(--muted-foreground)" strokeWidth={1}
          strokeDasharray="6 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />}
        {limitStarts.map((point) => <ReferenceDot key={`limit-${point.date}`} x={point.timestamp} y={point.limitMinor!} r={0}
          label={{ value: `Limit ${money(point.limitMinor)}`, position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 10, dx: 4, dy: 12 }} />)}
        <Area dataKey="valueMinor" name="Total owed" type="stepAfter" stroke="var(--foreground)" strokeOpacity={0.7} strokeWidth={1.5}
          fill="var(--chart-3)" fillOpacity={0.12} baseValue={0} connectNulls={false} dot={false}
          activeDot={{ r: 3, fill: "var(--foreground)", stroke: "var(--background)" }} isAnimationActive={false} />
        {projection && <Line dataKey="projectedMinor" name="If you pay Left to pay" type="stepAfter" stroke="var(--chart-1)" strokeWidth={1.5}
          strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: "var(--chart-1)" }} connectNulls isAnimationActive={false} />}
        <ReferenceLine x={timestamp(history.today)} stroke="var(--foreground)" strokeOpacity={0.6} strokeDasharray="3 3"
          label={{ value: "Today", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
        {statements.map((event) => <ReferenceDot key={event.id} x={timestamp(event.date)} y={event.amountMinor!} shape={statementDot(event)} />)}
        <Tooltip filterNull={false} active={popover ? false : undefined} isAnimationActive={false}
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const point = payload?.find((entry) => entry.dataKey === "valueMinor" || entry.dataKey === "projectedMinor")?.payload as
              (BalanceDay & { projectedMinor: number | null }) | undefined;
            if (!active || !point || (point.valueMinor === null && point.projectedMinor === null)) return null;
            return <DayTooltip point={point} events={eventsOn(point.date)} limit={limitAt(point.date)} />;
          }} />
      </ComposedChart>
    </ResponsiveContainer>
    <ResponsiveContainer width="100%" height={LANE_HEIGHT} initialDimension={{ width: 900, height: LANE_HEIGHT }}>
      <ComposedChart data={lane} margin={{ ...MARGIN, top: 4, bottom: 0 }}>
        {history.cycles.map((cycle, index) => index % 2 === 1 && <ReferenceArea key={cycle.statementId} x1={timestamp(cycle.from)}
          x2={timestamp(addDays(cycle.to, 1))} fill="var(--muted)" fillOpacity={0.35} stroke="none" />)}
        <XAxis dataKey="timestamp" type="number" scale="time" domain={domain} allowDataOverflow ticks={monthTicks}
          tickFormatter={(value: number) => formatCardDate(new Date(value).toISOString().slice(0, 10)).slice(3)}
          tick={AXIS_TICK} height={22} tickLine={{ stroke: "var(--muted-foreground)" }} tickSize={5} axisLine={{ stroke: "var(--muted-foreground)" }} />
        {monthTicks.map((tick) => <ReferenceLine key={tick} x={tick} stroke="var(--border)" />)}
        <YAxis domain={[0, 2]} ticks={[0.45, 1.4]} tickFormatter={(value: number) => (value > 1 ? "Bills" : "Interest")}
          tick={{ ...AXIS_TICK, fontSize: 10 }} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
        {/* A hidden series: without numeric values Recharts gives the lane no Y scale and draws no markers. */}
        <Line dataKey="lane" stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none" />
        <ReferenceLine x={timestamp(history.today)} stroke="var(--foreground)" strokeOpacity={0.6} strokeDasharray="3 3" />
        {history.bills.map((bill) => <ReferenceDot key={bill.statementId} x={timestamp(bill.dueDate)} y={1.4} shape={billDot(bill)} />)}
        {history.bills.filter((bill) => bill.costsMinor && bill.closingDate >= history.from).map((bill) => <ReferenceDot
          key={`cost-${bill.statementId}`} x={timestamp(bill.closingDate)} y={0.15} shape={costBar(bill)} />)}
      </ComposedChart>
    </ResponsiveContainer>
    {popover && <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-72 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
      style={{
        // Markers in the lower half (the bills lane) open the popover above them, so it is never cut off.
        ...(popover.y > (PLOT_HEIGHT + LANE_HEIGHT) / 2
          ? { top: popover.y - 12, transform: "translateY(-100%)" }
          : { top: Math.max(0, popover.y - 12) }),
        left: popover.x > popover.width - 310 ? undefined : popover.x + 14,
        right: popover.x > popover.width - 310 ? popover.width - popover.x + 14 : undefined,
      }}
    >{popover.details}</div>}
  </div>;
}
