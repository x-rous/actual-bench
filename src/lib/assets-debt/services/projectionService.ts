import type { SqliteDatabase } from "@/lib/app-db/types";
import { isKnownEnum } from "@/lib/app-db/types";
import { evaluateStrategyEligibility, type ActualCapabilities, type Eligibility } from "@/lib/financial-models/loan/eligibility";
import type { FutureAssumption, LoanModelSnapshot, Recurrence } from "@/lib/financial-models/loan/model";
import { projectDebt, type DebtProjection, type DebtProjectionInput } from "@/lib/financial-models/loan/projection";
import type { RatePeriod } from "@/lib/financial-models/loan/rates";
import { getDebtDetail, type DebtBlock, type DebtDetail } from "./debtConfigService";

/**
 * Calculator and forecast (RD-084 P1.3; FR-105–FR-113).
 *
 * Builds the engine's `LoanModelSnapshot` from the stored configuration and
 * runs the pure `projectDebt`. Overrides apply to a copy and are never
 * written back (FR-113); only "apply as baseline" persists, through
 * `saveBaselineAssumptions`. A projection creates no ledger transactions
 * (FR-019): it returns data and writes nothing, here or in Actual.
 *
 * P1.3 has no lender observations yet, so the baseline starts from the
 * contract's opening principal. Later phases supply an anchor instead.
 */

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
      case "payment-change":
        return { kind: "payment-change", date: a.effectiveFrom, amountMinor: a.amountMinor ?? 0 };
      case "draw":
        return { kind: "draw", date: a.effectiveFrom, amountMinor: a.amountMinor ?? 0, ...recurrence };
      default:
        return { kind: "extra-repayment", date: a.effectiveFrom, amountMinor: a.amountMinor ?? 0, ...recurrence };
    }
  });
  const behaviorClass = isKnownEnum(debt.behaviorClass) ? debt.behaviorClass : "term-loan";
  return {
    ok: true,
    model: {
      debtId: debt.id,
      revision: debt.currentRevision,
      currency: { code: debt.currency, minorDigits: debt.currencyMinorDigits },
      behaviorClass,
      lenderPattern: debt.lenderPattern !== null && isKnownEnum(debt.lenderPattern) ? debt.lenderPattern : null,
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
      })),
      components: config.components,
      paymentRecasts: config.paymentRecasts.map((r) => ({ date: r.date })),
      assumptions,
      revolving: config.revolving,
    },
  };
}

export type ProjectionRequest = Pick<DebtProjectionInput, "from" | "to" | "overrides" | "resolution">;

export type StoredProjection = { ok: true; projection: DebtProjection; model: LoanModelSnapshot } | { ok: false; blocked: DebtBlock } | { ok: false; notFound: true };

/** Project a stored debt. Reads the configuration; writes nothing. */
export function projectStoredDebt(db: SqliteDatabase, debtId: string, request: ProjectionRequest): StoredProjection {
  const detail = getDebtDetail(db, debtId);
  if (!detail) return { ok: false, notFound: true };
  const built = modelFromDetail(detail);
  if (!built.ok) return built;
  const { model } = built;
  const projection = projectDebt({
    model,
    anchor: { date: model.terms.openingDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" },
    events: [],
    from: request.from,
    to: request.to,
    overrides: request.overrides,
    resolution: request.resolution,
  });
  return { ok: true, projection, model };
}

export type StoredEligibility = { ok: true; eligibility: Eligibility } | { ok: false; blocked: DebtBlock } | { ok: false; notFound: true };

/** FR-026/FR-030: the strategy ladder with a reason for each rejected strategy. */
export function storedDebtEligibility(db: SqliteDatabase, debtId: string, capabilities: ActualCapabilities): StoredEligibility {
  const detail = getDebtDetail(db, debtId);
  if (!detail) return { ok: false, notFound: true };
  const built = modelFromDetail(detail);
  if (!built.ok) return built;
  return { ok: true, eligibility: evaluateStrategyEligibility(built.model, capabilities) };
}
