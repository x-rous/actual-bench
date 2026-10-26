"use client";
import { useState, type ReactNode } from "react";
import { yearsBetween } from "@/lib/asset-registry/yields";
import { Checkbox } from "@/components/ui/checkbox";
import { lazyChart } from "@/features/credit-cards/components/charts/lazyChart";
import { cn } from "@/lib/utils";
import type { CapitalMovement } from "@/lib/asset-registry/capitalMovements";
import { bookTypeShort } from "@/lib/asset-registry/models";
import { InfoHint } from "@/components/ui/info-hint";
import { CAPITAL_TYPES } from "@/lib/asset-registry/models";
import { withSmallDecimals } from "@/features/credit-cards/components/primitives/Figure";
import { assetMoney, NA } from "./AssetPresentation";
import { MARKER_COLORS, MarkerLane } from "./MarkerLane";
import { bookMarkers, buildBuckets, cashflowMarkers, cashflowPoints, financingMarkers, valuePoints, type FinancingEvent, type Marker, type OperatingEntry, type View } from "./timeline";

const valuePlot = lazyChart(() => import("@/features/credit-cards/components/charts/AssetValueTimeline"));
const cashPlot = lazyChart(() => import("@/features/credit-cards/components/charts/AssetCashflowTimeline"));
const ValuePlot = valuePlot.Chart; const CashPlot = cashPlot.Chart;
const LOADING = <div className="h-[200px] animate-pulse rounded bg-muted/30" aria-label="Loading chart" />;
const VIEWS: [View, string][] = [["monthly", "Monthly"], ["yearly", "Yearly"]];
const signed = (minor: number) => `${minor > 0 ? "+" : ""}${assetMoney(minor)}`;
const BOOK_KIND_LABEL = { in: "Purchases & payments", revalue: "Revaluation & write-down", out: "Disposal", depreciation: "Depreciation", operating: "Income & expenses", financing: "Loan allocation change" } as const;
const CAPITAL_LABEL: Record<string, string> = { investment: "Purchases and payments", disposal: "Disposal proceeds, net of selling costs" };

/** What the viewer chose on the charts. The page holds it, so it survives a change of tab (though not a reload). */
export type ChartPrefs = { view: View; includeCapital: boolean; showNet: boolean; showProjection: boolean; smoothValue: boolean; showCapital: boolean; showEquity: boolean; showCumulative: boolean };
export const DEFAULT_CHART_PREFS: ChartPrefs = { view: "yearly", includeCapital: false, showNet: true, showProjection: true, smoothValue: false, showCapital: true, showEquity: false, showCumulative: false };
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
  /** The chart choices, held by the page; the charts keep their own when the page does not. */ prefs?: ChartPrefs; onPrefs?: (prefs: ChartPrefs) => void;
};

function Card({ title, hint, legend, children }: { title: string; hint: string; legend: ReactNode; children: ReactNode }) {
  return <figure aria-label={title} className="min-w-0 rounded-lg border bg-background">
    <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2"><div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">{title}</h2><InfoHint label={title}>{hint}</InfoHint></div><div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">{legend}</div></figcaption>
    <div className="p-4">{children}</div>
  </figure>;
}
const Stat = ({ label, value, detail }: { label: string; value: string; detail?: string }) => <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{withSmallDecimals(value)}</dd><dd className="min-h-4 text-[11px] text-muted-foreground">{detail ?? " "}</dd></div>;
const Swatch = ({ children, label }: { children: ReactNode; label: string }) => <span className="inline-flex items-center gap-1.5"><svg width="16" height="10" aria-hidden>{children}</svg>{label}</span>;

