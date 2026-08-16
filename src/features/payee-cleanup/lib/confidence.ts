/**
 * Cluster confidence (RD-078 §7).
 *
 * Confidence is derived from evidence, never assigned by a detector directly,
 * so a proposal's score and its explanation cannot disagree. Every adjustment
 * returns a reason string; the UI shows those reasons rather than the number
 * alone.
 *
 * Deliberately extensible: 041c and 041f will pass rule conflicts, behavior
 * conflicts and backtest results in through `signals`. Until then those signals
 * are simply absent and the score reflects name evidence only.
 */

import { deriveForms, looksHumanReadable } from "./derivedForms";
import type { PayeeCluster } from "./clusterResolver";

export type ConfidenceBand = "high" | "strong" | "review" | "hidden";

export type ConfidenceSignals = {
  /** 041c: members disagree on favorite / learn_categories. */
  behaviorConflict?: boolean;
  /** 041c: a member is referenced by rules that resolve payees differently. */
  ruleConflict?: boolean;
  /** 041f: the proposed rule's backtest caught unrelated historical text. */
  unexpectedBacktestMatches?: number;
};

export type ConfidenceReason = {
  delta: number;
  reason: string;
};

export type ConfidenceResult = {
  score: number;
  band: ConfidenceBand;
  reasons: ConfidenceReason[];
};

/**
 * Band thresholds from RD-078 §7. `hidden` proposals are computed but not shown
 * by default — they still exist so a user can widen the filter rather than
 * wonder why an obvious pair is missing.
 */
export function bandFor(score: number): ConfidenceBand {
  if (score >= 95) return "high";
  if (score >= 80) return "strong";
  if (score >= 60) return "review";
  return "hidden";
}

/**
 * Evidence labels already read as "Removed the card number", so pasting one
 * into "after removing …" produced "after removing removed the card number".
 */
function describeLabel(label: string): string {
  return label.replace(/^removed\s+/i, "").toLowerCase();
}

export function computeConfidence(
  cluster: PayeeCluster,
  signals: ConfidenceSignals = {}
): ConfidenceResult {
  const reasons: ConfidenceReason[] = [];
  let score: number;

  if (cluster.fuzzyOnly) {
    // §7.2: fuzzy similarity alone is the weakest possible basis. Start below
    // the review line so a fuzzy pair can only surface for review, never as an
    // auto-selectable high-confidence proposal.
    const similarity = cluster.evidence[0]?.similarity ?? 0;
    score = Math.round(45 + similarity * 20);
    reasons.push({
      delta: 0,
      reason: "Similar spelling only — no structural evidence",
    });
  } else {
    const structural = cluster.evidence.filter((e) => e.kind === "structural");
    const contextual = cluster.evidence.filter((e) => e.kind === "contextual");

    if (structural.length > 0) {
      score = 90;
      reasons.push({
        delta: 0,
        reason: `Names match exactly once this is removed: ${describeLabel(structural[0].label)}`,
      });
    } else {
      // Contextual only: a plausible transform, not a certainty.
      score = 68;
      reasons.push({
        delta: 0,
        reason: `Names match only after an interpreted change: ${describeLabel(
          contextual[0]?.label ?? "contextual"
        )}`,
      });
    }

    // Distinct detectors, not evidence entries. Counting entries produced
    // "17 independent detectors agree" for a cluster that had three.
    const distinctDetectors = new Set(structural.map((e) => e.detectorId)).size;
    if (distinctDetectors > 1) {
      score += 6;
      reasons.push({
        delta: 6,
        reason: `${distinctDetectors} independent detectors agree`,
      });
    }

    // §7.1 "repeated machine suffix pattern": one payee with a trailing number
    // could be a coincidence, but three or more sharing the same generated
    // shape is the pattern itself showing up in the data.
    const repeated = structural.find((e) => (e.memberCount ?? 0) >= 3);
    if (repeated) {
      score += 4;
      reasons.push({
        delta: 4,
        reason: `The same pattern repeats across ${repeated.memberCount} payees`,
      });
    }

    // §7.1: a clean human-readable member is both a strong signal that the
    // cluster is real and an obvious merge target.
    if (cluster.members.some((m) => looksHumanReadable(deriveForms(m.name)))) {
      score += 4;
      reasons.push({
        delta: 4,
        reason: "A clean, human-readable payee already exists in this group",
      });
    }

    // §7.2: an interpreted reduction (a company suffix, or text inferred from
    // the rest of the budget) is a reason to look closer.
    if (structural.length === 0 && contextual.length > 0) {
      score -= 6;
      reasons.push({
        delta: -6,
        reason: "These match only after an interpreted change — worth a look",
      });
    }
  }

  if (signals.behaviorConflict) {
    score -= 5;
    reasons.push({
      delta: -5,
      reason: "Members disagree on Favorite or Category learning",
    });
  }

  if (signals.ruleConflict) {
    score -= 10;
    reasons.push({
      delta: -10,
      reason: "An existing rule resolves one of these payees differently",
    });
  }

  if (signals.unexpectedBacktestMatches && signals.unexpectedBacktestMatches > 0) {
    score -= 12;
    reasons.push({
      delta: -12,
      reason: `Pattern also matches ${signals.unexpectedBacktestMatches} unrelated historical transactions`,
    });
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clamped, band: bandFor(clamped), reasons };
}
