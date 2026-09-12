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
import { statementText } from "../statement/text";
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
  /**
   * Awarded to a *review* pair by how close its amounts are, on the scale from
   * identical to the widest gap the config will admit.
   *
   * Not part of the automatic tiers, which require the amounts to be equal and
   * award `amountExact` for it. This tier used to score text and date only, on
   * the reasoning that "there is no amount evidence to award points for" — but
   * that conflates *no agreement* with *no information*. Three `CAREEM RIDE`
   * rows competing for one -9.74 transaction scored 50, 50 and 45 while their
   * gaps were 3.8%, 20.0% and 12.5%: the true pairing, at the same conversion
   * rate as the rest of the statement, ranked no higher than a row five times
   * further away. Closeness is the strongest thing left once exactness is gone.
   */
  amountProximity: 25,
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
    statementText(row),
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

  // Ranked by how close the amounts are, as well as by text and date. The gap
  // is already known to be inside `amountMismatchMaxRatio`, so it scales across
  // that range: identical-but-for-rounding scores near full, a pair at the
  // limit scores nothing.
  const proximity = 1 - gap / larger / config.amountMismatchMaxRatio;
  const score = Math.round(
    text.similarity * POINTS.text +
      datePoints(delta) +
      Math.max(0, proximity) * POINTS.amountProximity
  );
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
 * Score a leftover pairing: same merchant, same date, amounts unrelated.
 *
 * The amounts are not a condition here — this tier exists for rows where they
 * carry no information — so the score rests on text and date, plus a flat award
 * where the two amounts happen to agree exactly. The label is always `low`:
 * whatever it scores, this is never an automatic match.
 *
 * Returns null when the text is not convincing enough to call them the same
 * merchant.
 */
export function scoreSameMerchantCandidate(
  row: StatementRow,
  transaction: ActualTransactionSnapshot,
  config: MatchConfig,
  index: ActualIndex
): ScoredCandidate | null {
  const delta = dayDelta(row.postedDate, transaction.date);
  if (Math.abs(delta) > config.clusterDateToleranceDays) return null;
  if (Math.sign(transaction.amount) !== Math.sign(row.amount)) return null;

  const text = scoreText(
    statementText(row),
    {
      payeeName: transaction.payeeName,
      importedPayee: transaction.importedPayee,
      notes: transaction.notes,
    },
    config.text,
    config.needleFloor,
    index.notesCorpus
  );
  if (text.similarity === null || text.similarity < config.clusterTextFloor) return null;

  /*
   * This tier admits a pair whatever its amounts, including equal ones — it is
   * reached by rows the assignment left over, and a leftover pair can agree on
   * the amount and still have failed to match for some other reason.
   *
   * Where they do agree, saying so is the point: reporting `-4.98` against
   * `-4.98` as an amount mismatch of zero is a statement the screen then repeats
   * as "amount looks wrong", about two figures that are identical.
   */
  const amountsAgree = transaction.amount === row.amount;

  return {
    statementRowId: row.id,
    actualTransactionId: transaction.id,
    score: Math.round(
      text.similarity * POINTS.text +
        datePoints(delta) +
        (amountsAgree ? POINTS.amountProximity : 0)
    ),
    label: "low",
    tier: "same-merchant-date-review",
    reasons: [
      amountsAgree
        ? { kind: "amount", verdict: "exact" }
        : {
            kind: "amount-mismatch",
            statementAmount: row.amount,
            actualAmount: transaction.amount,
            difference: transaction.amount - row.amount,
          },
      { kind: "date", deltaDays: delta },
      ...text.reasons,
    ],
  };
}

/**
 * Score one candidate pair, or reject it outright.
 *
 * Returns null when the pair is not worth showing at all. That matters for
 * original-currency candidates: a `VAT ON SERVICE CHARGES SAR41.00` fee row
 * shares its printed original amount with an unrelated SAR41.00 purchase, so
 * without a rejection it would be offered as a possible match for a merchant it
 * has nothing to do with. Scoring it zero was not enough — a zero-scored
 * candidate is still a candidate, and still appeared in the list.
 */
export function scoreCandidate(
  row: StatementRow,
  transaction: ActualTransactionSnapshot,
  config: MatchConfig,
  index: ActualIndex
): ScoredCandidate | null {
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

  if (referenceAppearsInNotes(row.bankReference, transaction.notes)) {
    reasons.push({ kind: "reference", where: "notes" });
    tier = "reference-in-notes";
    // A verbatim reference hit is stronger than any text similarity, so it takes
    // the full text budget rather than competing with it.
    score += POINTS.text;
  } else {
    const text = scoreText(
      statementText(row),
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
    // is the only thing tying these two rows together. Without it the pair is
    // a coincidence of arithmetic and is discarded rather than ranked low.
    if (strongestTextSimilarity(reasons) < ORIGINAL_AMOUNT_TEXT_FLOOR) return null;
    tier = "original-amount-text";
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
