import type {
  PdfConfidenceReason,
  PdfConfidenceStatus,
  PdfTransactionProposal,
} from "@/lib/reconciliation/statement/pdf";

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
  CURRENCY_AMBIGUOUS: "This row prints a different currency, so it may be the original amount rather than the amount charged to the account",
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

export type PdfRowReasons = {
  /** Reasons that stop the row being imported at all. */
  blocking: PdfConfidenceReason[];
  /** Reasons that ask the reader to look. */
  attention: PdfConfidenceReason[];
  /** How a value was read, which is context rather than a problem. */
  evidence: PdfConfidenceReason[];
  /** The one sentence worth the row's own line. */
  primary: string | null;
  /** How many reasons that line is standing in front of. */
  extraCount: number;
};

/**
 * What a row is waiting on, in the order it matters.
 *
 * Severity is taken from the row itself rather than from a second table of
 * which reasons are serious: each reason sits on a field, and that field
 * already carries the status the parser gave it. A list built from a private
 * ranking would drift from the parser's the first time a rule changed.
 *
 * Ordering matters because only one reason gets the row's own line. Taking the
 * first reason in the list meant taking whichever validator happened to run
 * first, so a row blocked on a missing amount could spend its one line saying
 * its date was inherited.
 */
export function groupRowReasons(row: PdfTransactionProposal): PdfRowReasons {
  const statuses = new Map<PdfConfidenceReason, PdfConfidenceStatus>();
  for (const field of Object.values(row.confidence)) {
    for (const confidence of field == null ? [] : Array.isArray(field) ? field : [field]) {
      for (const reason of confidence.reasons) {
        // A reason carried by two fields takes the worse of the two.
        const current = statuses.get(reason);
        if (!current || rank(confidence.status) > rank(current)) statuses.set(reason, confidence.status);
      }
    }
  }

  const blocking: PdfConfidenceReason[] = [];
  const attention: PdfConfidenceReason[] = [];
  const evidence: PdfConfidenceReason[] = [];
  for (const reason of row.issueCodes) {
    if (!isActionableReason(reason)) evidence.push(reason);
    else if (statuses.get(reason) === "rejected") blocking.push(reason);
    else attention.push(reason);
  }

  const ordered = [...blocking, ...attention];
  return {
    blocking,
    attention,
    evidence,
    primary: ordered.length ? PDF_REASON_TEXT[ordered[0]] : null,
    extraCount: Math.max(0, ordered.length - 1) + evidence.length,
  };
}

function rank(status: PdfConfidenceStatus) {
  return status === "rejected" ? 2 : status === "review" ? 1 : 0;
}
