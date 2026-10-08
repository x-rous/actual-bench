import { getEffectiveDebtAnchor } from "@/lib/app-db/debtAnchorRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { PostingOpening } from "./snapshot";

/** The effective opening of a debt's postings: the latest anchor, else the contract opening. */
export function openingFor(db: SqliteDatabase, debtId: string, model: { terms: { openingDate: string; openingPrincipalMinor: number } }): PostingOpening {
  const anchor = getEffectiveDebtAnchor(db, debtId);
  return anchor
    ? { date: anchor.anchorDate, principalMinor: anchor.principalMinor, accruedInterestMinor: anchor.accruedInterestMinor ?? 0, carriedRemainder: anchor.carriedRemainderDecimal, source: { kind: "anchor", anchorId: anchor.id } }
    : { date: model.terms.openingDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, carriedRemainder: null, source: { kind: "contract-opening" } };
}
