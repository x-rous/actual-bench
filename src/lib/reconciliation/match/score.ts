/**
 * Candidate scoring (RD-071 §5.3).
 *
 * A score is a deterministic function of amount, date distance, and text
 * evidence, and it always ships the structured `MatchReason[]` that produced it
 * — the score must be explainable (feature spec §6, §14), so no signal may
 * influence the number without also emitting a reason.
 */

import type {
  ActualTransactionSnapshot,
  ConfidenceLabel,
  MatchConfig,
  MatchReason,
  MatchTier,
  ScoredCandidate,
  StatementRow,
} from "../types";
import type { ActualIndex } from "./actualIndex";
import { containmentSimilarity, normalizeForCompare, scoreText } from "./text";

/**
 * Point budget, summing to 100.
 *
 * Amount carries the largest share because it is a *required* condition — a
 * pair only exists if the amounts are exactly equal — and the remaining points
 * distinguish good pairs from plausible ones.
 */
const POINTS = {
  amountExact: 50,
  dateSameDay: 25,
  dateWithin1: 20,
  dateWithin3: 14,
  dateWithin7: 7,
  text: 25,
} as const;

/** Text similarity at or above this promotes a pair to the amount+date+text tier. */
const STRONG_TEXT = 0.7;

/**
 * An original-currency match is corroboration-gated: the posted amount does not
 * agree, so text has to carry the pair. Without this, a `VAT ON SERVICE CHARGES
 * SAR122.94` fee row — which repeats the *purchase's* original amount in its own
 * description — could claim the purchase's transaction.
 */
const ORIGINAL_AMOUNT_TEXT_FLOOR = 0.6;

/** Points withheld from an original-currency match, so a posted match outranks it. */
const ORIGINAL_AMOUNT_PENALTY = 12;

/** Score bands for the feature spec §14 labels. */
const LABEL_BANDS = { high: 85, medium: 65 } as const;

/** Whole days between two ISO `YYYY-MM-DD` dates, signed (`actual - statement`). */
export function dayDelta(statementDate: string, actualDate: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((Date.parse(actualDate) - Date.parse(statementDate)) / MS_PER_DAY);
}

function datePoints(delta: number): number {
  const distance = Math.abs(delta);
  if (distance === 0) return POINTS.dateSameDay;
  if (distance === 1) return POINTS.dateWithin1;
  if (distance <= 3) return POINTS.dateWithin3;
  if (distance <= 7) return POINTS.dateWithin7;
  return 0;
}

function strongestTextSimilarity(reasons: MatchReason[]): number {
  let best = 0;
  for (const reason of reasons) {
    if (reason.kind === "text" && reason.similarity > best) best = reason.similarity;
  }
  return best;
}

export function labelFor(score: number, tier: MatchTier): ConfidenceLabel {
  if (tier === "reference-imported-id") return "exact";
  if (score >= LABEL_BANDS.high) return "high";
  if (score >= LABEL_BANDS.medium) return "medium";
  return "low";
}

/**
 * True when the statement's bank reference appears verbatim inside the Actual
 * notes.
 *
 * For users whose transactions are created by SMS/n8n automation, the bank's
 * auth/reference number sits in the notes — effectively a poor man's
 * `imported_id`, and near-Tier-1 evidence (RD-071 §5.3 tier 2). Token-aligned,
 * so a short reference cannot match inside a longer number.
 */
export function referenceAppearsInNotes(
  reference: string | undefined,
  notes: string | null
): boolean {
  if (!reference || !notes) return false;
  const needle = normalizeForCompare(reference);
  // A very short reference is not evidence of anything.
  if (needle.replace(/\s/g, "").length < 4) return false;
  return containmentSimilarity(reference, notes) === 1;
}

/**
 * Score a pair whose text agrees but whose amounts do not.
 *
 * Returned for **review only** — `assignMatches` never promotes one of these to
 * a match, whatever it scores. The score exists solely to rank which mismatched
 * candidate to show first.
 *
 * Returns null when the text is not convincing enough, or the amounts are too
 * far apart to plausibly be the same transaction.
 */
