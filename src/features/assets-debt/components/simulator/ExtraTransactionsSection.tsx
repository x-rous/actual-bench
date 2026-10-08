"use client";

import { ChevronDown, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatAmount, fractionToPercent } from "../../lib/money";
import { deltas, type Headline } from "../../lib/results";
import type { SimAssumption, SimAssumptionKind, SimRate, SimulationState } from "../../lib/simulatorModel";
import { assumptionDetails, KIND_LABEL, listedExtraTransactions, type ExtraEditor } from "./ExtraTransactionsDialog";
import { HelpDialogButton } from "./ConfigurationSection";
import { formatChartDate } from "../chart/chartMeta";

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

type EventRow =
  | { key: string; date: string; kind: "assumption"; assumption: SimAssumption }
  | { key: string; date: string; kind: "rate-change"; rate: SimRate; previousRate: string | null };

function eventRows(sim: SimulationState): EventRow[] {
  const transactions = listedExtraTransactions(sim);
  const rates = [...sim.rates].sort((a, b) => a.accrualEffectiveFrom.localeCompare(b.accrualEffectiveFrom));
  return [
    ...transactions.map((assumption): EventRow => ({ key: `assumption:${assumption.key}`, date: assumption.effectiveFrom, kind: "assumption", assumption })),
    ...rates.slice(1).map((rate, index): EventRow => ({ key: `rate:${rate.key}`, date: rate.accrualEffectiveFrom, kind: "rate-change", rate, previousRate: rates[index]?.annualRateDecimal ?? null })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "rate-change" ? -1 : b.kind === "rate-change" ? 1 : a.key.localeCompare(b.key)));
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

export function EventsSection({ sim, current, baseline, onEdit, onRemove, onEditRate, onRemoveRate }: { sim: SimulationState; current: Headline | null; baseline: Headline | null; onEdit: (editor: ExtraEditor) => void; onRemove: (assumption: SimAssumption) => void; onEditRate: (editor: "new" | SimRate) => void; onRemoveRate: (rate: SimRate) => void }) {
  const transactions = listedExtraTransactions(sim);
  const rows = eventRows(sim);
  const hasImpactEvents = transactions.length > 0;
  const [interestImpact, payoffImpact] = impactMetrics(current, baseline, sim.minorDigits);
  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
              <DropdownMenuContent align="end">
                {MORE_KINDS.map((kind) => <DropdownMenuItem key={kind} onClick={() => onEdit(kind)}>{KIND_LABEL[kind]}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1 md:hidden")}><Plus aria-hidden="true" />Add event <ChevronDown aria-hidden="true" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ALL_KINDS.map((kind) => <DropdownMenuItem key={kind} onClick={() => onEdit(kind)}>{KIND_LABEL[kind]}</DropdownMenuItem>)}
              <DropdownMenuItem onClick={() => onEditRate("new")}>Rate change</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card/40">
        {hasImpactEvents ? (
          <div role="status" data-testid="events-impact" className={cn("flex flex-wrap items-center gap-2 px-4 py-3", rows.length && "border-b border-border")}>
            {[interestImpact, payoffImpact].map((m) => (
              <span key={m.label} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs", IMPACT_TONE[toneOf(m.label)])}>
                <span>{m.label}</span>
                <span className="font-semibold tabular-nums">{m.value}</span>
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
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Event type</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => row.kind === "assumption" ? (
                    <tr key={row.key}>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatChartDate(row.date)}</td>
                      <td className="px-3 py-2.5 font-medium">{KIND_LABEL[row.assumption.kind]}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatAmount(row.assumption.amountMinor, sim.minorDigits)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{assumptionDetails(row.assumption)}{row.assumption.actualLinked ? <span className="block">Recorded from Actual · manage in Sync Repayments</span> : null}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="sm" disabled={row.assumption.actualLinked} onClick={() => onEdit(row.assumption)} aria-label={`Edit ${KIND_LABEL[row.assumption.kind]} on ${row.date}`}>Edit</Button>
                          <Button type="button" variant="ghost" size="sm" disabled={row.assumption.actualLinked} onClick={() => onRemove(row.assumption)} aria-label={`Remove ${KIND_LABEL[row.assumption.kind]} on ${row.date}`}>Remove</Button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.key}>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatChartDate(row.date)}</td>
                      <td className="px-3 py-2.5 font-medium">Rate change</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{fractionToPercent(row.previousRate)}% → {fractionToPercent(row.rate.annualRateDecimal)}%</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{rateDetails(row.rate)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => onEditRate(row.rate)} aria-label={`Edit rate change on ${row.date}`}>Edit</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveRate(row.rate)} aria-label={`Remove rate change on ${row.date}`}>Remove</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
