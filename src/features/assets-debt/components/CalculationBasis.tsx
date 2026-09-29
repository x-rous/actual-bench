"use client";

import { useQuery } from "@tanstack/react-query";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { StrategyOption } from "@/lib/financial-models/loan/eligibility";
import { getEligibility } from "../lib/debtsApi";
import { fractionToPercent, formatMinor } from "../lib/money";
import {
  ACCRUAL_OPTIONS,
  BALANCE_PRECISION_OPTIONS,
  CHARGE_FREQUENCY_OPTIONS,
  DAY_COUNT_OPTIONS,
  EVENT_TIMING_OPTIONS,
  FINAL_PAYMENT_OPTIONS,
  labelOf,
  RATE_QUOTE_OPTIONS,
  RECAST_OPTIONS,
  REPAYMENT_DERIVATION_OPTIONS,
  REPAYMENT_FREQUENCY_OPTIONS,
  ROUNDING_OPTIONS,
  STRATEGY_OPTIONS,
} from "../lib/vocabulary";

/**
 * Why this engine, and on what basis (RD-084 P1.3; FR-030, FR-108, CHK119).
 *
 * Lists every strategy with the reason each rejected one does not fit, and
 * the calculation-profile assumptions the numbers rest on. Reads only.
 */

/** Actual's rule capabilities are checked when managed rules are set up (a later phase), not yet here. */
const CAPABILITY_REASON = /^The connected Actual (does not support|cannot read)/;

export function strategyReasons(option: StrategyOption): string[] {
  const reasons = option.reasons.filter((r) => !CAPABILITY_REASON.test(r));
  if (reasons.length < option.reasons.length) reasons.push("Whether the connected Actual supports formula rules has not been checked yet.");
  return reasons;
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(10rem,14rem)_1fr] gap-2 py-1 text-xs">
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function CalculationBasis({ detail }: { detail: DebtDetail }) {
  const eligibility = useQuery({ queryKey: ["assets-debt", "eligibility", detail.debt.id, detail.debt.currentRevision], queryFn: () => getEligibility(detail.debt.id), enabled: !detail.blocked });
  if (detail.blocked || !detail.config.ok) {
    return (
      <section aria-label="Calculation basis" className="px-4 py-3 text-sm">
        <p role="status">
          <span className="font-semibold">Blocked:</span> {detail.blocked?.message ?? "The saved configuration cannot be used."}
        </p>
      </section>
    );
  }
  const c = detail.config.config;
  const p = c.profile;
  const { currency, currencyMinorDigits: digits } = detail.debt;
  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <section aria-labelledby="strategy-heading">
        <h2 id="strategy-heading" className="text-sm font-semibold">
          Which engine fits this loan
        </h2>
        {eligibility.isLoading ? <p className="text-xs text-muted-foreground">Checking…</p> : null}
        {eligibility.isError ? <p className="text-xs text-destructive">{(eligibility.error as Error).message}</p> : null}
        {eligibility.data ? (
          <ul className="mt-2 flex flex-col gap-2">
            {eligibility.data.options.map((o) => {
              const reasons = strategyReasons(o);
              const recommended = eligibility.data.recommended === o.strategy;
              return (
                <li key={o.strategy} className="rounded border border-border px-3 py-2 text-xs">
                  <p className="font-medium">
                    {labelOf(STRATEGY_OPTIONS, o.strategy)}: {o.eligible ? (recommended ? "fits (recommended)" : "fits") : "does not fit"}
                    {detail.debt.executionStrategy === o.strategy ? " · currently selected" : ""}
                  </p>
                  {reasons.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      <section aria-labelledby="basis-heading">
        <h2 id="basis-heading" className="text-sm font-semibold">
          Calculation basis
        </h2>
        <p className="text-xs text-muted-foreground">Revision {detail.debt.currentRevision}. Every figure in the forecast rests on these assumptions.</p>
        <dl className="mt-2 divide-y divide-border/50">
          <Row term="Opening principal">{formatMinor(c.terms.openingPrincipalMinor, digits, currency)} on {c.terms.openingDate}</Row>
          <Row term="Rates">{detail.rates.map((r) => `${fractionToPercent(r.annualRateDecimal)}% from ${r.accrualEffectiveFrom}`).join("; ") || "None"}</Row>
          <Row term="Rate quoted as">{labelOf(RATE_QUOTE_OPTIONS, p.rateQuote)}</Row>
          <Row term="Interest accrues">{labelOf(ACCRUAL_OPTIONS, p.accrual)}{p.accrual !== "per-period" ? `, ${labelOf(DAY_COUNT_OPTIONS, p.dayCount)}` : ""}</Row>
          <Row term="Interest is charged">{labelOf(CHARGE_FREQUENCY_OPTIONS, p.chargeFrequency)}{p.chargeDay ? ` on day ${p.chargeDay}` : ""}</Row>
          <Row term="Repayments">{labelOf(REPAYMENT_FREQUENCY_OPTIONS, p.repaymentFrequency)}; {labelOf(REPAYMENT_DERIVATION_OPTIONS, p.repaymentDerivation).toLowerCase()}</Row>
          <Row term="Payment recalculated">{labelOf(RECAST_OPTIONS, p.recast)}{c.paymentRecasts.length ? ` (${c.paymentRecasts.map((r) => r.date).join(", ")})` : ""}</Row>
          <Row term="Interest-only periods">{c.phases.length ? c.phases.map((ph) => `${ph.from} to ${ph.to}`).join("; ") : "None"}</Row>
          <Row term="Rounding">Payments {labelOf(ROUNDING_OPTIONS, p.rounding.paymentRounding).toLowerCase()}, interest {labelOf(ROUNDING_OPTIONS, p.rounding.interestPostingRounding).toLowerCase()}; {labelOf(BALANCE_PRECISION_OPTIONS, p.rounding.balancePrecision).toLowerCase()}</Row>
          <Row term="Same-day events">{"timing" in p.eventOrder ? labelOf(EVENT_TIMING_OPTIONS, p.eventOrder.timing) : "Placed per event group"}</Row>
          <Row term="Final payment">{labelOf(FINAL_PAYMENT_OPTIONS, p.finalPayment)}</Row>
          <Row term="Offsets">{detail.offsets.length ? `${detail.offsets.length} account${detail.offsets.length > 1 ? "s" : ""}` : "None"}</Row>
        </dl>
      </section>
    </div>
  );
}
