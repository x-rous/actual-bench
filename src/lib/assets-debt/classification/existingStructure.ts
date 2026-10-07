import type { MatchCandidate } from "@/lib/financial-models/matching";

export type ExistingStructureInput = {
  candidate: MatchCandidate;
  lenderPattern: "embedded-interest" | "separate-interest";
  rowRole: "payment" | "lender-row";
  ambiguous?: boolean;
  overrideAmbiguity?: boolean;
};

export type ExistingStructureDecision = {
  classification: "safe" | "review" | "blocked";
  disposition: "link" | "restructure" | "evidence-only" | "manual-review";
  reasons: string[];
  replacedCategoryId: string | null;
  mayOverride: boolean;
  mayBeCounterpart: boolean;
};

/**
 * Classify an already-existing Actual row before any later posting planner may
 * propose changing it. P1.4 calls this read-only; the disposition is evidence
 * for P1.6 and never executes a mutation here.
 */
export function classifyExistingStructure(input: ExistingStructureInput): ExistingStructureDecision {
  const { candidate } = input;
  const base = { replacedCategoryId: candidate.categoryId, mayOverride: false, mayBeCounterpart: true };

  if (candidate.reconciled === true) {
    return {
      ...base,
      classification: "blocked",
      disposition: "evidence-only",
      reasons: [input.rowRole === "lender-row" ? "reconciled-lender-row-never-counterpart" : "reconciled-row-read-only"],
      mayBeCounterpart: false,
    };
  }
  if ((candidate.parentId !== null && candidate.isChild !== true) || (candidate.isChild === true && candidate.parentId === null)) {
    return { ...base, classification: "blocked", disposition: "manual-review", reasons: ["missing-split-child-structure"], mayBeCounterpart: false };
  }
  if (input.ambiguous) {
    return input.overrideAmbiguity
      ? { ...base, classification: "review", disposition: "manual-review", reasons: ["ambiguity-overridden-for-this-row"], mayOverride: true }
      : { ...base, classification: "blocked", disposition: "manual-review", reasons: ["ambiguous-existing-structure"], mayOverride: true };
  }
  if (candidate.isParent) {
    return { ...base, classification: "blocked", disposition: "manual-review", reasons: ["split-parent-unclaimable"], mayOverride: true };
  }
  if (candidate.isChild) {
    return { ...base, classification: "review", disposition: "link", reasons: ["existing-split-child"], mayOverride: false };
  }
  if (candidate.transferId) {
    return input.lenderPattern === "separate-interest"
      ? { ...base, classification: "safe", disposition: "link", reasons: ["existing-full-transfer"] }
      : { ...base, classification: "review", disposition: "restructure", reasons: ["embedded-interest-transfer-needs-split"] };
  }
  if (candidate.categoryId) {
    return { ...base, classification: "review", disposition: "restructure", reasons: ["user-category-would-be-replaced"] };
  }
  return { ...base, classification: "review", disposition: "restructure", reasons: ["uncategorized-existing-payment"] };
}
