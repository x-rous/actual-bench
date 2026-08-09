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
 * Score one candidate pair. The caller guarantees the amounts are equal and the
 * date is inside the window (see `amountDateSlice`).
 */
export function scoreCandidate(
  row: StatementRow,
  transaction: ActualTransactionSnapshot,
  config: MatchConfig,
  index: ActualIndex
): ScoredCandidate {
  const reasons: MatchReason[] = [{ kind: "amount", verdict: "exact" }];
  let score = POINTS.amountExact;

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
