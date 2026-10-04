import type { DebtBlock, DebtDetail } from "../services/debtConfigService";
import type { FutureAssumption, LoanModelSnapshot, Recurrence } from "@/lib/financial-models/loan/model";
import type { RatePeriod } from "@/lib/financial-models/loan/rates";
import { configBusinessDays, configLenderStatement } from "@/lib/financial-models/loan/configSchema";

/**
 * The engine's `LoanModelSnapshot` from a stored debt (RD-084 P1.3b T201).
 *
 * Pure and client-safe: it imports only types from the server side, so the
 * browser simulator and the server projection build the same model from the
 * same detail. A stored enum value this build does not know is an object
 * (`{ unknown }`), never a string, so `known` needs no app-DB import.
 */

const known = <T extends string>(value: T | { unknown: string } | null): value is T => typeof value === "string";

export type ModelBuild = { ok: true; model: LoanModelSnapshot } | { ok: false; blocked: DebtBlock };

export function modelFromDetail(detail: DebtDetail): ModelBuild {
  if (detail.blocked) return { ok: false, blocked: detail.blocked };
  if (!detail.config.ok) return { ok: false, blocked: { code: "invalid-config", message: "The saved configuration cannot be used." } };
  const { debt } = detail;
  const config = detail.config.config;
  const rates: RatePeriod[] = detail.rates.map((r) => ({
    accrualEffectiveFrom: r.accrualEffectiveFrom,
    annualRateDecimal: r.annualRateDecimal,
    announcedAt: r.announcedAt,
    paymentRecalcPolicy: r.paymentRecalcPolicy === null ? null : (r.paymentRecalcPolicy as string),
    paymentEffectiveFrom: r.paymentEffectiveFrom,
    rateCapDecimal: r.rateCapDecimal,
    rateFloorDecimal: r.rateFloorDecimal,
    paymentCap:
      r.paymentCap?.kind === "absolute"
        ? { kind: "absolute", amountMinor: r.paymentCap.amountMinor }
        : r.paymentCap?.kind === "previous-payment-factor"
          ? { kind: "previous-payment-factor", factor: r.paymentCap.factor }
          : null,
  }));
  const assumptions: FutureAssumption[] = detail.assumptions.map((a): FutureAssumption => {
    // Stored frequencies are validated on save; a Blocked debt never reaches here.
    const recurrence = a.recurrence && !("unknown" in a.recurrence) ? { recurrence: a.recurrence as Recurrence } : {};
    switch (a.assumptionKind) {
      case "fee":
        return { kind: "fee", date: a.effectiveFrom, amountMinor: a.amountMinor ?? 0, treatment: a.feeTreatment as "cash-paid" | "capitalized", ...recurrence };
      case "offset-balance":
        return { kind: "offset-balance", date: a.effectiveFrom, accountId: a.offsetAccountId!, balanceMinor: a.amountMinor ?? 0 };
      case "offset-deposit":
      case "offset-withdrawal":
        return { kind: a.assumptionKind, date: a.effectiveFrom, accountId: a.offsetAccountId!, amountMinor: a.amountMinor ?? 0, ...recurrence };
      case "payment-change":
        return { kind: "payment-change", date: a.effectiveFrom, amountMinor: a.amountMinor ?? 0 };
      case "draw":
        return { kind: "draw", date: a.effectiveFrom, amountMinor: a.amountMinor ?? 0, ...recurrence };
      default:
        return { kind: "extra-repayment", date: a.effectiveFrom, amountMinor: a.amountMinor ?? 0, ...recurrence };
    }
  });
  const behaviorClass = known(debt.behaviorClass) ? debt.behaviorClass : "term-loan";
  return {
    ok: true,
    model: {
      debtId: debt.id,
      revision: debt.currentRevision,
      currency: { code: debt.currency, minorDigits: debt.currencyMinorDigits },
      behaviorClass,
      lenderPattern: debt.lenderPattern !== null && known(debt.lenderPattern) ? debt.lenderPattern : null,
      terms: config.terms,
      profile: config.profile as LoanModelSnapshot["profile"],
      rates,
      phases: config.phases as LoanModelSnapshot["phases"],
      offsets: detail.offsets.map((o) => ({
        id: o.id,
        accountId: o.actualAccountId,
        effectiveFrom: o.effectiveFrom,
        effectiveTo: o.effectiveTo,
        percentageBps: o.offsetPercentageBps,
        basis: o.balanceBasis as "cleared" | "total",
        capMinor: o.capMinor,
        fundScheduledRepayments: o.fundScheduledRepayments,
        fundScheduledRepaymentsFrom: o.fundScheduledRepaymentsFrom ?? null,
        useActualBalance: o.useActualBalance === true,
      })),
      components: config.components,
      paymentRecasts: config.paymentRecasts.map((r) => ({ date: r.date })),
      assumptions,
      revolving: config.revolving,
      businessDays: configBusinessDays(config),
      lenderStatement: configLenderStatement(config),
    },
  };
}
