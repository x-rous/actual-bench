import type { Rule, ConditionOrAction } from "@/types/entities";

/**
 * Strict-shadow detection within a stage. Conservative by design:
 * false positives on shadow findings are worse than misses (the user
 * cannot easily verify the claim), so this algorithm only flags pairs
 * where the shadowing rule's match set is a superset of the shadowed
 * rule's match set AND its action set writes every field the shadowed
 * rule would write.
 *
 * Scope restrictions (v1):
 *   - Only `and`-combined rules on both sides (or-combined reasoning is out of scope).
 *   - Schedule-linked rules (any action with op "link-schedule") are skipped.
 *   - An unconditional `delete-transaction` earlier rule shadows any later rule
 *     in the same stage whose match set it covers (delete-transaction is always dominant).
 */

type EarlierNarrowerMatch = {
  earlier: ConditionOrAction;
  later: ConditionOrAction;
};

function isScheduleLinked(rule: Rule): boolean {
  return rule.actions.some((a) => a.op === "link-schedule");
}

function isDeleteTransaction(action: ConditionOrAction): boolean {
  return action.op === "delete-transaction";
}

function sameField(a: ConditionOrAction, b: ConditionOrAction): boolean {
  return a.field != null && a.field === b.field;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A earlier-condition A is narrower-or-equal to later-condition B when
 *  every transaction matching B also matches A (so B is at least as narrow as A
 *  on this dimension). */
function earlierCoversLater(a: ConditionOrAction, b: ConditionOrAction): boolean {
  if (!sameField(a, b)) return false;

  // Same op, equal value → A equals B on this dimension.
  if (a.op === b.op && jsonEqual(a.value, b.value)) return true;

  // contains "X" covers contains "Y" when Y contains X (Y is a stricter substring).
  if (
    (a.op === "contains" || a.op === "doesNotContain") &&
    a.op === b.op &&
    typeof a.value === "string" &&
    typeof b.value === "string"
  ) {
    if (a.op === "contains") return b.value.includes(a.value);
    // For doesNotContain: "doesNotContain X" covers "doesNotContain Y" only when
    // Y is a substring of X — every string lacking X also lacks Y, but not vice versa.
    return a.value.includes(b.value);
  }

  // oneOf [a,b,c] covers oneOf [subset] when laterSet ⊆ earlierSet.
  if (a.op === "oneOf" && b.op === "oneOf" && Array.isArray(a.value) && Array.isArray(b.value)) {
    const earlier = new Set(a.value);
    return b.value.every((v) => earlier.has(v));
  }

  // oneOf covers `is X` when X ∈ earlierSet.
  if (a.op === "oneOf" && b.op === "is" && Array.isArray(a.value)) {
    return a.value.includes(b.value as string);
  }

  return false;
}

/** Every condition in earlier must be covered by some condition in later. */
function conditionCoverageHolds(earlier: Rule, later: Rule): boolean {
  for (const ec of earlier.conditions) {
    const covered = later.conditions.some((lc) => earlierCoversLater(ec, lc));
    if (!covered) return false;
  }
  return true;
}

function actionsDominate(earlier: Rule, later: Rule): boolean {
  if (earlier.actions.length === 0) return false;
  // Delete-transaction is always dominant.
  if (earlier.actions.some(isDeleteTransaction)) return true;

  // For every action the later rule performs, the earlier rule must perform
  // an equivalent one — same op, same field, same value. A different op
  // (e.g. set vs prepend-notes) or a different value (e.g. set category="A"
  // vs set category="B") means the later rule is NOT redundant: it changes
  // the result in a way the earlier rule does not.
  for (const la of later.actions) {
    if (la.op === "link-schedule") continue;
    if (la.op === "delete-transaction") {
      if (!earlier.actions.some(isDeleteTransaction)) return false;
      continue;
    }
    if (!la.field) return false;
    const writtenByEarlier = earlier.actions.some(
      (ea) =>
        ea.op === la.op &&
        ea.field === la.field &&
        jsonEqual(ea.value, la.value)
    );
    if (!writtenByEarlier) return false;
  }
  return true;
}

export function findShadowedPairs(rulesInStage: Rule[]): Array<{
  shadowed: Rule;
  shadowing: Rule;
}> {
  const results: Array<{ shadowed: Rule; shadowing: Rule }> = [];

  // Only and-combined rules participate in v1 shadow detection.
  const candidates = rulesInStage.filter(
    (r) => r.conditionsOp === "and" && !isScheduleLinked(r)
  );

  for (let i = 0; i < candidates.length; i++) {
    const earlier = candidates[i];
    for (let j = i + 1; j < candidates.length; j++) {
      const later = candidates[j];
      // Unconditional earlier rule with delete-transaction dominates regardless of conditions.
      if (earlier.conditions.length === 0 && earlier.actions.some(isDeleteTransaction)) {
        results.push({ shadowed: later, shadowing: earlier });
        continue;
      }
      if (!conditionCoverageHolds(earlier, later)) continue;
      if (!actionsDominate(earlier, later)) continue;
      results.push({ shadowed: later, shadowing: earlier });
    }
  }

  return results;
}

// Exposed for tests — signals the algorithm intentionally skipped a pair.
export const __internal = { earlierCoversLater, conditionCoverageHolds, actionsDominate };

// Suppress unused-variable warning for the test-only internal handle in some lint configs.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EarlierNarrowerMatch = EarlierNarrowerMatch;
