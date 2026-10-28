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
    case "interrupted": return `${reason.count} write${s(reason.count)} to Actual not finished: check Actual`;
    case "configuration-blocked": return `Settings cannot be used: ${reason.message}`;
  }
}

/** Where a loan that needs attention opens: Repayments for writes, Link to Actual for settings. */
export function hrefOf(item: AttentionItem): string {
  return loanPath(item.id, `view=${item.reasons[0]?.code === "configuration-blocked" ? "link" : "repayments"}`);
}
