import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { formatAmount } from "../../lib/money";
import type { PreviewDirectory } from "../preview/renderPreviewRows";

/**
 * The words of an expanded change (RD-084 P1.6b, `ux-loan-workspace.md` §3.6 rev 2): one
 * headline saying what changes, at most one line of context, and one short sentence on how the
 * amounts were found. Technical detail (row ids, Actual's own row handling, engine versions)
 * stays behind disclosures. Pure.
 */

export type ContextTone = "neutral" | "quiet" | "warn" | "bad";
export type ChangeContext = { text: string; tone: ContextTone };

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const accountName = (directory: PreviewDirectory, id: string) => directory.accounts.find((a) => a.id === id)?.name ?? "the loan account";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const CREATE_NOUN: Record<string, string> = {
  "interest-charge": "an interest charge",
  "fee-charge": "a capitalized fee",
  "opening-adjustment": "an opening adjustment",
  "reconciliation-adjustment": "a reconciliation adjustment",
  reversal: "a reversing entry",
};

/** What the change does, in one line. */
export function changeHeadline(posting: PostingView, directory: PreviewDirectory, digits: number): string {
  const o = posting.output;
  const money = (minor: number) => formatAmount(Math.abs(minor), digits);
  switch (o.kind) {
    case "restructure":
      return `${o.payoff ? "Pay off the loan: split into" : "Split into"} ${o.components.map((c) => `${cap(c.kind)} ${money(c.amountMinor)}`).join(" + ")}`;
    case "link":
      return `Link the lender's ${money(o.counterpartBefore.amountMinor)} on ${accountName(directory, o.counterpartBefore.accountId)} (${day(o.counterpartBefore.date)}) to this payment`;
    case "convert":
      return `Record this payment as a transfer to ${accountName(directory, o.transferAccountId)}`;
    case "create": {
      const total = o.operations.reduce((sum, op) => sum + op.amountMinor, 0);
      const first = o.operations[0];
      const noun = CREATE_NOUN[String(posting.postingKind)] ?? "an entry";
      const where = first ? ` on ${day(first.date)} to ${accountName(directory, first.accountId)}` : "";
      return posting.postingKind === "reconciliation-adjustment" ? `Add ${noun} of ${money(total)} so Actual matches the lender statement` : `Add ${noun} of ${money(total)}${where}`;
    }
    case "claim": {
      if (o.recordedSplit) return `Record the split already in Actual: Principal ${money(o.recordedSplit.principalMinor)} + Interest ${money(o.recordedSplit.interestMinor)}`;
      if (o.release) return "Release the recorded link for the lender's row";
      const row = o.rows[0];
      return posting.postingKind === "interest-link" && row ? `Count the lender's ${money(row.amountMinor)} on ${day(row.date)} as this period's interest` : "Count this transfer as the loan repayment";
    }
    case "restore-split":
      return `Put it back as one ${o.restoreTo.transferId ? "transfer" : "payment"} of ${money(o.restoreTo.amountMinor)}`;
    case "unlink":
      return "Detach the lender's row from this payment";
    case "revert-convert":
      return "Put the payment back as it was, not a transfer";
    case "adjust-split": {
      const r = o.recordedSplit;
      return o.edit
        ? `Change the split in Actual to Principal ${money(r.principalMinor)} + Interest ${money(r.interestMinor)}`
        : `Put the split back to Principal ${money(r.principalMinor)} + Interest ${money(r.interestMinor)}`;
    }
  }
}

const has = (posting: PostingView, code: string) => posting.reasons.some((r) => r.code === code);
const text = (posting: PostingView, code: string) => posting.reasons.find((r) => r.code === code)?.text ?? "";

