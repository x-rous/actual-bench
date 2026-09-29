import type { SqliteDatabase } from "@/lib/app-db/types";
import { evaluateStrategyEligibility, type ActualCapabilities, type Eligibility } from "@/lib/financial-models/loan/eligibility";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { projectDebt, type DebtProjection, type DebtProjectionInput } from "@/lib/financial-models/loan/projection";
import { modelFromDetail } from "../model/buildModel";
import { getDebtDetail, type DebtBlock } from "./debtConfigService";

export { modelFromDetail };

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
