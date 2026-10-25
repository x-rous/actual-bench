"use client";
import { Fragment, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { InfoHint } from "@/components/ui/info-hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import type { CapitalizationIssue } from "@/lib/asset-registry/capitalization";
import type { CapitalMovement } from "@/lib/asset-registry/capitalMovements";
import type { AssetPerformance } from "@/lib/asset-registry/performance";
import type { Asset } from "@/lib/asset-registry/models";
import { valueBridge } from "@/lib/asset-registry/valueBridge";
import { type attributeBook } from "@/lib/asset-registry/ledger";
import { assetMoney, bookTypeLabel, NA, SummaryStrip } from "./AssetPresentation";
import { CapitalizationReview } from "./CapitalizationReview";
import { cashflowByYear } from "./cashflowSummary";
import { percent } from "./ReportControls";
import { TimelineSection, type BookFocus, type CashflowFocus } from "./TimelineSection";
import type { FinancingEvent, OperatingEntry } from "./timeline";
import type { BookView } from "./BookPanel";

type Props = {
  asset: Asset; date: string; valueMinor: number | null; reading: boolean;
  /** Performance for any period; undefined until the linked accounts are read. */ reportFor: (from: string, to: string) => AssetPerformance | undefined;
  /** The date of the asset's first book row (the start of its recorded history). */ firstDate: string;
  book?: ReturnType<typeof attributeBook>;
  /** Allocated debt at a date for the chart; null where it cannot be plotted. */ debtAt: (date: string) => number | null;
  /** Schedule months not yet posted, for the dashed projection. */ unposted: { postDate: string; amountMinor: number }[];
  operating: OperatingEntry[]; capital: CapitalMovement[]; financing: FinancingEvent[];
  capitalization: CapitalizationIssue[]; onMatchCapitalization: (issue: CapitalizationIssue, companionId: string) => Promise<void>;
  /** Schedule months that are due or whose Actual row is missing. */ depreciationDue: number;
  /** Opens the wizard that records how the asset was obtained. */ onRecordOrigin: () => void;
  onBook: (view?: BookView) => void; onTab: (tab: string) => void;
  onFocusBook: (focus: BookFocus) => void; onFocusCashflow: (focus: CashflowFocus) => void;
};
/** Attention items already shown elsewhere on this page (unclassified: chart; unassigned and capitalization: their own buttons). */
const SHOWN_ELSEWHERE = new Set(["Unclassified account transactions", "Unassigned account transactions require review", "Capitalization needs review"]);
const AMBER = "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50";
/** Why a ratio cannot be shown, in plain words: the first thing that blocks it. */
function returnBlocker(performance?: AssetPerformance): string {
  const gap = performance?.gaps[0];
  if (!performance) return "Needs the asset's book values";
  if (!gap) return "Needs a positive starting value or capital";
  if (gap === "Unclassified account transactions") return "Needs unclassified transactions classified";
  if (gap === "Capitalization needs review") return "Needs the capitalization reviewed";
  return `Needs attention: ${gap.charAt(0).toLowerCase()}${gap.slice(1)}`;
}
const signed = (minor: number) => `${minor > 0 ? "+" : ""}${assetMoney(minor)}`;
type Column = { key: string; label: string; sub?: string; from: string; to: string };

function Row({ label, values, strong, indent }: { label: string; values: ReactNode[]; strong?: boolean; indent?: boolean }) {
  return <tr className="border-t border-border/50"><th scope="row" className={strong ? "px-4 py-2 text-left text-sm font-semibold" : `px-4 py-2 text-left font-normal text-muted-foreground ${indent ? "pl-7" : ""}`}>{label}</th>{values.map((v, i) => <td key={i} className={strong ? "px-3 py-2 text-right text-sm font-semibold" : "px-3 py-2 text-right"}>{v}</td>)}</tr>;
}
export function AssetOverview({ asset, date, valueMinor, reading, reportFor, firstDate, book, debtAt, unposted, operating, capital, financing, capitalization, onMatchCapitalization, depreciationDue, onRecordOrigin, onBook, onTab, onFocusBook, onFocusCashflow }: Props) {
  const own = book?.rows.filter((r) => r.assetId === asset.id) ?? [];
  const available = valueMinor !== null;
  const unassignedRows = book?.rows.filter((r) => !r.assetId).length ?? 0;
  const unclassified = own.filter((r) => bookTypeLabel(r.classification) === "Unclassified").length;
  const figure = (value: string) => reading ? "…" : value;
  const income = asset.incomeGenerating;
  const hasCashflows = operating.length > 0 || capital.length > 0;
  const showOperating = income || operating.length > 0;
  const [reviewing, setReviewing] = useState(false);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState({ from: firstDate, to: date });
  const [pickerOpen, setPickerOpen] = useState(false);
  const draftValid = isIsoDate(draft.from) && isIsoDate(draft.to) && draft.from <= draft.to && draft.to <= date;

  // The whole life of the asset: how its value came to be what it is.
  const life = valueBridge(own, null, date);
  const lifePerformance = reportFor(firstDate, date);
  const otherMinor = life.disposalMinor + life.otherMinor;
  // The yearly table shows the latest years that have data, at most five.
  const year = Number(date.slice(0, 4));
  const dataYears = [...operating.map((e) => e.date), ...capital.map((m) => m.date)].map((d) => Number(d.slice(0, 4)));
  const yearly = cashflowByYear(operating, capital, year, Math.min(5, year - Math.min(year, ...dataYears) + 1));
  const span = `${yearly.years[0]}–${yearly.years[yearly.years.length - 1]}`;

  const columns: Column[] = [
    { key: "year", label: "This year", from: `${year}-01-01`, to: date }, { key: "last", label: "Last year", from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
    { key: "history", label: "Recorded history", from: firstDate, to: date },
    ...(custom ? [{ key: "custom", label: "Custom", sub: `${shortDate(custom.from, date)} – ${shortDate(custom.to, date)}`, ...custom }] : []),
  ];
  const results = columns.map((c) => ({ column: c, perf: reportFor(c.from, c.to), bridge: valueBridge(own, c.from, c.to) }));
  const money = (pick: (p: AssetPerformance) => number | null) => results.map((r) => figure(r.perf ? assetMoney(pick(r.perf)) : NA));
  const pct = (pick: (p: AssetPerformance) => number | null) => results.map((r) => figure(r.perf ? percent(pick(r.perf)) : NA));
  const bridge = (pick: (b: ReturnType<typeof valueBridge>) => number) => results.map((r) => assetMoney(pick(r.bridge)));
  const hasOther = results.some((r) => r.bridge.disposalMinor + r.bridge.otherMinor !== 0);

  const gaps = [...new Set([...results.flatMap((r) => r.perf?.gaps ?? []), ...(book?.issues ?? [])])].filter((gap) => !SHOWN_ELSEWHERE.has(gap));
  const attention: { text: string; onClick?: () => void }[] = [
    ...(available && asset.status === "active" && life.capitalMinor === 0 ? [{ text: "Record how you got it", onClick: onRecordOrigin }] : []),
    ...(capitalization.length > 0 ? [{ text: capitalization.length === 1 ? "1 capitalization needs review" : `${capitalization.length} capitalizations need review`, onClick: () => setReviewing(true) }] : []),
    ...(depreciationDue > 0 ? [{ text: `${depreciationDue} depreciation ${depreciationDue === 1 ? "month" : "months"} due`, onClick: () => onTab("Depreciation Schedule") }] : []),
    ...(unassignedRows > 0 ? [{ text: `Review ${unassignedRows} unassigned ${unassignedRows === 1 ? "row" : "rows"}`, onClick: () => onBook("unassigned") }] : []),
    ...gaps.map((text) => ({ text })),
  ];
  return <div className="min-h-0 flex-1 overflow-auto">
    <SummaryStrip label="Asset financial summary" items={[
      { label: "Recorded value", value: assetMoney(valueMinor), detail: `Recorded since ${shortDate(firstDate, date)}` },
      { label: "Capital added", value: available ? signed(life.capitalMinor) : NA, detail: "Opening balance, acquisitions and CapEx" },
      { label: "Valuation adjustments", value: available ? signed(life.revaluationMinor + life.depreciationMinor) : NA, detail: available ? `Revaluation ${signed(life.revaluationMinor)} · Depreciation ${signed(life.depreciationMinor)}` : "Needs the account's values" },
      ...(available && otherMinor !== 0 ? [{ label: "Disposals & other", value: signed(otherMinor), detail: "Disposals, other adjustments and unclassified rows" }] : []),
      ...(showOperating ? [{ label: "Operating Result", value: figure(assetMoney(lifePerformance?.operatingMinor)), detail: "Linked income − costs · all time" }] : []),
      { label: "Simple Total Return", value: figure(percent(lifePerformance?.simpleReturn)), detail: reading ? "Reading linked accounts…" : lifePerformance?.simpleReturn == null ? returnBlocker(lifePerformance) : showOperating ? `Operating yield ${percent(lifePerformance?.operatingYield)} · all time` : "All time · non-annualized" },
    ]} />
    {attention.length > 0 && <div role="status" aria-label="Needs attention" className="flex flex-wrap items-center gap-2 border-b bg-amber-50/60 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden /><span className="font-medium">Needs attention</span>
      {attention.map((item) => item.onClick ? <Button key={item.text} size="xs" variant="outline" className={AMBER} onClick={item.onClick}>{item.text}<ArrowRight className="size-3" aria-hidden /></Button> : <span key={item.text} className="rounded border border-amber-300/70 px-1.5 py-0.5 dark:border-amber-800">{item.text}</span>)}
    </div>}
    {reviewing && <CapitalizationReview issues={capitalization} today={date} onMatch={onMatchCapitalization} onOpenCashflows={() => { setReviewing(false); onTab("Income & Expenses"); }} onClose={() => setReviewing(false)} />}
    <div className="grid gap-4 p-4">
      <TimelineSection today={date} valueMinor={valueMinor} rows={own.map((r) => ({ date: r.date, classification: r.classification, amountMinor: r.amountMinor, runningMinor: r.runningMinor }))}
        debtAt={debtAt} unposted={unposted} operating={operating} capital={capital} financing={financing} onFinancing={() => onTab("Linked Loans")} showCashflow={income || hasCashflows} reading={reading} onBook={onFocusBook} onCashflow={onFocusCashflow}
        notice={unclassified > 0
          ? <Button size="xs" variant="outline" className={AMBER} onClick={() => onBook("unclassified")}>{unclassified} unclassified {unclassified === 1 ? "transaction" : "transactions"}<ArrowRight className="size-3" aria-hidden /></Button>
          : available ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5" aria-hidden />All transactions have a type</span> : null} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {(hasCashflows || income) && <section aria-label="Income and expenses by year" className="min-w-0 rounded-lg border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5"><div className="flex items-center gap-1.5"><h2 className="text-sm font-semibold">Income &amp; expenses by year</h2><span className="text-xs text-muted-foreground">{span}</span><InfoHint label="income and expenses by year">Linked transactions from your other accounts, {yearly.years.length === 5 ? `for the latest five years (${span})` : `for ${span}`}, with a Total of the years shown. Capital is listed apart and is not part of the operating result.</InfoHint></div>
            <Button size="xs" variant="outline" onClick={() => onTab("Income & Expenses")}>Income &amp; Expenses<ArrowRight className="size-3" aria-hidden /></Button></div>
          {yearly.groups.length === 0 ? <p className="p-4 text-xs text-muted-foreground">Nothing is linked yet. Link existing transactions, or save a link rule, in Income &amp; Expenses.</p> :
            <table className="w-full table-fixed border-collapse text-xs tabular-nums">
              <thead><tr className="text-muted-foreground"><th scope="col" className="w-[30%] px-4 py-1.5 text-left font-medium">Category</th>{yearly.years.map((y) => <th key={y} scope="col" className="px-2 py-1.5 text-right font-medium">{y}</th>)}<th scope="col" className="px-4 py-1.5 text-right font-medium">Total</th></tr></thead>
              <tbody>{yearly.groups.map((g) => <Fragment key={g.label}>
                <tr key={g.label} className="border-t bg-muted/30 font-medium"><th scope="row" className="px-4 py-1.5 text-left">{g.label}</th>{g.byYear.map((v, i) => <td key={i} className="px-2 py-1.5 text-right">{assetMoney(v)}</td>)}<td className="px-4 py-1.5 text-right">{assetMoney(g.total)}</td></tr>
                {g.rows.map((r) => <tr key={r.key} className="border-t border-border/50"><th scope="row" className="truncate px-4 py-1.5 pl-7 text-left font-normal text-muted-foreground" title={r.label}>{r.label}</th>{r.byYear.map((v, i) => <td key={i} className="px-2 py-1.5 text-right">{v === 0 ? NA : assetMoney(v)}</td>)}<td className="px-4 py-1.5 text-right">{assetMoney(r.total)}</td></tr>)}
              </Fragment>)}
                <tr className="border-t-2 font-semibold"><th scope="row" className="px-4 py-2 text-left">Operating result</th>{yearly.operating.map((v, i) => <td key={i} className="px-2 py-2 text-right">{assetMoney(v)}</td>)}<td className="px-4 py-2 text-right">{assetMoney(yearly.operatingTotal)}</td></tr>
              </tbody></table>}
        </section>}
        <section aria-label="Performance breakdown" className={`min-w-0 rounded-lg border bg-background ${hasCashflows || income ? "" : "xl:col-span-2"}`}>
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5"><div className="flex items-center gap-1"><h2 className="text-sm font-semibold">Performance breakdown</h2><InfoHint label="how results are calculated">Opening + Capital added + Revaluation + Depreciation &amp; write-downs + Disposals &amp; other = Closing, summed from the classified account transactions. Total = Close − Open − Capital Added + Net Proceeds{showOperating ? " + Operating Result" : ""}, from linked transactions. Yield and Simple Total Return divide by Open + Capital Added, are non-annualized and non-time-weighted, and show N/A unless that base is positive.</InfoHint></div>
            <div className="flex items-center gap-1.5"><Button size="xs" variant="outline" onClick={() => onBook()}>Account Transactions<ArrowRight className="size-3" aria-hidden /></Button>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}><PopoverTrigger render={<Button size="xs" variant="outline">Custom period</Button>} />
              <PopoverContent align="end" className="w-72 p-3"><div className="grid gap-2 text-xs"><label className="grid gap-1">From<DateInput size="sm" aria-label="Custom period from" value={draft.from} onValueChange={(from) => setDraft((d) => ({ ...d, from }))} /></label>
                <label className="grid gap-1">To<DateInput size="sm" aria-label="Custom period to" value={draft.to} onValueChange={(to) => setDraft((d) => ({ ...d, to }))} /></label>
                {!draftValid && <p role="alert" className="text-destructive">Choose a period ending no later than today.</p>}
                <Button size="sm" disabled={!draftValid} onClick={() => { setCustom(draft); setPickerOpen(false); }}>Show this period</Button></div></PopoverContent></Popover></div></div>
          <table className="w-full table-fixed border-collapse text-xs tabular-nums">
            <thead><tr className="text-muted-foreground"><th scope="col" className="w-[30%] px-4 py-1.5 text-left font-medium">&nbsp;</th>{columns.map((c) => <th key={c.key} scope="col" className="px-3 py-1.5 text-right font-medium">
              {c.label}{c.key === "custom" && <button type="button" aria-label="Remove custom period" className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground" onClick={() => setCustom(null)}><X className="size-3" aria-hidden /></button>}{c.sub && <div className="text-[10px] font-normal">{c.sub}</div>}</th>)}</tr></thead>
            <tbody>
              <Row label="Opening recorded value" values={money((p) => p.openingMinor)} />
              <Row indent label="Capital added" values={money((p) => p.capitalAddedMinor)} />
              <Row indent label="Revaluation (net)" values={bridge((b) => b.revaluationMinor)} />
              <Row indent label="Depreciation & write-downs" values={bridge((b) => b.depreciationMinor)} />
              {hasOther && <Row indent label="Disposals & other" values={bridge((b) => b.disposalMinor + b.otherMinor)} />}
              <Row label="Closing recorded value" values={money((p) => p.closingMinor)} />
              <Row label="Net proceeds withdrawn" values={money((p) => p.netProceedsMinor)} />
              {showOperating && <Row label="Operating result" values={money((p) => p.operatingMinor)} />}
              <Row strong label="Total result" values={money((p) => p.totalMinor)} />
              {showOperating && <Row label="Operating yield" values={pct((p) => p.operatingYield)} />}
              <Row label="Simple total return" values={pct((p) => p.simpleReturn)} />
            </tbody></table>
        </section>
      </div>
    </div>
  </div>;
}
