"use client";

import { useMemo } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { explainBlocks } from "@/lib/financial-models/loan/blockMessages";
import type { DebtProjection } from "@/lib/financial-models/loan/projection";
import { buildCalculationDiagnostics, describeEvents, diagnosticsText, engineVersionsOf, repaymentsOf } from "../../lib/calculationDiagnostics";
import { fractionToPercent, formatAmount } from "../../lib/money";
import { headline } from "../../lib/results";
import type { TrackedHistory } from "../../lib/trackedSchedule";
import { ADJUSTMENT_OPTIONS, ALLOCATION_OPTIONS, WEEKDAY_LABELS } from "./DueDateSettings";
import { derivedFirstPaymentDate, summarizeProfile, type SimulationState } from "../../lib/simulatorModel";
import {
  ACCRUAL_OPTIONS,
  BALANCE_PRECISION_OPTIONS,
  CHARGE_FREQUENCY_OPTIONS,
  DAY_COUNT_OPTIONS,
  FINAL_PAYMENT_OPTIONS,
  labelOf,
  RATE_QUOTE_OPTIONS,
  RECAST_OPTIONS,
  REPAYMENT_DERIVATION_OPTIONS,
  REPAYMENT_FREQUENCY_OPTIONS,
  ROUNDING_OPTIONS,
} from "../../lib/vocabulary";

/**
 * "How this loan is calculated" (P1.3b T213; FR-108): a read-only
 * explanation, opened from the simulator. It states the engine, why, the
 * conventions and assumptions the figures rest on, and the saved revision.
 * Actual-integration diagnostics live in Tracking setup instead.
 */

