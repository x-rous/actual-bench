import { explainBlocks } from "@/lib/financial-models/loan/blockMessages";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { getEffectiveDebtAnchor } from "@/lib/app-db/debtAnchorRepository";
import { getDebtDetail } from "./debtConfigService";
import { projectStoredDebt } from "./projectionService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";
import { summarizeLoanEvents, type LoanSummary } from "./loanSummaryEvents";

export type { LoanSummary };

/** Compact overview payload: forecast facts and confirmed history have separate sources. */
export function summarizeStoredLoan(db: SqliteDatabase, id: string, input: { today: string; offsetHistories?: OffsetHistorySnapshot[] }) {
  const detail = getDebtDetail(db, id);
  if (!detail) return { ok: false as const, notFound: true as const };
  const anchor = getEffectiveDebtAnchor(db, id);
  const projected = projectStoredDebt(db, id, { from: "0001-01-01", to: `${Number(input.today.slice(0, 4)) + 60}-12-31`, resolution: "events", offsetHistories: input.offsetHistories }, detail);
  if (!projected.ok) return projected;
  if (!projected.projection.ok) return { ok: false as const, blocked: { code: "invalid-config", message: explainBlocks(projected.projection.blocked).texts.join(" ") } };
  const events = projected.projection.events;
  const paidOff = detail.paidOff && detail.paidOff.paidDate <= input.today ? detail.paidOff : null;
  // Interest and repayments to date come from the loan calculation, not confirmed Actual payments.
  const summary = summarizeLoanEvents(events, {
    today: input.today,
    forecastFrom: anchor?.anchorDate ?? projected.model.terms.openingDate,
    paidOffOn: paidOff?.paidDate ?? null,
    startingPrincipalMinor: anchor?.principalMinor ?? projected.model.terms.openingPrincipalMinor,
  });
  return { ok: true as const, summary };
}
