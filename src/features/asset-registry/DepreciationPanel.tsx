"use client";
import { useState } from "react";
import { ArrowUpRight, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { DataTable, Text, type Column } from "@/features/credit-cards/components/primitives/DataTable";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { UncertainAssetWrite, type ActionContext } from "@/lib/asset-registry/actions";
import { depreciationSchedule, forecastMonths, periodStatuses, type PeriodState, type PeriodStatus } from "@/lib/asset-registry/depreciation";
import { typeFromNotes } from "@/lib/asset-registry/tags";
import { DEPRECIATION_TAG, depreciationEvidence, depreciationMetadata, executeDepreciation, prepareDepreciation, type DepreciationPrepared } from "@/lib/asset-registry/depreciationActions";
import type { Asset, Registry } from "@/lib/asset-registry/models";
import type { BookSnapshot } from "@/lib/asset-registry/ledger";
import { AttentionBadge, NA, SummaryStrip, assetMoney, type AssetAttention } from "./AssetPresentation";
import { yearsBetween } from "@/lib/asset-registry/yields";
import { registryRequest } from "./api";

const BADGES: Record<PeriodState, AssetAttention> = {
  forecast: { label: "Forecast", tone: "neutral" }, due: { label: "Due", tone: "attention" }, posted: { label: "Posted", tone: "success" },
  complete: { label: "Complete", tone: "neutral" },
};
const monthLabel = (period: string) => new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
type Outcome = { status: "posted" | "failed" | "metadata"; message: string };
export function DepreciationPanel({ asset, registry, snapshot, valueMinor, today, fresh, onSaved, onEdit, onOpenBook, financialBlocked, onUncertain }: {
  asset: Asset; registry: Registry; snapshot: BookSnapshot; valueMinor: number | null; today: string; fresh: (date: string) => Promise<ActionContext>;
  onSaved: (registry?: Registry) => Promise<void>; onEdit: () => void; onOpenBook: () => void; financialBlocked: boolean; onUncertain: () => void;
}) {
  const settings = registry.depreciation?.find((s) => s.assetId === asset.id);
  const [selected, setSelected] = useState<string[]>([]); const [review, setReview] = useState<DepreciationPrepared[] | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ prepared: DepreciationPrepared; result: { transactionId: string | null; deleted: boolean; noop: boolean } } | null>(null);
  const actual = new Map(snapshot.source.map((r) => [r.id, r]));
  const rows = settings ? periodStatuses(depreciationSchedule(settings, forecastMonths(settings, today)), registry.metadata, asset.id, new Set(actual.keys()), today) : [];
  const posted = rows.filter((r) => r.state === "posted").length;
  /** What the posted months took off the account, as Actual holds it (negative), and the next month still to post. */
  const postedMinor = rows.filter((r) => r.state === "posted").reduce((sum, r) => sum + (actual.get(r.association!.actualTransactionId)?.amount ?? 0), 0);
  const next = rows.find((r) => r.amountMinor > 0 && (r.state === "due" || r.state === "forecast"));
  /** The month the schedule reaches its residual value, looking past the forecast window the table shows. */
  const finalRow = settings ? depreciationSchedule(settings, settings.method === "straight-line" ? settings.lifeMonths ?? 0 : 600).find((r) => r.closingMinor <= settings.residualMinor) : undefined;
  /** Book rows tagged as depreciation that no schedule month claims (manual entries, older postings). */
  const linkedIds = new Set(registry.metadata.filter((m) => m.depreciationPeriod).map((m) => m.actualTransactionId));
  const otherTagged = snapshot.source.filter((r) => typeFromNotes(r.notes) === "depreciation" && !linkedIds.has(r.id)).length;
  const selectable = (r: PeriodStatus) => r.state === "due" && asset.status === "active" && !financialBlocked && !retry;
  async function preview() {
    setBusy(true); setError("");
    try {
      const plans: DepreciationPrepared[] = [];
      for (const period of [...selected].sort()) { const row = rows.find((r) => r.period === period)!; plans.push(prepareDepreciation(await fresh(row.postDate), period, today)); }
      setReview(plans);
    } catch (e) { setError(e instanceof Error ? e.message : "Preview failed"); }
    finally { setBusy(false); }
  }
  /** Sequential, one Actual write per month, each at its own month end. Stops at the first failure and reports every month. */
  async function post() {
    if (!review || busy) return;
    setBusy(true); setError("");
    const next: Record<string, Outcome> = {};
    let stopped = false;
    for (const plan of review) {
      if (stopped) { next[plan.period] = { status: "failed", message: "Not attempted" }; continue; }
      let result;
      try {
        const context = await fresh(plan.date);
        const prepared = prepareDepreciation(context, plan.period, today);
        result = await executeDepreciation(prepared, () => fresh(plan.date));
        try { await saveMetadata(prepared, result, await fresh(plan.date)); next[plan.period] = { status: "posted", message: `Posted ${shortDate(plan.date, today)}` }; }
        catch (e) { setRetry({ prepared, result }); next[plan.period] = { status: "metadata", message: e instanceof Error ? e.message : "Metadata save failed" }; stopped = true; }
      } catch (e) {
        if (e instanceof UncertainAssetWrite) onUncertain();
        next[plan.period] = { status: "failed", message: e instanceof Error ? e.message : "Posting failed" }; stopped = true;
      }
    }
    setOutcomes((old) => ({ ...old, ...next })); setReview(null); setSelected([]); setBusy(false);
    await onSaved();
  }
  const saveMetadata = async (prepared: DepreciationPrepared, result: { transactionId: string | null; deleted: boolean; noop: boolean }, context: ActionContext) => {
    await registryRequest(asset.budgetSyncId, "PUT", { changes: depreciationMetadata(prepared, result, context), sources: depreciationEvidence(context) });
  };
  async function retryMetadata() {
    if (!retry || busy) return;
    setBusy(true); setError("");
    try { await saveMetadata(retry.prepared, retry.result, await fresh(retry.prepared.date)); setOutcomes((o) => ({ ...o, [retry.prepared.period]: { status: "posted", message: `Posted ${shortDate(retry.prepared.date, today)}` } })); setRetry(null); await onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Metadata retry failed"); }
    finally { setBusy(false); }
  }
  const columns: Column<PeriodStatus>[] = [
    { key: "select", header: "Select", width: 34, headerIcon: <span className="sr-only">Select</span>, cell: (r) => <Checkbox aria-label={`Select depreciation ${r.period}`} disabled={!selectable(r) || busy} checked={selected.includes(r.period)} onCheckedChange={(v) => setSelected((ids) => v ? [...ids, r.period] : ids.filter((id) => id !== r.period))} /> },
    { key: "period", header: "Period", width: 100, cell: (r) => <Text title={r.period}>{monthLabel(r.period)}</Text> },
    { key: "date", header: "Posting date", width: 120, cell: (r) => <Text title={r.postDate}>{shortDate(r.postDate, today)}</Text> },
    { key: "amount", header: "Forecast decrease", width: 135, align: "right", cell: (r) => assetMoney(r.amountMinor) },
    { key: "closing", header: "Forecast carrying value", width: 160, align: "right", cell: (r) => assetMoney(r.closingMinor) },
    { key: "state", header: "State", width: 160, cell: (r) => <AttentionBadge status={BADGES[r.state]} /> },
    { key: "posted", header: "Actual posted amount", width: 150, align: "right", cell: (r) => r.state === "posted" ? assetMoney(actual.get(r.association!.actualTransactionId)?.amount) : "-" },
    { key: "result", header: "Last action", width: 220, grow: true, cell: (r) => <Text>{outcomes[r.period]?.message ?? "-"}</Text> },
  ];
  if (!settings) return <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Depreciation</h2><p className="text-xs text-muted-foreground">Optional monthly forecast · no automatic posting or rebasing</p></div><Button className="ml-auto" size="sm" disabled={asset.status !== "active"} onClick={onEdit}><Settings2 className="size-3.5" aria-hidden />Set up schedule</Button></div>
    <p className="p-4 text-sm text-muted-foreground">No schedule is saved. A schedule is a planning forecast; you post each ended month explicitly. Manual depreciation entries remain available in Asset Ledger.</p></div>;
  return <div className="flex min-h-0 flex-1 flex-col">
    <SummaryStrip label="Depreciation summary" items={[
      { label: "Recorded value", value: assetMoney(valueMinor), detail: `Schedule basis ${assetMoney(settings.basisMinor)}`, wrap: true },
      { label: "Depreciation posted", value: assetMoney(postedMinor), detail: `${posted} of ${rows.filter((r) => r.amountMinor > 0).length} months in the forecast`, wrap: true },
      { label: "Remaining to depreciate", value: valueMinor === null ? NA : assetMoney(Math.max(0, valueMinor - settings.residualMinor)), detail: `Down to the residual value ${assetMoney(settings.residualMinor)}`, wrap: true },
      { label: "Next monthly charge", value: next ? assetMoney(next.amountMinor) : NA, detail: next ? `${monthLabel(next.period)} · ${next.state === "due" ? "due now" : "forecast"}` : "Nothing left to post", wrap: true },
      { label: "Fully depreciated by", value: finalRow ? shortDate(finalRow.postDate, today) : NA, detail: finalRow ? (finalRow.postDate <= today ? "Reached the residual value" : `${yearsBetween(today, finalRow.postDate).toFixed(1)} years from now · ${settings.method === "straight-line" ? "straight-line" : `declining ${(settings.annualRateBps ?? 0) / 100}% a year`}`) : "Not within 50 years", wrap: true },
    ]} />
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
      <h2 className="text-sm font-semibold">Schedule</h2>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">Starts {shortDate(settings.startDate, today)} · {posted} of {rows.filter((r) => r.amountMinor > 0).length} months posted{otherTagged > 0 && ` · ${otherTagged} other ${DEPRECIATION_TAG} ${otherTagged === 1 ? "row" : "rows"} in the book`}<InfoHint label="depreciation schedules">Methods are personal planning conventions, not tax depreciation. The first calendar month is a full period. A month is due once its end date has arrived and posts at that date as a negative noncash row in the asset account tagged {DEPRECIATION_TAG}; nothing posts automatically. Revaluation never changes this schedule. Edit or delete posted rows in Asset Ledger.</InfoHint></p>
      <div className="ml-auto flex items-center gap-2">
        <Button size="xs" variant="ghost" onClick={onOpenBook}>Asset Ledger<ArrowUpRight className="size-3" aria-hidden /></Button>
        <Button size="sm" variant="outline" disabled={asset.status !== "active"} onClick={onEdit}><Settings2 className="size-3.5" aria-hidden />Edit schedule</Button>
        <Button size="sm" disabled={!selected.length || busy || financialBlocked || !!retry} onClick={() => void preview()}>{busy && !review ? "Working…" : `Post selected (${selected.length})`}</Button>
      </div>
    </div>
    {retry && <div role="alert" className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-destructive">Actual accepted {retry.prepared.period}, but its month association is not saved. Retrying saves only the association and does not write Actual again.<Button size="xs" variant="outline" disabled={busy} onClick={() => void retryMetadata()}>Retry association only</Button></div>}
    {error && <p role="alert" className="border-b p-3 text-sm text-destructive">{error}</p>}
    <DataTable label="Depreciation schedule" rows={rows} columns={columns} rowKey={(r) => r.period} rowLabel={(r) => `Depreciation ${r.period}`} dense={32} empty="No schedule periods." />
    {review && <Dialog open onOpenChange={(open) => { if (!open && !busy) setReview(null); }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Post {review.length} depreciation {review.length === 1 ? "month" : "months"}</DialogTitle><DialogDescription>One negative noncash row in the asset account per month, each dated at its own period end. Existing cash movements are not touched.</DialogDescription></DialogHeader>
      <ul aria-label="Depreciation postings" className="divide-y rounded-md border text-sm">{review.map((p) => <li key={p.period} className="flex items-center justify-between gap-3 px-3 py-2"><span>{monthLabel(p.period)} · {shortDate(p.date, today)}{p.replaces ? " · replaces missing row" : ""}</span><span className="tabular-nums">{assetMoney(p.amountMinor)}</span></li>)}</ul>
      <p className="text-sm">Total <span className="font-medium tabular-nums">{assetMoney(review.reduce((s, p) => s + p.amountMinor, 0))}</span>. Months post one at a time and stop at the first failure.</p>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button disabled={busy} onClick={() => void post()}>{busy ? "Posting…" : "Confirm Actual write"}</Button></DialogFooter></DialogContent></Dialog>}
  </div>;
}
