/**
 * Classification policy for Assets & Debt postings (RD-084 P1.6 T116;
 * FR-170a, FR-171, FR-172, FR-094, FR-072; SC-011, SC-018).
 *
 * Persisted vocabulary is unchanged: `safe | review | blocked`. Classification
 * is **advisory**. Nothing in this module, or anywhere else, writes to Actual
 * because a proposal is `safe`: every posting is applied only by the user's
 * explicit Apply, which records the decision first (SC-018).
 *
 * `safe` is deliberately narrow (FR-170a): a Bench-created interest or fee
 * charge with unchanged inputs, or a read-only claim of an existing complete
 * transfer that writes nothing to Actual (the shipped P1.4 rule). It is never
 * produced for a restructure, a counterpart-link write, a split, an opening or
 * reconciliation adjustment (owner decision D1), an unreviewed principal
 * change, or any proposal while drift is material.
 *
 * One exception (owner decision 2026-10-05, FR-170c): a **routine repayment
 * split** is `safe` when the planner marks it routine (a repayment it matched
 * uniquely under an enabled rule, on a loan whose lender embeds interest) and
 * its only notes are the routine ones in `ROUTINE_SPLIT_REVIEWS`. An edit, an
 * assumed earlier repayment, a user category, unexplained material drift or
 * anything else keeps it Review. Still advisory: applied only by the user.
 */

import type { PostingClassification, PostingKind, PostingReason } from "@/lib/app-db/types";

/**
 * What a planned posting does in Actual. `claim` writes nothing to Actual,
 * only a Bench link; `convert` makes an existing payment a transfer by its
 * payee (T277). Undo proposals use the shape of what they reverse.
 */
export type PostingShape = "create" | "restructure" | "link" | "claim" | "convert";

/** The exact `safe` set (FR-170a). A test fails if this changes without a specification change. */
export const SAFE_ELIGIBLE: ReadonlyArray<{ postingKind: PostingKind; shape: PostingShape }> = [
  { postingKind: "interest-charge", shape: "create" },
  { postingKind: "fee-charge", shape: "create" },
  { postingKind: "repayment-link", shape: "claim" },
  { postingKind: "interest-link", shape: "claim" },
];

/** Kinds that are always at least Review, whatever else is true (FR-064, FR-092, D1, FR-184). */
export const ALWAYS_REVIEW_KINDS: ReadonlySet<PostingKind> = new Set(["opening-adjustment", "reconciliation-adjustment", "reversal", "repayment-split", "receivable-split"]);

export const UI_LABELS: Record<PostingClassification, string> = {
  // Rendered with a plain hyphen (owner decision D3; eslint forbids em dashes in UI text).
  safe: "Recommended - apply with one click",
  review: "Review before applying",
  blocked: "Cannot apply - resolve in Actual first",
};

