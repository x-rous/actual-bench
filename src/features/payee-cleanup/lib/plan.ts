/**
 * Turning accepted proposals into staged operations (RD-078 §20–§22).
 *
 * Three rules from the native-semantics verification govern everything here:
 *
 * - **Merge is Actual's operation, not ours.** The plan stages
 *   `mergePayees(targetId, mergeIds)` and lets Actual repoint `payee_mapping`
 *   and tombstone the sources. Bench never reassigns transactions or rewrites
 *   rules itself.
 * - **A transfer payee must never appear.** Actual's merge returns early and
 *   silently when the target is one, so a plan containing it would report
 *   success having changed nothing.
 * - **Rename before merge is equivalent to rename after.** The target survives
 *   the merge, and the existing save pipeline runs updates before merges — so
 *   the plan keeps that order and instead guarantees no rename ever names a
 *   payee that is inside some `mergeIds`.
 *
 * The plan is pure data. Validation runs over the whole graph rather than per
 * proposal, because the dangerous cases are all cross-proposal: the same payee
 * merged into two different targets, a rename aimed at a payee about to vanish,
 * a deletion of something another proposal keeps.
 */

import { isCleanupEligible } from "./eligibility";
import type { CleanupSuggestion } from "./scan";
import type { PayeeCleanupCandidate } from "../types";
import { compileRuleMatcher } from "./core";
import type { RuleGap } from "./ruleGaps";

export type MergeOperation = {
  kind: "merge-payees";
  targetId: string;
  mergeIds: string[];
  /** For the review screen. */
  targetName: string;
  memberNames: string[];
};

export type RenameOperation = {
  kind: "rename-payee";
  payeeId: string;
  from: string;
  to: string;
};

export type DeleteOperation = {
  kind: "delete-payee";
  payeeId: string;
  name: string;
};

export type CreateRuleOperation = {
  kind: "create-rule";
  /** The payee the rule will resolve to — always the surviving one. */
  targetPayeeId: string;
  targetName: string;
  field: "imported_payee" | "notes";
  op: "contains" | "matches" | "oneOf";
  /** A pattern for `contains`/`matches`; the exact texts for `oneOf`. */
  value: string | string[];
  description: string;
  expectedMatches: number;
};

/**
 * Adding texts to a payee's existing rename rule instead of creating a second
 * one — what Actual's own `updatePayeeRenameRule` does, and what keeps a budget
 * from accumulating one rule per merchant.
 */
export type ExtendRuleOperation = {
  kind: "extend-rule";
  ruleId: string;
  targetPayeeId: string;
  targetName: string;
  /** Only the texts that are new; the rule already covers the rest. */
  addTexts: string[];
  description: string;
};

export type CleanupOperation =
  | MergeOperation
  | RenameOperation
  | DeleteOperation
  | CreateRuleOperation
  | ExtendRuleOperation;

export type CleanupPlan = {
  merges: MergeOperation[];
  renames: RenameOperation[];
  deletions: DeleteOperation[];
  rules: CreateRuleOperation[];
  ruleExtensions: ExtendRuleOperation[];
};

export type PlanProblem = {
  severity: "blocking" | "warning";
  message: string;
  payeeIds: string[];
};

export const EMPTY_PLAN: CleanupPlan = {
  merges: [],
  renames: [],
  deletions: [],
  rules: [],
  ruleExtensions: [],
};

/**
 * Builds the plan from the proposals the user accepted.
 *
 * A rename is emitted only when the surviving payee's name actually differs
 * from the chosen final name — renaming a payee to what it is already called is
 * a write with no effect, and it would show up in the review screen as work the
 * user did not ask for.
 */
