"use client";

import { ChevronDown, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { EventSavings } from "../../lib/useEventSavings";
import { formatSaving } from "../../lib/eventSavings";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatAmount, fractionToPercent } from "../../lib/money";
import { deltas, type Headline } from "../../lib/results";
import type { SimAssumption, SimAssumptionKind, SimRate, SimulationState } from "../../lib/simulatorModel";
import { assumptionDetails, KIND_LABEL, listedExtraTransactions, type ExtraEditor } from "./ExtraTransactionsDialog";
import { HelpDialogButton } from "./ConfigurationSection";
import { formatChartDate } from "../chart/chartMeta";
import { LoanMenuContent } from "../loan/presentation";

const DIRECT_KINDS: SimAssumptionKind[] = ["extra-repayment", "draw"];
const MORE_KINDS: SimAssumptionKind[] = ["fee", "payment-change"];
const ALL_KINDS: SimAssumptionKind[] = [...DIRECT_KINDS, ...MORE_KINDS];

function duration(days: number): string {
  const totalMonths = Math.max(0, Math.round(Math.abs(days) / 30.4375));
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (!years) return months === 1 ? "1 month" : `${months} months`;
  return `${years} ${years === 1 ? "year" : "years"}${months ? ` ${months} ${months === 1 ? "month" : "months"}` : ""}`;
}

export function extraImpact(current: Headline | null, baseline: Headline | null, digits: number): string {
  return impactMetrics(current, baseline, digits).map((metric) => metric.sentence).join(" · ");
}

type ImpactMetric = { label: string; value: string; sentence: string };

function impactMetrics(current: Headline | null, baseline: Headline | null, digits: number): [ImpactMetric, ImpactMetric] {
  if (!current || !baseline) return [
    { label: "Interest impact", value: "Calculating…", sentence: "Interest impact calculating…" },
    { label: "Payoff time impact", value: "Calculating…", sentence: "Payoff impact calculating…" },
  ];
  const difference = deltas(current, baseline);
  const interest: ImpactMetric = difference.interestMinor < 0
    ? { label: "Interest saved", value: formatAmount(Math.abs(difference.interestMinor), digits), sentence: `Interest saved ${formatAmount(Math.abs(difference.interestMinor), digits)}` }
    : difference.interestMinor > 0
      ? { label: "Interest added", value: formatAmount(difference.interestMinor, digits), sentence: `Interest added ${formatAmount(difference.interestMinor, digits)}` }
      : { label: "Interest unchanged", value: "No change", sentence: "No interest change" };
  let time: ImpactMetric;
  if (current.payoffDate === null && baseline.payoffDate !== null) time = { label: "Payoff outcome", value: "Not reached with events", sentence: "Payoff not reached with transactions" };
  else if (current.payoffDate !== null && baseline.payoffDate === null) time = { label: "Payoff outcome", value: "Reached with events", sentence: "Payoff reached with transactions" };
  else if (difference.payoffDays === null || difference.payoffDays === 0) time = { label: "Payoff time unchanged", value: "No change", sentence: "No payoff-time change" };
  else if (difference.payoffDays < 0) time = { label: "Payoff time saved", value: duration(difference.payoffDays), sentence: `Payoff time saved ${duration(difference.payoffDays)}` };
  else time = { label: "Payoff time added", value: duration(difference.payoffDays), sentence: `Payoff time added ${duration(difference.payoffDays)}` };
  return [interest, time];
}

/** Saved is good (green), added is bad (red), no change or still calculating is neutral; the words always say it too. */
const toneOf = (label: string): "good" | "bad" | "neutral" => (/saved|Reached/.test(label) ? "good" : /added|Not reached/.test(label) ? "bad" : "neutral");
const IMPACT_TONE = {
  good: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  bad: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  neutral: "bg-muted text-muted-foreground",
} as const;

/** The Loan Ledger's events on a loan tracked in Actual: what happened, read-only here (design spec 06 §5.7). */
export type LedgerEventRow = { date: string; kind: "extra-principal" | "draw" | "fee" | "interest-charged" | "adjustment"; amountMinor: number; rowId: string; payee: string | null; notes: string | null };