export function scoreAmountMismatchCandidate(
  row: StatementRow,
  transaction: ActualTransactionSnapshot,
  config: MatchConfig,
  index: ActualIndex
): ScoredCandidate | null {
  if (transaction.amount === row.amount) return null;
  // Direction must agree: an outflow is never the same event as an inflow.
  if (Math.sign(transaction.amount) !== Math.sign(row.amount)) return null;

  const larger = Math.max(Math.abs(transaction.amount), Math.abs(row.amount));
  if (larger === 0) return null;
  const gap = Math.abs(Math.abs(transaction.amount) - Math.abs(row.amount));
  if (gap / larger > config.amountMismatchMaxRatio) return null;

  const text = scoreText(
    row.description,
    {
      payeeName: transaction.payeeName,
      importedPayee: transaction.importedPayee,
      notes: transaction.notes,
    },
    config.text,
    config.needleFloor,
    index.notesCorpus
  );
  if (text.similarity === null || text.similarity < config.amountMismatchTextFloor) return null;

  const delta = dayDelta(row.postedDate, transaction.date);
  const reasons: MatchReason[] = [
    {
      kind: "amount-mismatch",
      statementAmount: row.amount,
      actualAmount: transaction.amount,
      difference: transaction.amount - row.amount,
    },
    { kind: "date", deltaDays: delta },
    ...text.reasons,
  ];

  // Text and date only; there is no amount evidence to award points for.
  const score = Math.round(text.similarity * POINTS.text + datePoints(delta));
  return {
    statementRowId: row.id,
    actualTransactionId: transaction.id,
    score,
    label: "low",
    tier: "amount-mismatch-review",
    reasons,
  };
}

/**
 * Score one candidate pair. The caller guarantees the amounts are equal and the
 * date is inside the window (see `amountDateSlice`).
 */
export function scoreCandidate(
  row: StatementRow,
  transaction: ActualTransactionSnapshot,
  config: MatchConfig,
  index: ActualIndex
): ScoredCandidate {
  // The candidate was generated by an exact hit on one of the two amounts; work
  // out which, because an original-currency hit is weaker evidence.
  const viaOriginalAmount =
    transaction.amount !== row.amount &&
    row.originalAmount != null &&
    transaction.amount === row.originalAmount;

  const reasons: MatchReason[] = viaOriginalAmount
    ? [
        {
          kind: "original-amount",
          currency: row.originalCurrency ?? "",
          amount: row.originalAmount!,
          postedAmount: row.amount,
        },
      ]
    : [{ kind: "amount", verdict: "exact" }];
  let score = POINTS.amountExact - (viaOriginalAmount ? ORIGINAL_AMOUNT_PENALTY : 0);

  const delta = dayDelta(row.postedDate, transaction.date);
  reasons.push({ kind: "date", deltaDays: delta });
  score += datePoints(delta);

  let tier: MatchTier = "amount-date";

  if (referenceAppearsInNotes(row.reference, transaction.notes)) {
    reasons.push({ kind: "reference", where: "notes" });
    tier = "reference-in-notes";
    // A verbatim reference hit is stronger than any text similarity, so it takes
    // the full text budget rather than competing with it.
    score += POINTS.text;
  } else {
    const text = scoreText(
      row.description,
      {
        payeeName: transaction.payeeName,
        importedPayee: transaction.importedPayee,
        notes: transaction.notes,
      },
      config.text,
      config.needleFloor,
      index.notesCorpus
    );
    reasons.push(...text.reasons);
    if (text.similarity !== null) {
      score += text.similarity * POINTS.text;
      if (text.similarity >= STRONG_TEXT) tier = "amount-date-text";
    }
  }

  if (viaOriginalAmount) {
    // Text must corroborate: the posted amounts disagree, so the merchant text
    // is the only thing tying these two rows together.
    const similarity = strongestTextSimilarity(reasons);
    if (similarity < ORIGINAL_AMOUNT_TEXT_FLOOR) score = 0;
    else tier = "original-amount-text";
  }

  const rounded = Math.round(score);
  return {
    statementRowId: row.id,
    actualTransactionId: transaction.id,
    score: rounded,
    label: labelFor(rounded, tier),
    tier,
    reasons,
  };
}