export function buildPlan(
  suggestions: CleanupSuggestion[],
  orphansToDelete: PayeeCleanupCandidate[] = [],
  /** Rule gaps the user opted in to on the "Needs a rule" tab (RD-087). */
  ruleGaps: RuleGap[] = []
): CleanupPlan {
  const merges: MergeOperation[] = [];
  const renames: RenameOperation[] = [];
  const rules: CreateRuleOperation[] = [];
  const ruleExtensions: ExtendRuleOperation[] = [];

  for (const suggestion of suggestions) {
    if (suggestion.correction.decision !== "accepted") continue;

    const target = suggestion.cluster.members.find(
      (m) => m.id === suggestion.target.targetId
    );
    if (!target) continue;

    const mergeIds = suggestion.membersToMerge.map((m) => m.id);
    if (mergeIds.length > 0) {
      merges.push({
        kind: "merge-payees",
        targetId: target.id,
        mergeIds,
        targetName: target.name,
        memberNames: suggestion.membersToMerge.map((m) => m.name),
      });
    }

    // A rule is only ever created for a proposal whose rule the user opted into.
    const recommended = suggestion.futureResolution?.recommended;
    if (suggestion.correction.createRule && recommended) {
      rules.push({
        kind: "create-rule",
        targetPayeeId: target.id,
        targetName: target.name,
        field: recommended.candidate.field,
        op: recommended.candidate.op,
        value: recommended.candidate.value,
        description: recommended.candidate.description,
        expectedMatches: recommended.expectedMatches,
      });
    }

    const finalName = suggestion.canonicalName.trim();
    if (finalName && finalName !== target.name) {
      renames.push({
        kind: "rename-payee",
        payeeId: target.id,
        from: target.name,
        to: finalName,
      });
    }
  }

  for (const gap of ruleGaps) {
    const { proposal } = gap;
    if (proposal.shape === "one-of" && proposal.extendsRule) {
      // Adding to the payee's own rename rule, exactly as Actual does, so the
      // budget does not accumulate a second rule for the same merchant.
      ruleExtensions.push({
        kind: "extend-rule",
        ruleId: proposal.extendsRule.id,
        targetPayeeId: gap.payee.id,
        targetName: gap.payee.name,
        addTexts: proposal.texts,
        description: `add ${proposal.texts.length} ${
          proposal.texts.length === 1 ? "text" : "texts"
        } to the existing rule`,
      });
      continue;
    }

    rules.push(
      proposal.shape === "one-of"
        ? {
            kind: "create-rule",
            targetPayeeId: gap.payee.id,
            targetName: gap.payee.name,
            field: proposal.field,
            op: "oneOf",
            value: proposal.texts,
            description: `is ${proposal.texts.map((t) => `"${t}"`).join(" or ")}`,
            expectedMatches: gap.transactionCount,
          }
        : {
            kind: "create-rule",
            targetPayeeId: gap.payee.id,
            targetName: gap.payee.name,
            field: proposal.field,
            op: proposal.candidate.op,
            value: proposal.candidate.value,
            description: proposal.candidate.description,
            expectedMatches: proposal.score.expectedMatches,
          }
    );
  }

  return {
    merges,
    renames,
    rules,
    ruleExtensions,
    deletions: orphansToDelete.map((payee) => ({
      kind: "delete-payee" as const,
      payeeId: payee.id,
      name: payee.name,
    })),
  };
}

export type ValidationContext = {
  /** Every payee still known to be live, by id. */
  byId: Map<string, PayeeCleanupCandidate>;
};

/**
 * The comparison form for a final payee name: case-folded, whitespace
 * collapsed. Punctuation is deliberately significant — `Optus` and `Optus.` are
 * two different payees to Actual, so treating them as a collision would block a
 * plan that is in fact fine.
 */
function nameKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Whether two proposed rules would catch the same imported text.
 *
 * Exact against exact is a set intersection. A pattern against an exact list is
 * decided by running the pattern. Two patterns are only compared literally —
 * regex containment is undecidable in general, and guessing would either block
 * valid plans or give false assurance.
 */
function rulesOverlap(a: CreateRuleOperation, b: CreateRuleOperation): boolean {
  const texts = (op: CreateRuleOperation) =>
    Array.isArray(op.value) ? op.value : null;
  const pattern = (op: CreateRuleOperation) =>
    Array.isArray(op.value) ? null : op.value;

  const aTexts = texts(a);
  const bTexts = texts(b);

  if (aTexts && bTexts) {
    // Lower-cased, like the engine. Folding the other way differs for a handful
    // of characters and there is no reason for this to be the one place that
    // disagrees.
    const left = new Set(aTexts.map((t) => t.trim().toLowerCase()));
    return bTexts.some((t) => left.has(t.trim().toLowerCase()));
  }

  const matchesAny = (op: CreateRuleOperation, against: string[]) => {
    const value = pattern(op);
    if (!value) return false;
    // The shared matcher again, so a pattern and an exact list are compared the
    // way the engine will compare them once both are saved.
    const matches = compileRuleMatcher(op.op === "contains" ? "contains" : "matches", value);
    return against.some((t) => matches(t));
  };

  if (aTexts) return matchesAny(b, aTexts);
  if (bTexts) return matchesAny(a, bTexts);

  const aPattern = pattern(a);
  const bPattern = pattern(b);
  return Boolean(aPattern && bPattern && aPattern === bPattern);
}

/**
 * Validates the whole plan graph (RD-078 §22).
 *
 * Everything here is a *blocking* problem except where noted: these are the
 * conditions under which applying the plan would do something other than what
 * the review screen showed.
 */