export type TrackedEvents = {
  startDate: string;
  today: string;
  ledgerEvents: readonly LedgerEventRow[];
  /** What happened, against the contract without it; the switched-on what-ifs, against the history plus the contract. */
  fromActual: [Headline | null, Headline | null];
  whatIfs: [Headline | null, Headline | null];
  onToggle: (assumption: SimAssumption) => void;
  onOpenLedger: () => void;
};

const LEDGER_LABEL: Record<LedgerEventRow["kind"], string> = { "extra-principal": "Extra payment", draw: "Redraw / Withdraw", fee: "Fee", "interest-charged": "Interest charged", adjustment: "Adjustment" };

type EventRow =
  | { key: string; date: string; kind: "assumption"; assumption: SimAssumption }
  | { key: string; date: string; kind: "rate-change"; rate: SimRate; previousRate: string | null }
  | { key: string; date: string; kind: "ledger"; ledger: LedgerEventRow };

function eventRows(sim: SimulationState, tracked?: TrackedEvents): EventRow[] {
  const transactions = listedExtraTransactions(sim);
  const rates = [...sim.rates].sort((a, b) => a.accrualEffectiveFrom.localeCompare(b.accrualEffectiveFrom));
  return [
    ...transactions.map((assumption): EventRow => ({ key: `assumption:${assumption.key}`, date: assumption.effectiveFrom, kind: "assumption", assumption })),
    ...rates.slice(1).map((rate, index): EventRow => ({ key: `rate:${rate.key}`, date: rate.accrualEffectiveFrom, kind: "rate-change", rate, previousRate: rates[index]?.annualRateDecimal ?? null })),
    ...(tracked?.ledgerEvents ?? []).filter((l) => l.kind !== "adjustment").map((ledger): EventRow => ({ key: `ledger:${ledger.rowId}`, date: ledger.date, kind: "ledger", ledger })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "rate-change" ? -1 : b.kind === "rate-change" ? 1 : a.key.localeCompare(b.key)));
}

/** What one row saves, as its own cell: "…" while calculating, "–" for a row the projection leaves out. */
function SavesCell({ savings, eventKey, included, digits }: { savings?: EventSavings; eventKey: string; included: boolean; digits: number }) {
  if (!included || !savings || savings.status === "none") return <td className="px-3 py-2.5 text-right text-muted-foreground">-</td>;
  if (savings.status === "calculating") return <td className="px-3 py-2.5 text-right text-muted-foreground" aria-label="Calculating">…</td>;
  const saving = savings.byKey.get(eventKey);
  if (!saving) return <td className="px-3 py-2.5 text-right text-muted-foreground">-</td>;
  const tone = saving.interestMinor > 0 ? "text-emerald-700 dark:text-emerald-400" : saving.interestMinor < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground";
  return <td className={cn("whitespace-nowrap px-3 py-2.5 text-right tabular-nums", tone)}>{formatSaving(saving, digits)}</td>;
}

/** Where a row of the Events list comes from on a tracked loan. */
function sourceOf(row: EventRow, tracked: TrackedEvents): "From Actual" | "What-if" | "Contract" | "Before tracking" | "Passed" {
  if (row.kind === "ledger") return "From Actual";
  if (row.kind === "rate-change") return "Contract";
  if (row.date < tracked.startDate) return "Before tracking";
  return row.date > tracked.today ? "What-if" : "Passed";
}

function rateDetails(rate: SimRate): string {
  const repayment = rate.paymentRecalcPolicy === "on-rate-change"
    ? "Recalculates the repayment"
    : rate.paymentRecalcPolicy === "never"
      ? "Keeps the repayment"
      : rate.paymentRecalcPolicy === "lender-provided"
        ? "Lender sets the repayment"
        : "Uses the loan's repayment recalculation rule";
  return [repayment, rate.paymentEffectiveFrom ? `Repayment changes ${rate.paymentEffectiveFrom}` : null, rate.source, rate.note].filter(Boolean).join(" · ");
}