/** "4 years", "1 year 6 months", "9 months". */
const termText = (months: number) => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} year${years === 1 ? "" : "s"}` : "", rest ? `${rest} month${rest === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "0 months";
};

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-xs">
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function HowCalculatedDrawer({ open, onClose, sim, projection, revision, unsaved, tracked = null }: { open: boolean; onClose: () => void; sim: SimulationState; projection: DebtProjection | null; revision: number | null; unsaved: boolean; tracked?: TrackedHistory | null }) {
  const p = sim.profile;
  const daily = p.accrual !== "per-period";
  const versions = engineVersionsOf(projection);
  const engine = versions.engine;
  const money = (minor: number) => formatAmount(minor, sim.minorDigits);
  const head = projection?.ok ? headline(projection.events) : null;
  const repayments = repaymentsOf(projection);
  const events = describeEvents(sim);
  const diagnosticsInput = { sim, projection, revision, unsaved, tracked, appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0" };
  // What is copied, shown before it is: built only while the drawer is open.
  const preview = useMemo(() => (open ? diagnosticsText(buildCalculationDiagnostics(diagnosticsInput)) : ""), [open, sim, projection, revision, unsaved, tracked]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = async () => {
    const text = diagnosticsText(buildCalculationDiagnostics({ ...diagnosticsInput, generatedAt: new Date().toISOString() }));
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Diagnostics copied. Paste them into your report.");
    } catch {
      toast.error("Could not copy. Open “Show what will be copied” and select the text instead.");
    }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-full overflow-y-auto"
        style={{ width: "min(806px, 92vw)", maxWidth: "none" }}
      >
        <SheetHeader>
          <SheetTitle>How this loan is calculated</SheetTitle>
          <SheetDescription>{summarizeProfile(p)}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
          <section aria-labelledby="engine-heading">
            <h3 id="engine-heading" className="text-sm font-semibold">
              Engine
            </h3>
            <p className="text-xs">
              {daily ? "Actual Bench, day by day" : "Actual Bench, period by period"}
              {engine ? ` (${engine})` : ""}.{" "}
              {daily ? "Interest accrues on each calendar day, which follows offsets, rate changes and transactions on their exact dates." : "Each repayment period earns the periodic rate on the balance, the usual way a level-payment loan is quoted."}
            </p>
            <p className="text-xs text-muted-foreground">{revision === null ? "Not saved yet: a simulation only." : unsaved ? `Based on unsaved changes to revision ${revision}.` : `Saved revision ${revision}.`}</p>
            {Object.keys(versions).length > 1 ? <p className="text-[11px] text-muted-foreground">Versions: {Object.entries(versions).map(([name, version]) => `${name} ${version}`).join(" · ")}</p> : null}
          </section>
          {projection && !projection.ok ? (
            <section aria-labelledby="blocked-heading">
              <h3 id="blocked-heading" className="text-sm font-semibold">Not calculated yet</h3>
              <ul className="list-disc pl-5 text-xs">{explainBlocks(projection.blocked).texts.map((text) => <li key={text}>{text}</li>)}</ul>
            </section>
          ) : null}
          {head ? (
            <section aria-labelledby="results-heading">
              <h3 id="results-heading" className="text-sm font-semibold">Results</h3>
              <dl className="divide-y divide-border/50">
                <Row term="Repayment">{head.regularRepaymentMinor === null ? "None" : money(head.regularRepaymentMinor)}{head.repaymentChanges ? ", and it changes over the loan" : ""}</Row>
                <Row term="Number of repayments">{repayments.length ? `${repayments.length}, from ${repayments[0].date} to ${repayments[repayments.length - 1].date}` : "None"}</Row>
                <Row term="Total repaid">{money(head.totalRepaidMinor)}</Row>
                <Row term="Total interest">{money(head.totalInterestMinor)}</Row>
                <Row term="Payoff date">{head.payoffDate ?? "Not within the term"}</Row>
              </dl>
            </section>
          ) : null}
          <section aria-labelledby="basis-heading">
            <h3 id="basis-heading" className="text-sm font-semibold">
              Conventions and assumptions
            </h3>
            <dl className="divide-y divide-border/50">
              <Row term="Loan">{sim.principalMinor === null ? "Not entered" : `${formatAmount(sim.principalMinor, sim.minorDigits)} from ${sim.startDate}`}</Row>
              <Row term="Rates">
                {sim.rates.filter((r) => r.annualRateDecimal !== null).length === 0 ? "None" : (
                  <ul>{sim.rates.filter((r) => r.annualRateDecimal !== null).map((r, i) => <li key={r.key}>{fractionToPercent(r.annualRateDecimal)}% from {i === 0 ? sim.startDate : r.accrualEffectiveFrom}{r.paymentRecalcPolicy === "on-rate-change" && i > 0 ? ", repayment recalculated" : r.paymentRecalcPolicy === "never" && i > 0 ? ", repayment kept" : ""}</li>)}</ul>
                )}
              </Row>
              <Row term="Rate quoted as">{labelOf(RATE_QUOTE_OPTIONS, p.rateQuote)}</Row>
              <Row term="Interest accrues">{labelOf(ACCRUAL_OPTIONS, p.accrual)}{daily ? `, ${labelOf(DAY_COUNT_OPTIONS, p.dayCount)}` : ""}</Row>
              <Row term="Interest is charged">{labelOf(CHARGE_FREQUENCY_OPTIONS, p.chargeFrequency)}{p.chargeDay ? ` on day ${p.chargeDay}` : ""}</Row>
              <Row term="Repayments">{labelOf(REPAYMENT_FREQUENCY_OPTIONS, p.repaymentFrequency)} from {derivedFirstPaymentDate(sim)}; {labelOf(REPAYMENT_DERIVATION_OPTIONS, p.repaymentDerivation).toLowerCase()}{sim.contractualPaymentMinor !== null ? ` (${formatAmount(sim.contractualPaymentMinor, sim.minorDigits)})` : ""}</Row>
              <Row term="Maturity">{sim.maturityDate ?? "From the term and first repayment date"}</Row>
              <Row term="Recalculated">{labelOf(RECAST_OPTIONS, p.recast)}</Row>
              <Row term="Interest-only">{sim.interestOnly && sim.phases.length ? sim.phases.map((ph) => `${ph.from} to ${ph.to}`).join("; ") : "None"}</Row>
              <Row term="Offset">{sim.offsets.length ? `${sim.offsets.length} account${sim.offsets.length > 1 ? "s" : ""}` : "None"}</Row>
              <Row term="Rounding">Repayments {labelOf(ROUNDING_OPTIONS, p.rounding.paymentRounding).toLowerCase()}, interest {labelOf(ROUNDING_OPTIONS, p.rounding.interestPostingRounding).toLowerCase()}; {labelOf(BALANCE_PRECISION_OPTIONS, p.rounding.balancePrecision).toLowerCase()}</Row>
              <Row term="Same-day order">{"timing" in p.eventOrder ? (p.eventOrder.timing === "start-of-day" ? "Transactions count before the day's interest" : "Transactions count after the day's interest") : "Set per group"}</Row>
              <Row term="Final repayment">{labelOf(FINAL_PAYMENT_OPTIONS, p.finalPayment)}</Row>
              <Row term="Term">{sim.termMonths === null ? "Not entered" : `${termText(sim.termMonths)}${sim.contractTermMonths ? `; the contract ends after ${termText(sim.contractTermMonths)} with a balloon` : ""}`}</Row>
              <Row term="Events">{events.counts ? `${events.counts}${events.switchedOff ? `; ${events.switchedOff} switched off` : ""}` : "None"}</Row>
              <Row term="Due dates">{sim.businessDays && sim.businessDays.adjustment !== "none" ? `${ADJUSTMENT_OPTIONS.find((o) => o.value === sim.businessDays!.adjustment)?.label ?? sim.businessDays.adjustment}; non-business days ${sim.businessDays.nonBusinessWeekdays.map((d) => WEEKDAY_LABELS[d]).join(", ") || "none"}${sim.businessDays.holidays.length ? ` and ${sim.businessDays.holidays.length} holiday${sim.businessDays.holidays.length === 1 ? "" : "s"}` : ""}` : "Stay on their dates"}</Row>
              <Row term="Lender statements">{ALLOCATION_OPTIONS.find((o) => o.value === (sim.lenderStatement?.interestAllocation ?? "as-calculated"))?.label}</Row>
            </dl>
          </section>
          {tracked ? (
            <section aria-labelledby="tracking-heading">
              <h3 id="tracking-heading" className="text-sm font-semibold">Tracked in Actual</h3>
              <dl className="divide-y divide-border/50">
                <Row term="Tracked from">{tracked.installmentsBefore > 0 ? `Installment ${tracked.installmentsBefore + 1}, due ${tracked.startDate}; the ${tracked.installmentsBefore} before count as paid as contracted` : `Installment 1, due ${tracked.startDate}`}</Row>
                <Row term="History">From Actual up to {tracked.anchor.date}, the last real event</Row>
                <Row term="Projection starts">{tracked.anchor.restartDate}{tracked.anchor.restartDate !== tracked.anchor.date ? `: that installment was paid early, so the projection continues from its due date with ${money(tracked.anchor.accruedInterestMinor)} of interest accrued since the payment` : ""}</Row>
                <Row term="Balance then">{money(tracked.anchor.principalMinor)}</Row>
                <Row term="Not found in Actual">{tracked.missingDueDates.length ? `${tracked.missingDueDates.length} installment${tracked.missingDueDates.length === 1 ? "" : "s"}` : "None"}</Row>
                <Row term="Extra principal, draws, fees">{tracked.ledgerEvents.length ? `${tracked.ledgerEvents.length} read from the Loan Ledger` : "None"}</Row>
              </dl>
            </section>
          ) : null}
          <section aria-labelledby="diagnostics-heading">
            <h3 id="diagnostics-heading" className="text-sm font-semibold">Diagnostics</h3>
            <p className="text-xs text-muted-foreground">If these figures differ from your lender&apos;s, copy the diagnostics and paste them into your report. They hold the settings, events, results and the start of the schedule, with amounts and dates, but no names, accounts, Notes or ids.</p>
            <div className="mt-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void copy()}><Copy className="size-3.5" aria-hidden />Copy diagnostics</Button>
            </div>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Show what will be copied</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-snug whitespace-pre-wrap">{preview}</pre>
            </details>
          </section>
          <p className="text-[11px] text-muted-foreground">This is a calculation from the settings entered, not financial advice.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
