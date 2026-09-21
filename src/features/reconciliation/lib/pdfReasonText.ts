import type { PdfConfidenceReason } from "@/lib/reconciliation/statement/pdf";

/**
 * What each parser reason means, in the reader's words rather than the
 * parser's.
 *
 * Kept as a table rather than a switch so that adding a reason to the model
 * without describing it here is a type error: a row whose reason has no
 * sentence is a row the reviewer cannot act on.
 */
export const PDF_REASON_TEXT = {
  DATE_AMBIGUOUS_ORDER: "Date order is ambiguous",
  DATE_YEAR_INFERRED_FROM_PERIOD: "Year was inferred from the statement period",
  DATE_INHERITED_FROM_PREVIOUS_ROW: "Date was inherited from the previous statement row",
  DATE_OUTSIDE_STATEMENT_PERIOD: "Date is outside the statement period",
  DATE_INVALID: "Date could not be read",
  AMOUNT_MULTIPLE_CANDIDATES: "More than one amount could apply",
  AMOUNT_DEBIT_CREDIT_CONFLICT: "Both money-out and money-in columns contain values",
  AMOUNT_FROM_MAPPED_COLUMN: "Amount came from the mapped column",
  AMOUNT_FORMAT_AMBIGUOUS: "Number format is ambiguous",
  AMOUNT_MISSING: "Amount is missing",
  AMOUNT_ZERO: "Amount must not be zero",
  CURRENCY_AMBIGUOUS: "Currency is not confirmed",
  CURRENCY_MINOR_UNIT_MISMATCH: "Amount precision does not match the currency",
  ACTUAL_PRECISION_UNSUPPORTED: "Actual cannot import this amount without losing decimal precision",
  DIRECTION_FROM_DEBIT_COLUMN: "Direction came from the money-out column",
  DIRECTION_FROM_CREDIT_COLUMN: "Direction came from the money-in column",
  DIRECTION_FROM_MARKER: "Direction came from a DR/CR marker",
  DIRECTION_FROM_SIGN: "Direction came from the printed sign",
  SIGN_CONVENTION_UNCONFIRMED: "Confirm whether the statement prints signs from your side or the card issuer's side",
  DIRECTION_FROM_BALANCE: "Direction came from the balance change",
  ACCOUNT_TYPE_UNCONFIRMED: "Confirm the account type: the balance column was read using a detected type",
  DIRECTION_FROM_SECTION: "Direction came from the statement section",
  DIRECTION_EXPLICIT_POLICY: "Direction follows your unsigned-amount policy",
  DIRECTION_FROM_MARKER_CONVENTION: "Unmarked amounts were read as the opposite of the statement's own CR or DR markers",
  DIRECTION_UNRESOLVED: "Money in or money out is unresolved",
  DIRECTION_EVIDENCE_CONFLICT: "Printed direction evidence conflicts",
  BALANCE_RECONCILED: "Amount reconciles to the running balance",
  BALANCE_MISMATCH: "Amount does not reconcile to the running balance",
  ROW_CONTINUATION_UNCERTAIN: "Transaction grouping needs confirmation",
  ROW_IN_NON_TRANSACTION_SECTION: "Row may be outside the transaction table",
  ROW_MANUALLY_CHANGED: "Manually changed",
  PROFILE_LAYOUT_DRIFT: "Saved layout no longer aligns",
  PAGE_IMAGE_ONLY: "Page has no usable text",
  POSSIBLE_DUPLICATE: "Possible duplicate",
  STATEMENT_SUMMARY_MISMATCH: "Parsed totals do not match the statement summary",
  CROSS_PAGE_SEQUENCE_CHANGED: "Date order changes across pages",
  ACCOUNT_TYPE_SPECIALIZED: "This account type needs specialized review",
  DESCRIPTION_MISSING: "Description is missing",
} satisfies Record<PdfConfidenceReason, string>;

export function reasonText(reasons: PdfConfidenceReason[]) {
  return reasons.map((reason) => PDF_REASON_TEXT[reason]).join("; ");
}

/**
 * Reasons that explain how a value was read rather than asking the reviewer
 * for something. They are not grounds for offering the same correction to
 * other rows, and they are not what a row is waiting on.
 */
const EXPLANATORY_REASONS: PdfConfidenceReason[] = [
  "AMOUNT_FROM_MAPPED_COLUMN",
  "DIRECTION_FROM_DEBIT_COLUMN",
  "DIRECTION_FROM_CREDIT_COLUMN",
  "DIRECTION_FROM_MARKER",
  "DIRECTION_FROM_SIGN",
  "DIRECTION_FROM_BALANCE",
  "DIRECTION_FROM_SECTION",
  "DIRECTION_EXPLICIT_POLICY",
  "DIRECTION_FROM_MARKER_CONVENTION",
  "BALANCE_RECONCILED",
  "ROW_MANUALLY_CHANGED",
];

export function isActionableReason(reason: PdfConfidenceReason) {
  return !EXPLANATORY_REASONS.includes(reason);
}

/**
 * The single sentence a row is waiting on, for the caption under a row that is
 * not ready. The full list stays available on the status chip; what belongs in
 * the table is the first thing to do about it.
 */
export function primaryReasonText(reasons: PdfConfidenceReason[]) {
  const actionable = reasons.filter(isActionableReason);
  return actionable.length ? PDF_REASON_TEXT[actionable[0]] : null;
}
