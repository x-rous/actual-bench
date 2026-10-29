import type { DebtProjection, DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import { headline } from "./results";
import type { SimAssumption, SimulationState } from "./simulatorModel";
import type { TrackedHistory } from "./trackedSchedule";

/**
 * What a person can paste into an issue when a loan's figures look wrong: the settings, the events, the results and the
 * start of the schedule, plus the engine versions, so the calculation can be reproduced.
 *
 * It holds amounts and dates but no loan, account or payee names, no Notes and no ids, and it never names a currency.
 * Amounts are in minor units (a thousandth, a hundredth... of the currency: see `minorDigits`).
 */

const isRepayment = (e: DebtProjectionEvent) => e.eventType === "repayment" || e.eventType === "final-payment";

const KIND_LABEL: Record<SimAssumption["kind"], [string, string]> = {
  "extra-repayment": ["extra payment", "extra payments"],
  draw: ["redraw", "redraws"],
  fee: ["fee", "fees"],
  "payment-change": ["repayment change", "repayment changes"],
  "offset-balance": ["offset balance", "offset balances"],
  "offset-deposit": ["offset deposit", "offset deposits"],
  "offset-withdrawal": ["offset withdrawal", "offset withdrawals"],
};

/** "2 extra payments, 1 fee": the events the calculation was given, and how many of them are switched off. */
export function describeEvents(sim: SimulationState): { counts: string; switchedOff: number } {
  const counts = new Map<SimAssumption["kind"], number>();
  let switchedOff = 0;
  for (const a of sim.assumptions) {
    if (a.enabled === false) switchedOff++;
    counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  }
  const rateChanges = Math.max(0, sim.rates.length - 1);
  const parts = [...counts].map(([kind, n]) => `${n} ${KIND_LABEL[kind][n === 1 ? 0 : 1]}`);
  if (rateChanges) parts.push(`${rateChanges} rate ${rateChanges === 1 ? "change" : "changes"}`);
  return { counts: parts.join(", "), switchedOff };
}

/** The repayments of a projection, in order. */
export const repaymentsOf = (projection: DebtProjection | null): DebtProjectionEvent[] => (projection?.ok ? projection.events.filter(isRepayment) : []);

/** The engine and its component versions, taken from the first event that carries them. */
export function engineVersionsOf(projection: DebtProjection | null): Record<string, string> {
  if (!projection?.ok) return {};
  return projection.events.find((e) => Object.keys(e.engineVersions ?? {}).length > 0)?.engineVersions ?? {};
}

export type DiagnosticsInput = {
  sim: SimulationState;
  projection: DebtProjection | null;
  revision: number | null;
  unsaved: boolean;
  tracked?: TrackedHistory | null;
  appVersion: string;
  /** An ISO timestamp, or omitted for a preview. */
  generatedAt?: string;
};

export function buildCalculationDiagnostics({ sim, projection, revision, unsaved, tracked, appVersion, generatedAt }: DiagnosticsInput): Record<string, unknown> {
  const repayments = repaymentsOf(projection);
  const sample = (e: DebtProjectionEvent) => ({ date: e.date, type: e.eventType, paymentMinor: -e.cashMovementMinor, principalMinor: e.principalMovementMinor, interestMinor: e.interestMinor, balanceAfterMinor: e.balanceAfterMinor });
  const head = projection?.ok ? headline(projection.events) : null;
  return {
    report: "Actual Bench loan calculation diagnostics",
    ...(generatedAt ? { generatedAt } : {}),
    appVersion,
    amounts: `minor units; minorDigits ${sim.minorDigits}`,
    revision: { saved: revision, unsavedChanges: unsaved },
    engineVersions: engineVersionsOf(projection),
    status: projection === null ? "not calculated" : projection.ok ? "calculated" : { blocked: projection.blocked.map((b) => ({ code: b.code, date: b.date, message: b.message })) },
    terms: {
      shape: sim.shape, principalMinor: sim.principalMinor, startDate: sim.startDate, termMonths: sim.termMonths, contractTermMonths: sim.contractTermMonths,
      maturityDate: sim.maturityDate, firstPaymentDate: sim.firstPaymentDate, firstInterestChargeDate: sim.firstInterestChargeDate, contractualPaymentMinor: sim.contractualPaymentMinor,
      interestOnly: sim.interestOnly, phases: sim.phases, paymentRecasts: sim.paymentRecasts.map((r) => r.date),
    },
    calculationMethod: sim.profile,
    rates: sim.rates.map((r) => ({ from: r.accrualEffectiveFrom, annualRate: r.annualRateDecimal, paymentRecalcPolicy: r.paymentRecalcPolicy, paymentEffectiveFrom: r.paymentEffectiveFrom, floor: r.rateFloorDecimal, cap: r.rateCapDecimal })),
    events: sim.assumptions.map((a) => ({ kind: a.kind, from: a.effectiveFrom, recurrence: a.recurrence, amountMinor: a.amountMinor, feeTreatment: a.feeTreatment, switchedOff: a.enabled === false ? true : undefined })),
    costs: sim.components.map((c) => ({ kind: c.economicKind, amountRule: c.amountRule, fixedAmountMinor: c.fixedAmountMinor, treatment: c.treatment })),
    offsets: sim.offsets.length,
    dueDates: sim.businessDays ? { adjustment: sim.businessDays.adjustment, nonBusinessWeekdays: sim.businessDays.nonBusinessWeekdays, holidays: sim.businessDays.holidays.length } : "not adjusted",
    lenderStatement: sim.lenderStatement ?? "default",
    results: head ? {
      regularRepaymentMinor: head.regularRepaymentMinor, repaymentChanges: head.repaymentChanges, repayments: repayments.length,
      firstRepayment: repayments[0]?.date ?? null, lastRepayment: repayments.at(-1)?.date ?? null,
      totalRepaidMinor: head.totalRepaidMinor, totalInterestMinor: head.totalInterestMinor, payoffDate: head.payoffDate, closingBalanceMinor: head.closingBalanceMinor,
    } : null,
    schedule: repayments.length <= 5 ? { repayments: repayments.map(sample) } : { first: repayments.slice(0, 3).map(sample), last: repayments.slice(-2).map(sample), omitted: repayments.length - 5 },
    tracking: tracked ? {
      trackedFrom: tracked.startDate, today: tracked.today, installmentsBeforeTracking: tracked.installmentsBefore, missingInstallments: tracked.missingDueDates.length,
      actualEvents: tracked.ledgerEvents.length,
      projectionRestart: { lastRealEvent: tracked.anchor.date, restartDate: tracked.anchor.restartDate, principalMinor: tracked.anchor.principalMinor, accruedInterestMinor: tracked.anchor.accruedInterestMinor, scheduledPaymentMinor: tracked.anchor.scheduledPaymentMinor },
    } : null,
  };
}

/** The report as text to paste: a short note, then the data as JSON. */
export function diagnosticsText(diagnostics: Record<string, unknown>): string {
  return [
    "Actual Bench loan calculation diagnostics",
    "",
    "This holds amounts and dates but no names, accounts, Notes or ids. Amounts are minor units (see minorDigits). Check it before you share it.",
    "",
    "```json",
    JSON.stringify(diagnostics, null, 2),
    "```",
  ].join("\n");
}
