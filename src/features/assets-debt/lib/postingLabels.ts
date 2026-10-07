import type { PostingView } from "@/lib/assets-debt/services/proposalService";

/**
 * Plain-language labels for postings (RD-084 P1.6 T287). Raw identifiers
 * ("repayment-split", "reversal", "projection@2") never reach the screen;
 * every list and card names what a posting does and why it is in its state.
 * Pure, so the current pages and the loan workspace share one wording.
 */

const KIND_LABELS: Record<string, string> = {
  "interest-charge": "Interest charge",
  "interest-link": "Lender interest charge",
  "fee-charge": "Capitalized fee",
  "repayment-split": "Repayment split",
  "repayment-link": "Lender link",
  "opening-adjustment": "Opening adjustment",
  "reconciliation-adjustment": "Reconciliation adjustment",
  reversal: "Undo",
};

/** What the posting does, including what an Undo or a conversion restores or changes. */
export function postingTitle(posting: Pick<PostingView, "postingKind" | "output">): string {
  switch (posting.output.kind) {
    case "convert": return "Make the repayment a loan transfer";
    case "restructure": if (posting.output.payoff) return "Loan payoff";
      break;
    case "restore-split": return "Undo of repayment split";
    case "unlink": return "Undo of lender link";
    case "revert-convert": return "Undo of loan transfer";
    case "claim": return posting.output.release ? "Undo of recorded link" : KIND_LABELS[String(posting.postingKind)] ?? "Recorded link";
    case "create": if (posting.postingKind === "reversal") return "Undo of charge";
      break;
    case "adjust-split": return posting.output.edit ? "Change a split already in Actual" : "Undo of split change";
  }
  const kind = typeof posting.postingKind === "string" ? posting.postingKind : posting.postingKind.unknown;
  return KIND_LABELS[kind] ?? "Change";
}

const SUPERSEDED: Record<string, string> = {
  "newer-preview": "Replaced by a newer preview",
  "newer-undo": "Replaced by a newer undo request",
  "actual-changed": "Not applied: Actual changed before apply",
  "replaced-by-applied": "Closed: a later change for this due date was applied",
};

/** The posting's state in words; a superseded posting says why. */
export function postingStatusLabel(posting: Pick<PostingView, "status" | "appliedAt" | "decidedAt" | "error">): string {
  const status = String(posting.status);
  if (status === "applied") return `Applied ${posting.appliedAt?.slice(0, 10) ?? ""}`.trim();
  if (status === "declined") return `Declined ${posting.decidedAt?.slice(0, 10) ?? ""}`.trim();
  if (status === "reversed") {
    const error = posting.error as { cause?: unknown; detail?: unknown } | null;
    return error?.cause === "changed-in-actual" ? `Stopped counting: ${String(error.detail ?? "it was changed in Actual")}` : "Undone";
  }
  if (status === "superseded") {
    const cause = (posting.error as { superseded?: unknown } | null)?.superseded;
    return SUPERSEDED[typeof cause === "string" ? cause : ""] ?? "Replaced by a newer proposal";
  }
  if (status === "indeterminate") return "Interrupted; check Actual";
  if (status === "failed") return "Failed";
  if (status === "applying" || status === "approved") return "Applying";
  return "Proposed";
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** How the amounts were worked out, in words (never an engine version string). */
export function postingBasisLabel(posting: Pick<PostingView, "basis" | "output" | "reversalOf" | "configRevision">): string {
  if (posting.reversalOf) return "Restores the rows to how they were before the change; no amounts are calculated.";
  const { basis } = posting;
  if (basis.allocation && basis.paidDate && basis.dueDate) {
    const how = basis.allocation === "accrued-to-due-date"
      ? `interest to the due date (${day(basis.dueDate)}), early-payment benefit next time`
      : `interest up to the payment date (${day(basis.paidDate)})`;
    const assumed = basis.assumedEarlier ? ` ${basis.assumedEarlier} earlier repayment${basis.assumedEarlier === 1 ? " was" : "s were"} not found and taken as on time.` : "";
    return `Paid ${day(basis.paidDate)} for the ${day(basis.dueDate)} due date: ${how}. Configuration revision ${posting.configRevision}.${assumed}`;
  }
  if (posting.output.kind === "claim" || posting.output.kind === "link" || posting.output.kind === "convert") return `Links existing rows; no amounts are calculated. Configuration revision ${posting.configRevision}.`;
  return `Calculated from the loan's schedule. Configuration revision ${posting.configRevision}.`;
}