/** Plain-language reasons; every Review and Blocked one names what the user can do next (SC-011). */
export const REASONS = {
  deterministicCharge: { code: "deterministic-charge", text: "Deterministic charge with unchanged inputs." },
  existingTransferClaim: { code: "existing-full-transfer", text: "The payment is already a transfer to the loan; Bench only records the link." },
  restructure: { code: "restructures-existing-payment", text: "Restructures an existing payment; confirm the split." },
  counterpartLink: { code: "links-lender-row", text: "Links the lender's row as the other side of the transfer; check both rows." },
  multipleCandidates: { code: "multiple-candidates", text: "Multiple candidate transactions; choose the right one in Actual or tighten the matching rule." },
  driftMaterial: { code: "drift-material", text: "The model and Actual or the lender disagree beyond the drift tolerance; reconcile first or review this change." },
  openingAdjustment: { code: "opening-adjustment", text: "An opening adjustment changes the loan balance in Actual; check the amount against the lender statement." },
  reconciliationAdjustment: { code: "reconciliation-adjustment", text: "A reconciliation adjustment changes the loan balance in Actual; check the difference against the lender statement." },
  reversal: { code: "compensating-reversal", text: "Reverses an applied posting; check the reversal before applying." },
  lateLenderCharge: { code: "late-lender-charge", text: "The lender's interest charge arrived after Bench posted one; reversing Bench's charge avoids counting interest twice." },
  principalChange: { code: "unreviewed-principal-change", text: "Changes the outstanding principal by more than the drift tolerance without a matching lender observation; record the statement first." },
  categorizedPayment: { code: "user-category-would-be-replaced", text: "The payment already has your category; the split replaces it. Confirm the split." },
  embeddedTransfer: { code: "embedded-interest-transfer-needs-split", text: "The payment is a plain transfer but the lender embeds interest; confirm the split." },
  splitChild: { code: "existing-split-child", text: "The payment is already a split child; check it before Bench changes it." },
  reconciledRow: { code: "reconciled-row", text: "The matched row is reconciled in Actual. Resolve in Actual, then re-run." },
  reconciledLenderRow: { code: "reconciled-lender-row", text: "The lender's row is reconciled in Actual and cannot become the transfer counterpart. Resolve in Actual, then re-run." },
  missingLoanPaymentCategory: { code: "missing-loan-payment-category", text: "Choose a loan payment category for this debt." },
  amountMismatch: { code: "lender-amount-mismatch", text: "The lender's row differs from the principal amount; Actual would overwrite it. Correct the row in Actual or re-match." },
  ambiguousStructure: { code: "ambiguous-existing-structure", text: "The existing transaction's structure is ambiguous. Resolve it in Actual, then re-run." },
  splitParent: { code: "split-parent-unclaimable", text: "The matched row is a split parent; Bench never changes an existing split. Resolve it in Actual." },
  missingAccount: { code: "missing-account", text: "The loan's Actual account is missing or closed. Fix the account mapping in Tracking setup." },
  linkUnverifiable: { code: "transfer-links-unverifiable", text: "This connection does not report transfer links, so Bench cannot verify one. Update actual-http-api or use Direct mode." },
  unsupportedStrategy: { code: "unsupported-native-formula", text: "The Actual formula rule strategy is not available in this release. Switch the loan to a Bench strategy in Tracking setup." },
  alreadyLinked: { code: "already-linked", text: "That transaction is already linked to another posting or debt. Resolve the existing link first." },
  needsReview: { code: "needs-review", text: "Check the resulting rows before applying." },
  invalidPrincipal: { code: "invalid-principal", text: "The planned split would need a negative principal. Check the payment amount and the configuration." },
  convertToTransfer: { code: "converts-payment-to-transfer", text: "Makes the existing payment a transfer to the loan; Actual creates the loan-side row. Check both rows." },
  replacesCounterpart: { code: "replaces-transfer-counterpart", text: "The payment is already a transfer. Splitting it replaces the loan-side row Actual made with one for the principal only; Undo re-creates the original row with a new id in Actual." },
  lenderCounterpartProtected: { code: "imported-counterpart-protected", text: "The payment is already a transfer whose loan-side row was imported (for example from the lender). Splitting would delete that row and Undo could not bring it back. Remove the transfer link in Actual (keep the imported row), then re-run." },
  routineSplit: { code: "routine-repayment-split", text: "Routine split of a repayment Bench matched under your enabled rule." },
  undoLinkFirst: { code: "undo-link-first", text: "The split's principal is linked to the lender's row. Undo that link first, then undo the split." },
} as const satisfies Record<string, PostingReason>;

export type PolicyInput = {
  postingKind: PostingKind;
  shape: PostingShape;
  /** Material drift for this debt (FR-094): nothing is `safe` while it lasts. */
  driftMaterial: boolean;
  /** Changes outstanding principal beyond tolerance without a matching observation. */
  unreviewedPrincipalChange?: boolean;
  /** Anything that prevents applying as designed. */
  blockers?: PostingReason[];
  /** Anything that needs the user's look before applying. */
  reviews?: PostingReason[];
  /** Set only by the planner for a uniquely matched repayment split (FR-170c). */
  routineSplit?: boolean;
};

