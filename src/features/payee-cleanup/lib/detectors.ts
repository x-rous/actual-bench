/**
 * Payee variant detectors (RD-078 §5.2, §5.3).
 *
 * Every detector answers one question: *after removing one specific class of
 * noise, do these names become the same thing?* The removed text is the
 * evidence, which is why detectors return a stem plus a description rather than
 * a bare boolean — a proposal the user cannot interrogate is a proposal they
 * cannot safely accept.
 *
 * Two families, and the difference matters to the cluster resolver:
 *
 * - **structural** — a deterministic transform collapses the names to an
 *   identical stem. Strong enough to form a group.
 * - **contextual** — a plausible but interpretive transform (legal suffixes,
 *   location fragments). Lower confidence; forms a group but lands in review.
 *
 * Fuzzy similarity lives in `fuzzy.ts` and is neither: it is evidence only and
 * can never chain payees together.
 */

import { deriveForms, type PayeeDerivedForms } from "./derivedForms";
import { reduceFully, type ReductionResult } from "./reduce";
import type { CorpusAffix } from "./corpusAffixes";
import type { PayeeCleanupCandidate } from "../types";

export type DetectorId =
  | "case-only"
  | "whitespace-only"
  | "punctuation"
  | "full-reduction";

export type EvidenceKind = "structural" | "contextual" | "fuzzy";

export type DetectorResult = {
  /**
   * The shared stem this detector reduced the name to. Two payees group when
   * their stems are equal *and* non-trivial.
   */
  stem: string;
  /** What was removed, for the evidence line shown to the user. */
  removed: string;
};

export type Detector = {
  id: DetectorId;
  kind: EvidenceKind;
  /** Shown as the cluster's evidence, e.g. "Variable 4-digit store number". */
  label: string;
  /**
   * Returns null when the detector does not apply to this name. Returning a
   * stem equal to the input contributes nothing and is treated as no-match.
   */
  reduce(forms: PayeeDerivedForms): DetectorResult | null;
};

/**
 * A stem shorter than this is too generic to group on — collapsing to `A` or
 * `THE` would sweep unrelated merchants together.
 */
const MIN_STEM_LENGTH = 3;

// ─── Identity detectors ──────────────────────────────────────────────────────

/**
 * `AMAZON` / `Amazon` / `amazon` — identical once case is ignored.
 * The stem is the case-folded name itself, so equality *is* the grouping.
 */
const caseOnly: Detector = {
  id: "case-only",
  kind: "structural",
  label: "Same name, different capitalization",
  reduce: (forms) =>
    forms.caseFolded.length >= MIN_STEM_LENGTH
      ? { stem: forms.caseFolded, removed: "" }
      : null,
};

/** `WOOLWORTHS` vs `WOOLWORTHS  ` / `WOOL  WORTHS` — whitespace only. */
const whitespaceOnly: Detector = {
  id: "whitespace-only",
  kind: "structural",
  label: "Same name, different spacing",
  reduce: (forms) =>
    forms.collapsedWhitespace.length >= MIN_STEM_LENGTH
      ? { stem: forms.collapsedWhitespace, removed: "" }
      : null,
};

/** `AMAZON.COM` vs `AMAZON COM` — punctuation only. */
const punctuation: Detector = {
  id: "punctuation",
  kind: "structural",
  label: "Same name, different punctuation",
  reduce: (forms) =>
    forms.punctuationNormalized.length >= MIN_STEM_LENGTH
      ? { stem: forms.punctuationNormalized, removed: "" }
      : null,
};
/**
 * Only the **identity** detectors remain here.
 *
 * They normalize a name without removing meaning, so they produce the same stem
 * for every member of a cluster — and they are what lets an already-clean payee
 * join its noisy variants, since the pipeline leaves such a name untouched and
 * emits no reduction hit for it.
 *
 * Everything that *removes* noise now lives in `reduce.ts`, applied composably.
 * Single-pass versions used to run alongside it and were actively harmful: each
 * member reduced to a slightly different stem (the dates differ), so a
 * three-member cluster reported seven pieces of evidence, none of which was the
 * stem that actually grouped it, and confidence claimed "17 independent
 * detectors agree".
 */
export const DETECTORS: Detector[] = [caseOnly, whitespaceOnly, punctuation];

export type DetectorHit = {
  detectorId: DetectorId;
  kind: EvidenceKind;
  label: string;
  stem: string;
  removed: string;
};

/** Runs every detector over one payee, returning each one that applied. */
export function runDetectors(forms: PayeeDerivedForms): DetectorHit[] {
  const hits: DetectorHit[] = [];
  for (const detector of DETECTORS) {
    const result = detector.reduce(forms);
    if (!result) continue;
    hits.push({
      detectorId: detector.id,
      kind: detector.kind,
      label: detector.label,
      stem: result.stem,
      removed: result.removed,
    });
  }
  return hits;
}

export type DetectedPayee = {
  candidate: PayeeCleanupCandidate;
  forms: PayeeDerivedForms;
  hits: DetectorHit[];
  /** The composed reduction — see `reduce.ts`. */
  reduction: ReductionResult;
};

/**
 * The composed pipeline, surfaced as one more detector hit so the cluster
 * resolver can group on its stem alongside the single-pass detectors.
 *
 * Reported as `contextual` when any interpretive step fired (a location or a
 * company suffix was removed), so those clusters land in review rather than
 * claiming the certainty of a purely structural match.
 */
function reductionHit(reduction: ReductionResult): DetectorHit | null {
  if (reduction.steps.length === 0) return null;

  const contextual = reduction.steps.some((s) => s.contextual);
  const labels = [...new Set(reduction.steps.map((s) => s.label))];

  return {
    detectorId: "full-reduction",
    kind: contextual ? "contextual" : "structural",
    label: `Removed ${labels.join(", ").toLowerCase()}`,
    stem: reduction.stem,
    removed: reduction.steps.map((s) => s.removed).join(" · "),
  };
}

export function detectAll(
  candidates: PayeeCleanupCandidate[],
  affixes: CorpusAffix[] = []
): DetectedPayee[] {
  return candidates.map((candidate) => {
    const forms = deriveForms(candidate.name);
    const reduction = reduceFully(candidate.name, affixes);
    const hits = runDetectors(forms);

    const reduced = reductionHit(reduction);
    // Only add it when it says something the single-pass detectors did not.
    if (reduced && !hits.some((h) => h.stem === reduced.stem)) {
      hits.push(reduced);
    }

    // The structural-only stem, when the full reduction needed an interpretive
    // step to get further. Two payees that already match here differ only in
    // noise we are certain about, so the cluster earns structural confidence.
    if (
      reduction.structuralStem !== reduction.stem &&
      !hits.some((h) => h.stem === reduction.structuralStem)
    ) {
      hits.push({
        detectorId: "full-reduction",
        kind: "structural",
        label: `Removed ${[
          ...new Set(reduction.steps.filter((s) => !s.contextual).map((s) => s.label)),
        ]
          .join(", ")
          .toLowerCase()}`,
        stem: reduction.structuralStem,
        removed: reduction.steps
          .filter((s) => !s.contextual)
          .map((s) => s.removed)
          .join(" · "),
      });
    }

    return { candidate, forms, hits, reduction };
  });
}