/** The two synchronized timelines: asset value with debt, events and projected depreciation; and income, expenses and capital. */
export function TimelineSection(p: TimelineProps) {
  const [kept, setKept] = useState(DEFAULT_CHART_PREFS);
  const prefs = p.prefs ?? kept;
  const choose = (patch: Partial<ChartPrefs>) => (p.onPrefs ?? setKept)({ ...prefs, ...patch });
  const { view, includeCapital, showNet, showProjection, smoothValue, showCapital, showEquity, showCumulative } = prefs;
  const [hover, setHover] = useState<number | null>(null);
  const dates = [...p.rows.map((r) => r.date), ...p.operating.map((e) => e.date), ...p.capital.map((m) => m.date)].sort();
  const unposted = showProjection ? p.unposted : [];
  const future = unposted.length > 0 ? (view === "monthly" ? 6 : 3) : 0;
  const buckets = buildBuckets(view, p.today, dates[0] ?? null, future);
  const titles = buckets.map((b) => b.title);
  // What was put in up to the end of each period (opening value, purchases, added capital): the line the value is measured against.
  const capitalTo = (date: string) => p.rows.filter((r) => CAPITAL_TYPES.includes(r.classification ?? "") && r.date <= date).reduce((sum, r) => sum + r.amountMinor, 0);
  const points = valuePoints(buckets, p.rows, p.valueMinor, p.debtAt, unposted).map((pt, i) => ({ ...pt, title: titles[i], projected: buckets[i].projected, capital: buckets[i].projected ? null : capitalTo(buckets[i].to) }));
  const known = points.map((pt, index) => ({ ...pt, index })).filter((pt) => !pt.projected && pt.value !== null) as (typeof points[number] & { value: number; index: number })[];
  const first = known[0]; const last = known[known.length - 1];
  // The summary follows the pointer (or the focused marker); at rest it shows the latest period.
  const at = known.find((k) => k.index === hover) ?? last;
  // Money put in (purchases, opening value, added capital) is not a change in worth: value change leaves it out.
  const capitalInRange = first && at ? p.rows.filter((r) => CAPITAL_TYPES.includes(r.classification ?? "") && r.date > buckets[first.index].to && r.date <= buckets[at.index].to).reduce((sum, r) => sum + r.amountMinor, 0) : 0;
  const change = first && at ? at.value - first.value - capitalInRange : null;
  const changeBase = first ? first.value + capitalInRange : 0;
  // The compound yearly rate of that change, once the range spans a year.
  const years = first && at ? yearsBetween(buckets[first.index].to, buckets[at.index].to) : 0;
  const yearly = change !== null && changeBase > 0 && years >= 1 && 1 + change / changeBase > 0 ? (Math.pow(1 + change / changeBase, 1 / years) - 1) * 100 : null;
  const yearlyDetail = yearly === null ? "Needs a range of at least a year" : `Value change over ${years.toFixed(1)} years, money put in left out`;
  const changeDetail = change !== null && changeBase > 0 ? `${change > 0 ? "+" : ""}${((change / changeBase) * 100).toFixed(2)}%` : undefined;
  // Before the first loan allocation there is no debt to show: that is "no loan yet", not an unreadable balance.
  const firstLoan = p.financing.map((e) => e.date).sort()[0];
  const noLoanYet = !!at && !!firstLoan && buckets[at.index].to < firstLoan;
  const ofValue = (minor: number | null) => minor !== null && at && at.value > 0 ? `${((minor / at.value) * 100).toFixed(1)}% of value` : undefined;
  const equityAt = at && at.debt !== null ? at.value - at.debt : null;
  // What the value is against what was put in.
  const capitalAt = at?.capital ?? null;
  const againstCapital = capitalAt !== null && capitalAt > 0 && at ? (at.value >= capitalAt ? `${(at.value / capitalAt).toFixed(1)}× capital` : `${Math.round((1 - at.value / capitalAt) * 100)}% below capital`) : undefined;
  const hasDebt = points.some((pt) => pt.debt !== null);
  const markers = [...bookMarkers(buckets, p.rows), ...financingMarkers(buckets, p.financing)];
  const cashBase = cashflowPoints(buckets, p.operating, p.capital);
  const cashPts = cashBase.map((pt, i) => ({ ...pt, title: titles[i], cumulative: pt.projected ? null : cashBase.slice(0, i + 1).reduce((total, x) => total + x.net, 0) }));
  const firstOperating = p.operating.map((e) => e.date).sort()[0];
  // The whole history of linked income and expenses, whichever periods the chart shows: what it pays each year since the first of them.
  const operatingYears = firstOperating ? yearsBetween(firstOperating, p.today) : 0;
  const yearlyNet = operatingYears >= 0.5 ? p.operating.reduce((total, e) => total + e.amountMinor, 0) / operatingYears : null;
  const cashMarkers = cashflowMarkers(buckets, cashPts, p.capital);
  const sum = (key: "income" | "expenses" | "net" | "investment" | "disposal") => cashPts.reduce((s, pt) => s + pt[key], 0);
  const hasCapital = p.capital.some((m) => buckets.some((b) => m.date >= b.from && m.date <= b.to));
  const describeBook = (m: Marker) => m.kind === "financing" ? `${buckets[m.index].title}: ${m.note}. Open Financing` : `${buckets[m.index].title}: ${m.count > 1 ? `${m.count} ` : ""}${m.kind === "depreciation" ? "depreciation postings" : m.types.map(bookTypeShort).join(", ")} ${signed(m.amountMinor)}. Show these transactions`;
  const describeCash = (m: Marker) => m.kind === "operating" ? `${buckets[m.index].title}: net operating result ${signed(m.amountMinor)}. Show income and expenses` : `${buckets[m.index].title}: ${CAPITAL_LABEL[m.types[0]]} ${signed(m.amountMinor)}${m.count > 1 ? ` (${m.count})` : ""}. Show these transactions`;
  const bookFocus = (m: Marker) => m.kind === "financing" ? p.onFinancing() : p.onBook({ from: m.from, to: m.to, types: m.types, label: `${m.kind === "depreciation" ? "Depreciation" : m.types.map(bookTypeShort).join(", ")} · ${buckets[m.index].title}` });
  const cashSelect = (m: Marker) => {
    const b = buckets[m.index];
    if (m.kind === "operating") p.onCashflow({ from: m.from, to: m.to, label: b.title });
    else p.onBook({ from: m.from, to: m.to, types: m.types[0] === "disposal" ? ["disposal"] : ["acquisition", "added-capital"], label: `${CAPITAL_LABEL[m.types[0]]} · ${b.title}` });
  };
  const kinds = (Object.keys(BOOK_KIND_LABEL_SHOWN) as (keyof typeof BOOK_KIND_LABEL_SHOWN)[]).filter((k) => markers.some((m) => m.kind === k));
  return <section aria-label="Timelines" className="grid gap-3">
    <Card title="Recorded value over time" hint="The asset's value from its Actual Asset Ledger entries; future transactions are excluded. Hover a period to read its value, debt and equity; click a marker to see the transactions behind it." legend={<>
      {p.notice}
      <Swatch label="Recorded value"><path d="M0 7h6V3h10" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" /></Swatch>
      {points.some((pt) => (pt.capital ?? 0) > 0) && <button type="button" aria-pressed={showCapital} onClick={() => choose({ showCapital: !showCapital })} className={cn("inline-flex items-center gap-1.5 rounded hover:text-foreground", !showCapital && "line-through opacity-60")}><svg width="16" height="10" aria-hidden><path d="M0 5h16" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeDasharray="2 3" /></svg>Capital invested</button>}
      {hasDebt && <button type="button" aria-pressed={showEquity} onClick={() => choose({ showEquity: !showEquity })} className={cn("inline-flex items-center gap-1.5 rounded hover:text-foreground", !showEquity && "line-through opacity-60")}><svg width="16" height="10" aria-hidden><path d="M0 5h16" fill="none" stroke="#0d9488" strokeWidth="1.75" /></svg>Equity</button>}
      {hasDebt && <Swatch label="Allocated debt"><path d="M0 7h6V3h10" fill="none" stroke="#e11d48" strokeWidth="1.5" /></Swatch>}
      {p.unposted.length > 0 && <button type="button" aria-pressed={showProjection} onClick={() => choose({ showProjection: !showProjection })} className={cn("inline-flex items-center gap-1.5 rounded hover:text-foreground", !showProjection && "line-through opacity-60")}><svg width="16" height="10" aria-hidden><path d="M0 5h16" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>Projected if the schedule posts</button>}
      {kinds.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>{k === "depreciation" ? <rect x="5" y="1" width="2" height="10" rx="1" fill={MARKER_COLORS[k]} /> : k === "financing" ? <circle cx="6" cy="6" r="4" fill={MARKER_COLORS[k]} /> : <path d="M6 0.5l5 5.5-5 5.5-5-5.5z" fill={MARKER_COLORS[k]} />}</svg>{BOOK_KIND_LABEL_SHOWN[k]}</span>)}
      <label className="inline-flex cursor-pointer items-center gap-1.5"><Checkbox checked={smoothValue} onCheckedChange={(v) => choose({ smoothValue: v === true })} />Smooth value</label>
      <div role="group" aria-label="Chart view" className="inline-flex overflow-hidden rounded-md border text-xs">{VIEWS.map(([value, text]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => choose({ view: value })} className={cn("h-6 px-2.5 font-medium", view === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}</div>
    </>}>
      {known.length === 0 ? <p className="py-8 text-sm text-muted-foreground">{NA} No recorded value yet. Values appear once the asset has Asset Ledger entries.</p> :
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><div className="min-w-0">
          <ValuePlot fallback={LOADING} points={points} smooth={smoothValue} showCapital={showCapital} showEquity={showEquity} onActive={setHover} />
          <MarkerLane label="Value chart events" buckets={buckets} markers={markers} describe={describeBook} onSelect={bookFocus} onFocusBucket={setHover} />
        </div>
          <dl aria-label="Value summary" className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
            <div className="col-span-full text-[11px] text-muted-foreground">As of {at.title.replace(" (to date)", "")}</div>
            {hasDebt ? <>
              <Stat label="Recorded value" value={assetMoney(at.value)} />
              <Stat label="Value change in range" value={change === null ? NA : signed(change)} detail={changeDetail} />
              <Stat label="Allocated debt" value={at.debt === null ? (noLoanYet ? NA : "Unavailable") : assetMoney(at.debt)} detail={noLoanYet ? "No loan yet" : ofValue(at.debt)} />
              <Stat label="Equity" value={equityAt === null ? (noLoanYet ? NA : "Unavailable") : assetMoney(equityAt)} detail={noLoanYet ? "No loan yet" : ofValue(equityAt)} />
              <Stat label="Capital invested" value={capitalAt === null ? NA : assetMoney(capitalAt)} detail={againstCapital} />
              <Stat label="Yearly growth" value={yearly === null ? NA : `${yearly > 0 ? "+" : ""}${yearly.toFixed(1)}% a year`} detail={yearlyDetail} />
            </> : <>
              <Stat label="Closing value" value={assetMoney(at.value)} detail={`as of ${at.title.replace(" (to date)", "")}`} />
              <Stat label="Change in range" value={change === null ? NA : signed(change)} detail={changeDetail} />
              <Stat label="Opening value" value={assetMoney(first.value)} detail={`as of ${first.title}`} />
              <Stat label="Capital invested" value={capitalAt === null ? NA : assetMoney(capitalAt)} detail={againstCapital} />
              <Stat label="Yearly growth" value={yearly === null ? NA : `${yearly > 0 ? "+" : ""}${yearly.toFixed(1)}% a year`} detail={yearlyDetail} />
            </>}
          </dl></div>}
    </Card>
    {p.showCashflow && <Card title="Income, expenses & capital" hint="Linked transactions from your other accounts, over the same periods as the chart above. Income and expenses make the operating result; capital movements (purchases and payments, sale proceeds net of selling costs) are shown apart." legend={<>
      <Swatch label="Income"><rect width="16" height="8" y="1" fill="#16a34a" /></Swatch><Swatch label="Expenses"><rect width="16" height="8" y="1" fill="#dc2626" /></Swatch>
      <button type="button" aria-pressed={showNet} onClick={() => choose({ showNet: !showNet })} className={cn("inline-flex items-center gap-1.5 rounded hover:text-foreground", !showNet && "line-through opacity-60")}><svg width="16" height="10" aria-hidden><path d="M0 5h16" stroke="var(--foreground)" strokeWidth="2" /></svg>Net operating result</button>
      <button type="button" aria-pressed={showCumulative} onClick={() => choose({ showCumulative: !showCumulative })} className={cn("inline-flex items-center gap-1.5 rounded hover:text-foreground", !showCumulative && "line-through opacity-60")}><svg width="16" height="10" aria-hidden><path d="M0 5h16" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.75" strokeDasharray="5 4" /></svg>Net result so far</button>
      {hasCapital && <label className="inline-flex cursor-pointer items-center gap-1.5"><Checkbox checked={includeCapital} onCheckedChange={(v) => choose({ includeCapital: v === true })} />Include capital movements</label>}
    </>}>
      {p.reading ? <p className="py-8 text-sm text-muted-foreground">Reading linked accounts…</p> :
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><div className="min-w-0">
          <CashPlot fallback={LOADING} points={cashPts} includeCapital={includeCapital} showNet={showNet} showCumulative={showCumulative} onSelect={(index) => { const b = buckets[index]; if (b) p.onCashflow({ from: b.from, to: b.to, label: b.title }); }} />
          <MarkerLane label="Income and capital markers" buckets={buckets} markers={cashMarkers} describe={describeCash} onSelect={cashSelect} />
        </div>
          <dl aria-label="Income and expense summary" className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs xl:pt-2">
            <Stat label="Operating income" value={assetMoney(sum("income"))} detail="in range" />
            <Stat label="Operating expenses" value={assetMoney(sum("expenses"))} detail={sum("income") > 0 ? `${((-sum("expenses") / sum("income")) * 100).toFixed(1)}% of income` : "in range"} />
            <Stat label="Net operating result" value={assetMoney(sum("net"))} detail="income less expenses" />
            <Stat label="Average yearly net result" value={yearlyNet === null ? NA : assetMoney(Math.round(yearlyNet))} detail={yearlyNet === null ? "Needs six months of income or expenses" : `${assetMoney(Math.round(yearlyNet / 12))} monthly - ${operatingYears.toFixed(1)} years`} />
            {hasCapital && <Stat label="Capital out" value={assetMoney(sum("investment"))} detail="purchases and payments" />}
            {hasCapital && <Stat label="Net disposal proceeds" value={assetMoney(sum("disposal"))} detail="after selling costs" />}
          </dl></div>}
    </Card>}
  </section>;
}
const BOOK_KIND_LABEL_SHOWN = { in: BOOK_KIND_LABEL.in, revalue: BOOK_KIND_LABEL.revalue, out: BOOK_KIND_LABEL.out, depreciation: BOOK_KIND_LABEL.depreciation, financing: BOOK_KIND_LABEL.financing } as const;
