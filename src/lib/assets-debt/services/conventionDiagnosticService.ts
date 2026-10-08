import type { SqliteDatabase } from "@/lib/app-db/types";
import { getDebtObservation } from "@/lib/app-db/debtObservationRepository";
import { getEffectiveDebtAnchor } from "@/lib/app-db/debtAnchorRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { diagnoseConventions } from "@/lib/financial-models/loan/diagnostics";
import { modelFromDetail } from "../model/buildModel";
import { getDebtDetail } from "./debtConfigService";

export function diagnoseStoredDebtConventions(db: SqliteDatabase, debtId: string, observationId: string) {
  const detail = getDebtDetail(db, debtId);
  const observation = getDebtObservation(db, observationId);
  if (!detail || !observation || observation.debtId !== debtId) throw new AppDbValidationError("Debt or observation not found");
  const built = modelFromDetail(detail);
  if (!built.ok) return built;
  const saved = getEffectiveDebtAnchor(db, debtId);
  const anchor = saved
    ? { date: saved.anchorDate, principalMinor: saved.principalMinor, accruedInterestMinor: saved.accruedInterestMinor, carriedRemainder: saved.carriedRemainderDecimal, source: saved.source }
    : { date: built.model.terms.openingDate, principalMinor: built.model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" };
  return { ok: true as const, candidates: diagnoseConventions({ model: built.model, anchor, events: [], to: observation.observedOn }, { date: observation.observedOn, principalMinor: observation.principalMinor }) };
}
