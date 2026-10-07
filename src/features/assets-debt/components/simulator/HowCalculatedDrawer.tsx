"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { DebtProjection } from "@/lib/financial-models/loan/projection";
import { fractionToPercent, formatAmount } from "../../lib/money";
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

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-xs">
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function HowCalculatedDrawer({ open, onClose, sim, projection, revision, unsaved }: { open: boolean; onClose: () => void; sim: SimulationState; projection: DebtProjection | null; revision: number | null; unsaved: boolean }) {
  const p = sim.profile;
  const daily = p.accrual !== "per-period";
  const engine = projection?.ok ? projection.events[0]?.engineVersions.engine : undefined;
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
          </section>
          <section aria-labelledby="basis-heading">
            <h3 id="basis-heading" className="text-sm font-semibold">
              Conventions and assumptions
            </h3>
            <dl className="divide-y divide-border/50">
              <Row term="Loan">{sim.principalMinor === null ? "Not entered" : `${formatAmount(sim.principalMinor, sim.minorDigits)} from ${sim.startDate}`}</Row>
              <Row term="Rates">{sim.rates.filter((r) => r.annualRateDecimal !== null).map((r, i) => `${fractionToPercent(r.annualRateDecimal)}% from ${i === 0 ? sim.startDate : r.accrualEffectiveFrom}`).join("; ") || "None"}</Row>
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
            </dl>
          </section>
          <p className="text-[11px] text-muted-foreground">This is a calculation from the settings entered, not financial advice.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