/** The one line of context worth reading, by priority; null when the change is routine and says it all. */
export function changeContext(posting: PostingView): ChangeContext | null {
  const status = String(posting.status);
  const o = posting.output;
  if (status === "failed") {
    const error = posting.error as { message?: unknown; issues?: Array<{ detail?: string }> } | null;
    return { text: `Applied, but the check found a difference: ${String(error?.issues?.[0]?.detail ?? error?.message ?? "see Actual")}. Fix it in Actual and check again, or undo.`, tone: "bad" };
  }
  if (status === "indeterminate") return { text: "Bench can't tell whether the change reached Actual. Check Actual first; Bench then finishes the change or confirms it never landed.", tone: "warn" };
  if (status !== "proposed") return null;
  if (posting.classification === "blocked") return { text: posting.reasons[0]?.text ?? "This change cannot be applied yet.", tone: "bad" };
  if (o.kind === "restructure" && o.payoff) return { text: `${text(posting, "payoff-figures")} Applying records the payoff; the loan then shows as paid off and Bench stops expecting repayments. You can undo this later.`, tone: "warn" };
  if (has(posting, "edited-split")) return { text: text(posting, "edited-split"), tone: "warn" };
  if (has(posting, "recorded-split-differs")) return { text: text(posting, "recorded-split-differs"), tone: "warn" };
  if (has(posting, "earlier-repayment-assumed")) return { text: text(posting, "earlier-repayment-assumed"), tone: "warn" };
  if (has(posting, "actual-date-split-unavailable")) return { text: text(posting, "actual-date-split-unavailable"), tone: "warn" };
  if (has(posting, "user-category-would-be-replaced")) return { text: "This payment has your own category; the split replaces it with principal and interest. You can undo this later.", tone: "warn" };
  if (has(posting, "drift-material")) return { text: "Actual and the calculation disagree by more than your tolerance, even counting the pending changes. Check the loan before applying.", tone: "warn" };
  if (posting.postingKind === "reconciliation-adjustment" || posting.postingKind === "opening-adjustment") return { text: "This changes the loan balance in Actual. Check the amount against the lender statement first: an adjustment hides a difference rather than explaining it.", tone: "warn" };
  if (has(posting, "uncategorized-transfer")) return { text: text(posting, "uncategorized-transfer"), tone: "quiet" };
  switch (o.kind) {
    case "restructure":
      return o.replacesCounterpart
        ? { text: "Currently a full transfer. Applying separates the interest and keeps the principal linked to the loan. You can undo this later.", tone: "neutral" }
        : { text: "Applying splits this payment into principal, which goes to the loan, and interest. You can undo this later.", tone: "neutral" };
    case "link": return { text: "Your payment and the lender's row are the same money. Linking them makes it count once. You can undo this later.", tone: "neutral" };
    case "convert": return { text: "As a transfer, the loan balance follows your repayments. You can undo this later.", tone: "neutral" };
    case "restore-split": return { text: "Restores the payment exactly as it was before Bench split it.", tone: "neutral" };
    case "unlink": return { text: "Restores both rows exactly as they were before Bench linked them.", tone: "neutral" };
    case "revert-convert": return { text: "Restores the payment exactly as it was before Bench made it a transfer.", tone: "neutral" };
    case "adjust-split":
      return o.edit
        ? { text: "Changes the amounts of the split already in Actual; the loan-side row follows the principal. Nothing else changes, and you can undo this later.", tone: "neutral" }
        : { text: "Puts the split's amounts back exactly as they were before Bench changed them.", tone: "neutral" };
    case "claim":
      if (o.recordedSplit) return { text: "Already split in Actual the way this loan is recorded. Nothing changes in Actual; Bench records it and uses these figures from now on.", tone: "neutral" };
      return o.release ? null : { text: "Nothing changes in Actual. Bench counts this row so it is not added twice.", tone: "quiet" };
    default: return null;
  }
}

/** How the amounts were found, in one short sentence (the full method is behind "How it was calculated"). */
export function basisSentence(posting: PostingView): string | null {
  const { basis } = posting;
  if (posting.reversalOf || !basis.allocation || !basis.paidDate || !basis.dueDate) return null;
  if (basis.allocation !== "accrued-to-due-date") return `Interest up to the payment date (${day(basis.paidDate)}).`;
  const early = Math.round((Date.parse(`${basis.dueDate}T00:00:00Z`) - Date.parse(`${basis.paidDate}T00:00:00Z`)) / 86_400_000);
  const timing = early > 0 ? ` Paid ${early} day${early === 1 ? "" : "s"} early; the benefit shows next time.` : early < 0 ? ` Paid ${-early} day${early === -1 ? "" : "s"} late.` : "";
  return `Interest to the due date (${day(basis.dueDate)}).${timing}`;
}