export function EventsSection({ sim, current, baseline, savings, onEdit, onRemove, onEditRate, onRemoveRate, tracked }: { sim: SimulationState; current: Headline | null; baseline: Headline | null; /** What each event saves (date order). */ savings?: EventSavings; onEdit: (editor: ExtraEditor) => void; onRemove: (assumption: SimAssumption) => void; onEditRate: (editor: "new" | SimRate) => void; onRemoveRate: (rate: SimRate) => void; /** A loan tracked in Actual. */ tracked?: TrackedEvents }) {
  const transactions = listedExtraTransactions(sim);
  const rows = eventRows(sim, tracked);
  const hasImpactEvents = transactions.length > 0 || !!tracked?.ledgerEvents.some((l) => l.kind !== "adjustment");
  const [interestImpact, payoffImpact] = impactMetrics(current, baseline, sim.minorDigits);
  const groups: { label: string | null; metrics: [ImpactMetric, ImpactMetric] }[] = tracked
    ? [
        ...(tracked.ledgerEvents.some((l) => l.kind !== "adjustment") ? [{ label: "From Actual", metrics: impactMetrics(tracked.fromActual[0], tracked.fromActual[1], sim.minorDigits) }] : []),
        ...(transactions.some((a) => a.effectiveFrom > tracked.today && a.enabled !== false) ? [{ label: "What-ifs", metrics: impactMetrics(tracked.whatIfs[0], tracked.whatIfs[1], sim.minorDigits) }] : []),
      ]
    : [{ label: null, metrics: [interestImpact, payoffImpact] }];
  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-2 pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4">
        <h2 id="events-heading" className="text-sm font-semibold">Events</h2>
        <p className="text-xs text-muted-foreground">Additional payments, deposits, withdrawals, fees, rates, loan, and offset changes.</p>
        <HelpDialogButton
          title="Event impact comparison"
          description="How the two impact results are calculated."
          groups={[{ items: [
            { term: "Comparison loan", description: "The same loan configuration without optional payment, offset-balance and fee events." },
            { term: "Rate changes", description: "Contractual rate changes remain in both the current loan and comparison loan, so they are not presented as savings caused by an optional event." },
            { term: "Interest", description: "The change in total interest between the current projection and the comparison loan." },
            { term: "Payoff time", description: "The change in projected payoff date. No change is stated explicitly rather than shown as a negative saving." },
          ] }]}
        />
        <div role="group" className="ml-auto flex shrink-0 items-center gap-2" aria-label="Add an event">
          <div className="hidden items-center gap-2 md:flex">
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit("extra-repayment")}><Plus aria-hidden="true" />Extra payment</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit("draw")}>Redraw / Withdraw</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onEditRate("new")}>Rate change</Button>
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}>More <ChevronDown aria-hidden="true" /></DropdownMenuTrigger>
              <LoanMenuContent>
                {MORE_KINDS.map((kind) => <DropdownMenuItem key={kind} onClick={() => onEdit(kind)}>{KIND_LABEL[kind]}</DropdownMenuItem>)}
              </LoanMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1 md:hidden")}><Plus aria-hidden="true" />Add event <ChevronDown aria-hidden="true" /></DropdownMenuTrigger>
            <LoanMenuContent>
              {ALL_KINDS.map((kind) => <DropdownMenuItem key={kind} onClick={() => onEdit(kind)}>{KIND_LABEL[kind]}</DropdownMenuItem>)}
              <DropdownMenuItem onClick={() => onEditRate("new")}>Rate change</DropdownMenuItem>
            </LoanMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="border-t border-border">
        {hasImpactEvents && groups.length ? (
          <div role="status" data-testid="events-impact" className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3", rows.length && "border-b border-border")}>
            {groups.map((group) => (
              <span key={group.label ?? "impact"} className="inline-flex flex-wrap items-center gap-2">
                {group.label ? <span className="text-xs font-semibold">{group.label}</span> : null}
                {group.metrics.map((m) => (
                  <span key={m.label} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs", IMPACT_TONE[toneOf(m.label)])}>
                    <span>{m.label}</span>
                    <span className="font-semibold tabular-nums">{m.value}</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        ) : null}
        {!rows.length && !hasImpactEvents ? <p className="px-4 py-3 text-xs text-muted-foreground">No extra payments, redraws or rate changes yet.</p> : null}

        {rows.length ? (
          <div className="overflow-x-auto">
            <table aria-label="Events" className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {tracked ? <th className="w-14 px-4 py-2 text-center font-medium">On</th> : null}
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Event type</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium" title="Interest and time each event saves, in date order: each on top of the ones before it">Saves</th>
                  {tracked ? <th className="px-3 py-2 font-medium">Source</th> : null}
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const source = tracked ? sourceOf(row, tracked) : null;
                  const sourceCell = tracked ? <td className="px-3 py-2.5">{source === "From Actual" ? <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px]">From Actual</span> : <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{source === "Passed" ? "What-if" : source}</span>}</td> : null;
                  if (row.kind === "ledger") return (
                    <tr key={row.key} className="bg-muted/20">
                      {tracked ? <td className="px-4 py-2.5 text-center text-muted-foreground" title="From Actual: always included">-</td> : null}
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatChartDate(row.date)}</td>
                      <td className="px-3 py-2.5 font-medium">{LEDGER_LABEL[row.ledger.kind]}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatAmount(row.ledger.amountMinor, sim.minorDigits)}</td>
                      <SavesCell savings={savings} eventKey={`ledger:${row.ledger.rowId}`} included={row.ledger.kind === "extra-principal" || row.ledger.kind === "draw" || row.ledger.kind === "fee"} digits={sim.minorDigits} />
                      {sourceCell}
                      <td className="px-3 py-2.5 text-muted-foreground">{[row.ledger.payee, row.ledger.notes].filter(Boolean).join(" · ") || "In the Loan Ledger"}</td>
                      <td className="px-4 py-2.5"><div className="flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={tracked?.onOpenLedger}>Open in Loan Ledger</Button></div></td>
                    </tr>
                  );
                  if (row.kind === "assumption") {
                    const passed = source === "Passed";
                    const off = row.assumption.enabled === false;
                    return (
                    <tr key={row.key} className={cn((passed || off) && "text-muted-foreground")}>
                      {tracked ? <td className="px-4 py-2.5 text-center">{source === "What-if" ? <Switch aria-label={`Include ${KIND_LABEL[row.assumption.kind]} on ${row.date} in the projection`} checked={!off} onCheckedChange={() => tracked.onToggle(row.assumption)} /> : <span className="text-muted-foreground">-</span>}</td> : null}
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatChartDate(row.date)}</td>
                      <td className="px-3 py-2.5 font-medium">{KIND_LABEL[row.assumption.kind]}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatAmount(row.assumption.amountMinor, sim.minorDigits)}</td>
                      <SavesCell savings={savings} eventKey={row.assumption.key} included={!passed && !off && source !== "Before tracking"} digits={sim.minorDigits} />
                      {sourceCell}
                      <td className="px-3 py-2.5 text-muted-foreground">{passed ? "Passed, not in the projection: what happened is in the Loan Ledger" : off ? `Off: not in the projection · ${assumptionDetails(row.assumption)}` : assumptionDetails(row.assumption)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          {!passed ? <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(row.assumption)} aria-label={`Edit ${KIND_LABEL[row.assumption.kind]} on ${row.date}`}>Edit</Button> : null}
                          <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(row.assumption)} aria-label={`Remove ${KIND_LABEL[row.assumption.kind]} on ${row.date}`}>Remove</Button>
                        </div>
                      </td>
                    </tr>
                    );
                  }
                  return (
                    <tr key={row.key}>
                      {tracked ? <td className="px-4 py-2.5 text-center text-muted-foreground">-</td> : null}
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatChartDate(row.date)}</td>
                      <td className="px-3 py-2.5 font-medium">Rate change</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{fractionToPercent(row.previousRate)}% → {fractionToPercent(row.rate.annualRateDecimal)}%</td>
                      <SavesCell savings={savings} eventKey="" included={false} digits={sim.minorDigits} />
                      {sourceCell}
                      <td className="px-3 py-2.5 text-muted-foreground">{rateDetails(row.rate)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => onEditRate(row.rate)} aria-label={`Edit rate change on ${row.date}`}>Edit</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveRate(row.rate)} aria-label={`Remove rate change on ${row.date}`}>Remove</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