export function validatePlan(
  plan: CleanupPlan,
  context: ValidationContext
): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const block = (message: string, payeeIds: string[]) =>
    problems.push({ severity: "blocking", message, payeeIds });

  const disappearing = new Set(plan.merges.flatMap((m) => m.mergeIds));
  const targets = new Set(plan.merges.map((m) => m.targetId));
  const deleted = new Set(plan.deletions.map((d) => d.payeeId));

  const sourceOwners = new Map<string, string[]>();

  for (const merge of plan.merges) {
    const target = context.byId.get(merge.targetId);

    if (!target) {
      block(`"${merge.targetName}" no longer exists, so nothing can merge into it.`, [
        merge.targetId,
      ]);
    } else if (!isCleanupEligible(target.metadata)) {
      // Actual would return early and change nothing, reporting success.
      block(
        `"${target.name}" cannot be kept — Actual manages it and will not merge into it.`,
        [target.id]
      );
    }

    if (merge.mergeIds.length === 0) {
      block(`"${merge.targetName}" has nothing to merge into it.`, [merge.targetId]);
    }

    if (merge.mergeIds.includes(merge.targetId)) {
      block(`"${merge.targetName}" cannot be merged into itself.`, [merge.targetId]);
    }

    if (new Set(merge.mergeIds).size !== merge.mergeIds.length) {
      block(`"${merge.targetName}" lists the same payee twice.`, [merge.targetId]);
    }

    for (const sourceId of merge.mergeIds) {
      const source = context.byId.get(sourceId);
      if (!source) {
        block(`A payee merging into "${merge.targetName}" no longer exists.`, [sourceId]);
        continue;
      }
      if (!isCleanupEligible(source.metadata)) {
        block(
          `"${source.name}" cannot be merged — Actual manages it.`,
          [source.id]
        );
      }
      if (deleted.has(sourceId)) {
        block(
          `"${source.name}" is set to be both merged and deleted.`,
          [source.id]
        );
      }
      const owners = sourceOwners.get(sourceId) ?? [];
      owners.push(merge.targetName);
      sourceOwners.set(sourceId, owners);
    }

    if (deleted.has(merge.targetId)) {
      block(
        `"${merge.targetName}" is set to be kept and deleted at the same time.`,
        [merge.targetId]
      );
    }

    // A target that is itself being merged away elsewhere would leave this
    // merge pointing at a tombstone.
    if (disappearing.has(merge.targetId)) {
      block(
        `"${merge.targetName}" is being merged into another payee, so it cannot also be the one kept here.`,
        [merge.targetId]
      );
    }
  }

  for (const [sourceId, owners] of sourceOwners) {
    if (owners.length > 1) {
      const name = context.byId.get(sourceId)?.name ?? sourceId;
      block(
        `"${name}" is set to merge into more than one payee (${owners.join(", ")}).`,
        [sourceId]
      );
    }
  }

  for (const rename of plan.renames) {
    if (disappearing.has(rename.payeeId)) {
      // The ordering guarantee: the save pipeline renames before it merges, so
      // a rename aimed at a payee that is about to be tombstoned would be lost.
      block(
        `"${rename.from}" is being merged away, so it cannot be renamed to "${rename.to}".`,
        [rename.payeeId]
      );
    }
    if (deleted.has(rename.payeeId)) {
      block(`"${rename.from}" is set to be renamed and deleted.`, [rename.payeeId]);
    }
    if (!context.byId.has(rename.payeeId)) {
      block(`"${rename.from}" no longer exists, so it cannot be renamed.`, [
        rename.payeeId,
      ]);
    }
    if (!rename.to.trim()) {
      block(`"${rename.from}" cannot be renamed to an empty name.`, [rename.payeeId]);
    }
  }

  // ── Would this plan leave two payees with the same name? ─────────────────
  //
  // The whole point of the feature is to end up with *one* payee per merchant.
  // Two groups that both settle on "Optus" produce two payees called Optus —
  // reintroducing exactly the duplication the user came here to remove, and
  // doing it silently, because each merge is individually valid.
  //
  // This is checked across the plan *and* against the payees already in the
  // budget, since renaming onto an existing name collides just as badly.
  const finalNames = new Map<string, string[]>();
  // Keyed by the comparison form, but reported as the user typed it: telling
  // someone their groups "would all end up named OPTUS PREPAID" when they typed
  // "Optus PrePaid" reads like the app renamed it behind their back.
  const displayNames = new Map<string, string>();

  const recordFinalName = (finalName: string, payeeId: string) => {
    const key = nameKey(finalName);
    finalNames.set(key, [...(finalNames.get(key) ?? []), payeeId]);
    if (!displayNames.has(key)) displayNames.set(key, finalName);
  };

  for (const merge of plan.merges) {
    const rename = plan.renames.find((r) => r.payeeId === merge.targetId);
    recordFinalName(rename ? rename.to : merge.targetName, merge.targetId);
  }
  for (const rename of plan.renames) {
    if (plan.merges.some((m) => m.targetId === rename.payeeId)) continue;
    recordFinalName(rename.to, rename.payeeId);
  }

  const survivingIds = new Set([
    ...plan.merges.map((m) => m.targetId),
    ...plan.renames.map((r) => r.payeeId),
  ]);
  const disappearingOrDeleted = new Set([...disappearing, ...deleted]);

  for (const [key, payeeIds] of finalNames) {
    if (payeeIds.length > 1) {
      block(
        `${payeeIds.length} groups would all end up named "${displayNames.get(key) ?? key}" — that leaves ${payeeIds.length} payees with the same name. Give them different names, or put them in one group.`,
        payeeIds
      );
      continue;
    }

    // A name already in use by a payee this plan is not touching.
    for (const [id, payee] of context.byId) {
      if (survivingIds.has(id) || disappearingOrDeleted.has(id)) continue;
      if (nameKey(payee.name) !== key) continue;
      block(
        `"${payee.name}" already exists and is not part of this cleanup — renaming to it would create a second payee with that name.`,
        [payeeIds[0], id]
      );
    }
  }

  // ── Would two new rules fight over the same import text? ────────────────
  //
  // The backtest only compares a candidate against *history*. Two rules created
  // in the same plan have no history to compare against, so a pattern for one
  // merchant can silently shadow the exact list for another — which Rule
  // Diagnostics would later report as a finding the user never chose to create.
  //
  // Extensions count too: adding "X" to one payee's rename rule while creating
  // `oneOf ["X"]` for another is exactly the same collision, and comparing only
  // the creations let it through. An extension is an `imported_payee oneOf`
  // addition, so it maps onto the same comparison.
  const newRules: CreateRuleOperation[] = [
    ...plan.rules,
    ...plan.ruleExtensions.map((extension) => ({
      kind: "create-rule" as const,
      targetPayeeId: extension.targetPayeeId,
      targetName: extension.targetName,
      field: "imported_payee" as const,
      op: "oneOf" as const,
      value: extension.addTexts,
      description: extension.description,
      expectedMatches: 0,
    })),
  ];
  for (let i = 0; i < newRules.length; i++) {
    for (let j = i + 1; j < newRules.length; j++) {
      const a = newRules[i];
      const b = newRules[j];
      if (a.targetPayeeId === b.targetPayeeId) continue;
      if (a.field !== b.field) continue;
      if (!rulesOverlap(a, b)) continue;

      block(
        `The rules for "${a.targetName}" and "${b.targetName}" would both match the same imported text, so which one wins would depend on rule order. Narrow one of them.`,
        [a.targetPayeeId, b.targetPayeeId]
      );
    }
  }

  for (const rule of plan.rules) {
    if (disappearing.has(rule.targetPayeeId)) {
      // RD-078 §21: rule creation must never target a payee scheduled to vanish.
      block(
        `The rule for "${rule.targetName}" would point at a payee that is being merged away.`,
        [rule.targetPayeeId]
      );
    }
    if (deleted.has(rule.targetPayeeId)) {
      block(`The rule for "${rule.targetName}" would point at a deleted payee.`, [
        rule.targetPayeeId,
      ]);
    }
    if (!context.byId.has(rule.targetPayeeId)) {
      block(`The rule for "${rule.targetName}" points at a payee that no longer exists.`, [
        rule.targetPayeeId,
      ]);
    }
    const emptyPattern = Array.isArray(rule.value)
      ? rule.value.length === 0 || rule.value.every((v) => !v.trim())
      : !rule.value.trim();
    if (emptyPattern) {
      block(`The rule for "${rule.targetName}" has no pattern to match.`, [
        rule.targetPayeeId,
      ]);
    }
  }

  for (const deletion of plan.deletions) {
    const payee = context.byId.get(deletion.payeeId);
    if (!payee) {
      block(`"${deletion.name}" no longer exists.`, [deletion.payeeId]);
      continue;
    }
    if (!isCleanupEligible(payee.metadata)) {
      block(`"${payee.name}" cannot be deleted — Actual manages it.`, [payee.id]);
    }
    if (targets.has(deletion.payeeId)) {
      block(
        `"${payee.name}" is being kept by a merge, so it cannot be deleted.`,
        [payee.id]
      );
    }
  }

  return problems;
}

export function planIsEmpty(plan: CleanupPlan): boolean {
  return planOperationCount(plan) === 0;
}

export function planOperationCount(plan: CleanupPlan): number {
  return (
    plan.merges.length +
    plan.renames.length +
    plan.deletions.length +
    plan.rules.length +
    plan.ruleExtensions.length
  );
}
