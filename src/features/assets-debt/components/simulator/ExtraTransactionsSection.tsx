"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount, fractionToPercent } from "../../lib/money";
import { deltas, type Headline } from "../../lib/results";
import type { SimAssumption, SimAssumptionKind, SimRate, SimulationState } from "../../lib/simulatorModel";
import { assumptionDetails, KIND_LABEL, listedExtraTransactions, type ExtraEditor } from "./ExtraTransactionsDialog";

const ADD_KINDS: SimAssumptionKind[] = ["extra-repayment", "draw", "fee", "payment-change", "offset-balance"];

function duration(days: number): string {
  const totalMonths = Math.max(0, Math.round(Math.abs(days) / 30.4375));
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (!years) return months === 1 ? "1 month" : `${months} months`;
  return `${years} ${years === 1 ? "year" : "years"}${months ? ` ${months} ${months === 1 ? "month" : "months"}` : ""}`;
}

export function extraImpact(current: Headline | null, baseline: Headline | null, digits: number): string {
  if (!current || !baseline) return "Impact calculating…";
  const difference = deltas(current, baseline);
  const interest = difference.interestMinor < 0
    ? `Interest saved ${formatAmount(Math.abs(difference.interestMinor), digits)}`
    : difference.interestMinor > 0
      ? `Interest added ${formatAmount(difference.interestMinor, digits)}`
      : "No interest change";
  let time: string | null;
  if (current.payoffDate === null && baseline.payoffDate !== null) time = "Payoff not reached with transactions";
  else if (current.payoffDate !== null && baseline.payoffDate === null) time = "Payoff reached with transactions";
  else if (difference.payoffDays === null) time = null;
  else if (difference.payoffDays < 0) time = `Time saved ${duration(difference.payoffDays)}`;
  else if (difference.payoffDays > 0) time = `Time added ${duration(difference.payoffDays)}`;
  else time = "No payoff-time change";
  return [interest, time].filter(Boolean).join(" · ");
}

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
  const addKinds = sim.offsets.length ? ADD_KINDS : ADD_KINDS.filter((kind) => kind !== "offset-balance");
  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-2">
      <h2 id="events-heading" className="text-sm font-semibold">Events</h2>
      <div className="rounded-lg border border-border bg-card/40">
        <div className={cn("flex flex-col gap-3 p-4 xl:flex-row xl:items-start xl:justify-between", rows.length && "border-b border-border")}>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Additional payments, deposits, withdrawals, fees and loan changes.</p>
            <p className={hasImpactEvents ? "mt-2 text-sm font-semibold tabular-nums" : "text-xs text-muted-foreground"} role="status" data-testid="events-impact">
              {hasImpactEvents ? extraImpact(current, baseline, sim.minorDigits) : rows.length ? "Contractual rate changes remain included in both sides of the interest and time comparison." : "Add an event to model changes over time."}
            </p>
            {hasImpactEvents ? <p className="text-[11px] text-muted-foreground">Compared with the same loan without optional payment, balance and fee events. Contractual rate changes remain included.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Add an event">
            {addKinds.map((kind) => <Button key={kind} type="button" variant="outline" size="sm" onClick={() => onEdit(kind)}>{KIND_LABEL[kind]}</Button>)}
            <Button type="button" variant="outline" size="sm" onClick={() => onEditRate("new")}>Rate change</Button>
          </div>
        </div>

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
                      <td className="px-4 py-2.5 tabular-nums">{row.date}</td>
                      <td className="px-3 py-2.5 font-medium">{KIND_LABEL[row.assumption.kind]}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatAmount(row.assumption.amountMinor, sim.minorDigits)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{assumptionDetails(row.assumption)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(row.assumption)} aria-label={`Edit ${KIND_LABEL[row.assumption.kind]} on ${row.date}`}>Edit</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(row.assumption)} aria-label={`Remove ${KIND_LABEL[row.assumption.kind]} on ${row.date}`}>Remove</Button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.key}>
                      <td className="px-4 py-2.5 tabular-nums">{row.date}</td>
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
