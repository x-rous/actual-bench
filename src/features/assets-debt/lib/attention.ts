import type { AttentionItem, AttentionReason } from "@/lib/assets-debt/services/attentionService";
import { loanPath } from "./routes";

/**
 * What each loan needs, in words (RD-084 T293, rev 4): shown on its card in the Loans & Debt list,
 * which also filters to "Needs attention" (the former global Activity page). Last-known state only:
 * no Actual read.
 */

const s = (n: number) => (n === 1 ? "" : "s");

export function attentionText(reason: AttentionReason): string {
  switch (reason.code) {
    case "interrupted": return `${reason.count} interrupted change${s(reason.count)}: check Actual`;
    case "failed": return `${reason.count} failed change${s(reason.count)}`;
    case "undo-pending": return `${reason.count} undo${s(reason.count)} to review`;
    case "review": return `${reason.count} change${s(reason.count)} to review`;
    case "blocked": return `${reason.count} change${s(reason.count)} blocked`;
    case "matching-not-enabled": return "Repayment matching not enabled";
    case "configuration-blocked": return `Settings cannot be used: ${reason.message}`;
  }
}

/** Where a loan that needs attention opens: its filtered Transactions, or Settings for setup. */
export function hrefOf(item: AttentionItem): string {
  const view = item.reasons[0]?.code === "matching-not-enabled" || item.reasons[0]?.code === "configuration-blocked" ? "link" : "repayments";
  return loanPath(item.id, `view=${view}${view === "repayments" ? `&filter=${item.filter}` : ""}`);
}
