"use client";
import { useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { lazyChart } from "@/features/credit-cards/components/charts/lazyChart";
import { cn } from "@/lib/utils";
import type { CapitalMovement } from "@/lib/asset-registry/capitalMovements";
import { bookTypeShort } from "@/lib/asset-registry/models";
import { InfoHint } from "@/components/ui/info-hint";
import { assetMoney, NA } from "./AssetPresentation";
import { MARKER_COLORS, MarkerLane } from "./MarkerLane";
import { bookMarkers, buildBuckets, cashflowMarkers, cashflowPoints, financingMarkers, valuePoints, type FinancingEvent, type Marker, type OperatingEntry, type View } from "./timeline";

const valuePlot = lazyChart(() => import("@/features/credit-cards/components/charts/AssetValueTimeline"));
const cashPlot = lazyChart(() => import("@/features/credit-cards/components/charts/AssetCashflowTimeline"));
const ValuePlot = valuePlot.Chart; const CashPlot = cashPlot.Chart;
const LOADING = <div className="h-[230px] animate-pulse rounded bg-muted/30" aria-label="Loading chart" />;
const VIEWS: [View, string][] = [["monthly", "Monthly"], ["yearly", "Yearly"]];
const signed = (minor: number) => `${minor > 0 ? "+" : ""}${assetMoney(minor)}`;
const BOOK_KIND_LABEL = { in: "Purchase & CapEx", revalue: "Revaluation & write-down", out: "Disposal", depreciation: "Depreciation", operating: "Income & expenses", financing: "Loan allocation change" } as const;
const CAPITAL_LABEL: Record<string, string> = { investment: "Acquisition payments", capex: "Capital expenditure", disposal: "Disposal proceeds, net of selling costs" };

export type BookFocus = { from: string; to: string; types?: string[]; label: string };
export type CashflowFocus = { from: string; to: string; type?: string; label: string };
export type TimelineProps = {
  today: string; valueMinor: number | null;
  rows: { date: string; classification: string | null; amountMinor: number; runningMinor: number | null }[];
  debtAt: (date: string) => number | null;
  /** Schedule months not yet posted (planned decreases, positive). */ unposted: { postDate: string; amountMinor: number }[];
  operating: OperatingEntry[]; capital: CapitalMovement[]; showCashflow: boolean; reading: boolean;
  /** Loan allocation changes, marked on the value chart so a drop in debt is not read as a repayment. */ financing: FinancingEvent[]; onFinancing: () => void;
  /** Shown beside the value chart's legend (for example the unclassified-transactions button). */ notice?: ReactNode;
  onBook: (focus: BookFocus) => void; onCashflow: (focus: CashflowFocus) => void;
};

function Card({ title, hint, legend, children }: { title: string; hint: string; legend: ReactNode; children: ReactNode }) {
  return <figure aria-label={title} className="min-w-0 rounded-lg border bg-background">
    <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2"><div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">{title}</h2><InfoHint label={title}>{hint}</InfoHint></div><div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">{legend}</div></figcaption>
    <div className="p-4">{children}</div>
  </figure>;
}
const Stat = ({ label, value, detail }: { label: string; value: string; detail?: string }) => <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>{detail && <dd className="text-[11px] text-muted-foreground">{detail}</dd>}</div>;
const Swatch = ({ children, label }: { children: ReactNode; label: string }) => <span className="inline-flex items-center gap-1.5"><svg width="16" height="10" aria-hidden>{children}</svg>{label}</span>;

/** The two synchronized timelines: asset value with debt, events and projected depreciation; and income, expenses and capital. */
export function TimelineSection(p: TimelineProps) {
  const [view, setView] = useState<View>("monthly");
  const [includeCapital, setIncludeCapital] = useState(false);
  const [showNet, setShowNet] = useState(true); const [showProjection, setShowProjection] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const dates = [...p.rows.map((r) => r.date), ...p.operating.map((e) => e.date), ...p.capital.map((m) => m.date)].sort();
  const unposted = showProjection ? p.unposted : [];
  const future = unposted.length > 0 ? (view === "monthly" ? 6 : 3) : 0;
  const buckets = buildBuckets(view, p.today, dates[0] ?? null, future);
  const titles = buckets.map((b) => b.title);
  const points = valuePoints(buckets, p.rows, p.valueMinor, p.debtAt, unposted).map((pt, i) => ({ ...pt, title: titles[i], projected: buckets[i].projected }));
  const known = points.map((pt, index) => ({ ...pt, index })).filter((pt) => !pt.projected && pt.value !== null) as (typeof points[number] & { value: number; index: number })[];
  const first = known[0]; const last = known[known.length - 1];
  // The summary follows the pointer (or the focused marker); at rest it shows the latest period.
  const at = known.find((k) => k.index === hover) ?? last;
  const change = first && at ? at.value - first.value : null;
  const equityAt = at && at.debt !== null ? at.value - at.debt : null;
  const hasDebt = points.some((pt) => pt.debt !== null);
  const markers = [...bookMarkers(buckets, p.rows), ...financingMarkers(buckets, p.financing)];
  const cashPts = cashflowPoints(buckets, p.operating, p.capital).map((pt, i) => ({ ...pt, title: titles[i] }));
  const cashMarkers = cashflowMarkers(buckets, cashPts, p.capital);
  const sum = (key: "income" | "expenses" | "net" | "investment" | "capex" | "disposal") => cashPts.reduce((s, pt) => s + pt[key], 0);
  const hasCapital = p.capital.some((m) => buckets.some((b) => m.date >= b.from && m.date <= b.to));
  const describeBook = (m: Marker) => m.kind === "financing" ? `${buckets[m.index].title}: ${m.note}. Open Financing` : `${buckets[m.index].title}: ${m.count > 1 ? `${m.count} ` : ""}${m.kind === "depreciation" ? "depreciation postings" : m.types.map(bookTypeShort).join(", ")} ${signed(m.amountMinor)}. Show these transactions`;
  const describeCash = (m: Marker) => m.kind === "operating" ? `${buckets[m.index].title}: net operating result ${signed(m.amountMinor)}. Show income and expenses` : `${buckets[m.index].title}: ${CAPITAL_LABEL[m.types[0]]} ${signed(m.amountMinor)}${m.count > 1 ? ` (${m.count})` : ""}. Show these transactions`;
  const bookFocus = (m: Marker) => m.kind === "financing" ? p.onFinancing() : p.onBook({ from: m.from, to: m.to, types: m.types, label: `${m.kind === "depreciation" ? "Depreciation" : m.types.map(bookTypeShort).join(", ")} · ${buckets[m.index].title}` });
  const cashSelect = (m: Marker) => {
    const b = buckets[m.index];
    if (m.kind === "operating") p.onCashflow({ from: m.from, to: m.to, label: b.title });
    else if (m.types[0] === "capex") p.onCashflow({ from: m.from, to: m.to, type: "capital-expenditure", label: `Capital expenditure · ${b.title}` });
    else p.onBook({ from: m.from, to: m.to, types: [m.types[0] === "disposal" ? "disposal" : "acquisition"], label: `${CAPITAL_LABEL[m.types[0]]} · ${b.title}` });
  };
  const kinds = (Object.keys(BOOK_KIND_LABEL_SHOWN) as (keyof typeof BOOK_KIND_LABEL_SHOWN)[]).filter((k) => markers.some((m) => m.kind === k));
  return <section aria-label="Timelines" className="grid gap-3">
    <Card title="Recorded value over time" hint="The asset's value from its Actual account transactions; future transactions are excluded. Hover a period to read its value, debt and equity; click a marker to see the transactions behind it." legend={<>
      {p.notice}
      <Swatch label="Recorded value"><path d="M0 7h6V3h10" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" /></Swatch>
      {hasDebt && <Swatch label="Allocated debt"><path d="M0 7h6V3h10" fill="none" stroke="#e11d48" strokeWidth="1.5" /></Swatch>}
      {p.unposted.length > 0 && <button type="button" aria-pressed={showProjection} onClick={() => setShowProjection((v) => !v)} className={cn("inline-flex items-center gap-1.5 rounded hover:text-foreground", !showProjection && "line-through opacity-60")}><svg width="16" height="10" aria-hidden><path d="M0 5h16" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>Projected if the schedule posts</button>}
      {kinds.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>{k === "depreciation" ? <rect x="5" y="1" width="2" height="10" rx="1" fill={MARKER_COLORS[k]} /> : k === "financing" ? <circle cx="6" cy="6" r="4" fill={MARKER_COLORS[k]} /> : <path d="M6 0.5l5 5.5-5 5.5-5-5.5z" fill={MARKER_COLORS[k]} />}</svg>{BOOK_KIND_LABEL_SHOWN[k]}</span>)}
      <div role="group" aria-label="Chart view" className="inline-flex overflow-hidden rounded-md border text-xs">{VIEWS.map(([value, text]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={cn("h-6 px-2.5 font-medium", view === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}</div>
    </>}>
      {known.length === 0 ? <p className="py-8 text-sm text-muted-foreground">{NA} No recorded value yet. Values appear once the asset has account transactions.</p> :
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_200px]"><div className="min-w-0">
          <ValuePlot fallback={LOADING} points={points} onActive={setHover} />
          <MarkerLane label="Value chart events" buckets={buckets} markers={markers} describe={describeBook} onSelect={bookFocus} onFocusBucket={setHover} />
        </div>
          <dl aria-label="Value summary" className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 xl:grid-cols-1 xl:gap-4 xl:pt-2">
            <div className="col-span-full text-[11px] text-muted-foreground">As of {at.title.replace(" (to date)", "")}</div>
            {hasDebt ? <>
              <Stat label="Recorded value" value={assetMoney(at.value)} />
              <Stat label="Allocated debt" value={at.debt === null ? "Unavailable" : assetMoney(at.debt)} />
              <Stat label="Tracked equity" value={equityAt === null ? "Unavailable" : assetMoney(equityAt)} />
              <Stat label="Value change in range" value={change === null ? NA : signed(change)} detail={change !== null && first.value > 0 ? `${change > 0 ? "+" : ""}${((change / first.value) * 100).toFixed(2)}%` : undefined} />
            </> : <>
              <Stat label="Opening value" value={assetMoney(first.value)} detail={`as of ${first.title}`} />
              <Stat label="Change in range" value={change === null ? NA : signed(change)} detail={change !== null && first.value > 0 ? `${change > 0 ? "+" : ""}${((change / first.value) * 100).toFixed(2)}%` : undefined} />
              <Stat label="Closing value" value={assetMoney(at.value)} detail={`as of ${at.title.replace(" (to date)", "")}`} />
            </>}
          </dl></div>}
    </Card>
    {p.showCashflow && <Card title="Income, expenses & capital" hint="Linked transactions from your other accounts, over the same periods as the chart above. Income and expenses make the operating result; capital movements (purchases, CapEx, sale proceeds net of selling costs) are shown apart." legend={<>
      <Swatch label="Income"><rect width="16" height="8" y="1" fill="#16a34a" /></Swatch><Swatch label="Expenses"><rect width="16" height="8" y="1" fill="#dc2626" /></Swatch>
      <button type="button" aria-pressed={showNet} onClick={() => setShowNet((v) => !v)} className={cn("inline-flex items-center gap-1.5 rounded hover:text-foreground", !showNet && "line-through opacity-60")}><svg width="16" height="10" aria-hidden><path d="M0 5h16" stroke="var(--foreground)" strokeWidth="2" /></svg>Net operating result</button>
      {hasCapital && <label className="inline-flex cursor-pointer items-center gap-1.5"><Checkbox checked={includeCapital} onCheckedChange={(v) => setIncludeCapital(v === true)} />Include capital movements</label>}
    </>}>
      {p.reading ? <p className="py-8 text-sm text-muted-foreground">Reading linked accounts…</p> :
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_200px]"><div className="min-w-0">
          <CashPlot fallback={LOADING} points={cashPts} includeCapital={includeCapital} showNet={showNet} onSelect={(index) => { const b = buckets[index]; if (b) p.onCashflow({ from: b.from, to: b.to, label: b.title }); }} />
          <MarkerLane label="Income and capital markers" buckets={buckets} markers={cashMarkers} describe={describeCash} onSelect={cashSelect} />
        </div>
          <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 xl:grid-cols-1 xl:gap-4 xl:pt-2">
            <Stat label="Operating income" value={assetMoney(sum("income"))} detail="in range" /><Stat label="Operating expenses" value={assetMoney(sum("expenses"))} detail="in range" />
            <Stat label="Net operating result" value={assetMoney(sum("net"))} detail="income less expenses" />
            {hasCapital && <Stat label="Capital out" value={assetMoney(sum("investment") + sum("capex"))} detail="acquisitions and CapEx" />}
            {hasCapital && <Stat label="Net disposal proceeds" value={assetMoney(sum("disposal"))} detail="after selling costs" />}
          </dl></div>}
    </Card>}
  </section>;
}
const BOOK_KIND_LABEL_SHOWN = { in: BOOK_KIND_LABEL.in, revalue: BOOK_KIND_LABEL.revalue, out: BOOK_KIND_LABEL.out, depreciation: BOOK_KIND_LABEL.depreciation, financing: BOOK_KIND_LABEL.financing } as const;