/** The notes a routine repayment split carries; any other note keeps it Review (FR-170c). */
export const ROUTINE_SPLIT_REVIEWS: ReadonlySet<string> = new Set(["restructures-existing-payment", "embedded-interest-transfer-needs-split", "replaces-transfer-counterpart"]);

export function isRoutineSplit(input: PolicyInput): boolean {
  return input.routineSplit === true && input.postingKind === "repayment-split" && input.shape === "restructure" && !input.driftMaterial
    && !input.unreviewedPrincipalChange && (input.reviews ?? []).every((r) => ROUTINE_SPLIT_REVIEWS.has(r.code));
}

export type PolicyResult = { classification: PostingClassification; reasons: PostingReason[] };

function unique(reasons: PostingReason[]): PostingReason[] {
  const seen = new Set<string>();
  return reasons.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
}

export function isSafeEligible(postingKind: PostingKind, shape: PostingShape): boolean {
  return SAFE_ELIGIBLE.some((entry) => entry.postingKind === postingKind && entry.shape === shape);
}

export function classifyPosting(input: PolicyInput): PolicyResult {
  const blockers = input.blockers ?? [];
  if (blockers.length) return { classification: "blocked", reasons: unique(blockers) };
  // The routine notes stay with it, so the screen can still say what the change does (FR-170c).
  if (isRoutineSplit(input)) return { classification: "safe", reasons: unique([REASONS.routineSplit, ...(input.reviews ?? [])]) };

  const reviews: PostingReason[] = [...(input.reviews ?? [])];
  if (input.driftMaterial) reviews.push(REASONS.driftMaterial);
  if (input.unreviewedPrincipalChange) reviews.push(REASONS.principalChange);
  if (input.postingKind === "opening-adjustment") reviews.push(REASONS.openingAdjustment);
  if (input.postingKind === "reconciliation-adjustment") reviews.push(REASONS.reconciliationAdjustment);
  if (input.postingKind === "reversal") reviews.push(REASONS.reversal);
  if (input.shape === "restructure") reviews.push(REASONS.restructure);
  if (input.shape === "link") reviews.push(REASONS.counterpartLink);
  if (input.shape === "convert") reviews.push(REASONS.convertToTransfer);

  const safe = isSafeEligible(input.postingKind, input.shape) && !ALWAYS_REVIEW_KINDS.has(input.postingKind) && reviews.length === 0;
  if (safe) {
    return { classification: "safe", reasons: [input.shape === "claim" ? REASONS.existingTransferClaim : REASONS.deterministicCharge] };
  }
  if (reviews.length === 0) reviews.push(REASONS.needsReview);
  return { classification: "review", reasons: unique(reviews) };
}

/** Map the shipped P1.4 existing-structure reason codes to plain-language policy reasons. */
export function existingStructureReason(code: string): PostingReason {
  switch (code) {
    case "reconciled-row-read-only": return REASONS.reconciledRow;
    case "reconciled-lender-row-never-counterpart": return REASONS.reconciledLenderRow;
    case "ambiguous-existing-structure":
    case "missing-split-child-structure": return REASONS.ambiguousStructure;
    case "ambiguity-overridden-for-this-row": return REASONS.multipleCandidates;
    case "split-parent-unclaimable": return REASONS.splitParent;
    case "existing-split-child": return REASONS.splitChild;
    case "existing-full-transfer": return REASONS.existingTransferClaim;
    case "embedded-interest-transfer-needs-split": return REASONS.embeddedTransfer;
    case "user-category-would-be-replaced": return REASONS.categorizedPayment;
    default: return REASONS.restructure;
  }
}

export function classificationLabel(classification: PostingClassification | { unknown: string }): string {
  return typeof classification === "string" ? UI_LABELS[classification] : "Cannot apply - resolve in Actual first";
}
