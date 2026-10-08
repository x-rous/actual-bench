import { listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { listDebtSummaries } from "./debtConfigService";

/**
 * What needs the user across loans (RD-084 P1.6b T293; `ux-loan-workspace.md`
 * §6). Read-only and from the app DB only: it never reads Actual, so it shows
 * each loan's last-known state. Assets join this list when their own
 * workflows exist.
 */

export type AttentionReason =
  | { code: "interrupted"; count: number }
  | { code: "failed"; count: number }
  | { code: "undo-pending"; count: number }
  | { code: "review"; count: number }
  | { code: "blocked"; count: number }
  | { code: "matching-not-enabled" }
  | { code: "configuration-blocked"; message: string };

export type AttentionItem = {
  subjectKind: "debt";
  id: string;
  name: string;
  /** Worst first: interrupted, failed, undo pending, to review, blocked, matching, configuration. */
  reasons: AttentionReason[];
  /** The Activity filter the item opens. */
  filter: "action" | "all";
};

const LIVE_PROPOSAL = new Set(["proposed"]);

export function listNeedsAttention(db: SqliteDatabase, budgetSyncId: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const debt of listDebtSummaries(db, budgetSyncId)) {
    if (debt.status === "archived") continue;
    const reasons: AttentionReason[] = [];
    if (debt.blocked) {
      reasons.push({ code: "configuration-blocked", message: debt.blocked.message });
    } else {
      const postings = listSubjectPostings(db, "debt", debt.id);
      const count = (pred: (p: (typeof postings)[number]) => boolean) => postings.filter(pred).length;
      const interrupted = count((p) => p.status === "indeterminate");
      const failed = count((p) => p.status === "failed");
      const undoPending = count((p) => !!p.reversalOf && LIVE_PROPOSAL.has(String(p.status)));
      const review = count((p) => !p.reversalOf && LIVE_PROPOSAL.has(String(p.status)) && (p.classification === "review" || p.classification === "safe"));
      const blocked = count((p) => !p.reversalOf && LIVE_PROPOSAL.has(String(p.status)) && p.classification === "blocked");
      if (interrupted) reasons.push({ code: "interrupted", count: interrupted });
      if (failed) reasons.push({ code: "failed", count: failed });
      if (undoPending) reasons.push({ code: "undo-pending", count: undoPending });
      if (review) reasons.push({ code: "review", count: review });
      if (blocked) reasons.push({ code: "blocked", count: blocked });
      if (debt.status === "active" && !listDebtMatchRules(db, debt.id).some((r) => r.enabled && r.purpose === "repayment")) reasons.push({ code: "matching-not-enabled" });
    }
    if (reasons.length) out.push({ subjectKind: "debt", id: debt.id, name: debt.name, reasons, filter: reasons[0].code === "matching-not-enabled" || reasons[0].code === "configuration-blocked" ? "all" : "action" });
  }
  return out;
}
