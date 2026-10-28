import { listDebtWrites } from "@/lib/app-db/debtTrackingRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { listDebtSummaries } from "./debtConfigService";
import { isUnresolved } from "../tracking/writes";

/**
 * What needs the user across loans, from the app DB only (it never reads Actual): settings that cannot be used, and a
 * write to Actual whose outcome is not known. What a loan's installments need is shown on its Repayments tab, which
 * reads Actual.
 */

export type AttentionReason =
  | { code: "interrupted"; count: number }
  | { code: "configuration-blocked"; message: string };

export type AttentionItem = {
  subjectKind: "debt";
  id: string;
  name: string;
  /** Worst first: an interrupted write, unusable settings. */
  reasons: AttentionReason[];
};

export function listNeedsAttention(db: SqliteDatabase, budgetSyncId: string, now = Date.now()): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const debt of listDebtSummaries(db, budgetSyncId)) {
    if (debt.status === "archived") continue;
    const reasons: AttentionReason[] = [];
    if (debt.blocked) reasons.push({ code: "configuration-blocked", message: debt.blocked.message });
    else {
      const writes = listDebtWrites(db, debt.id, 50);
      // A failed write wrote nothing (its installment stays Unrecorded); only an unknown outcome needs a person.
      const interrupted = writes.filter((w) => isUnresolved(w, now)).length;
      if (interrupted) reasons.push({ code: "interrupted", count: interrupted });
    }
    if (reasons.length) out.push({ subjectKind: "debt", id: debt.id, name: debt.name, reasons });
  }
  return out;
}
