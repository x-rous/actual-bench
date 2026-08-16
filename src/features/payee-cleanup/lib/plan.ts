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
  op: "contains" | "matches";
  value: string;
  description: string;
  expectedMatches: number;
};

export type CleanupOperation =
  | MergeOperation
  | RenameOperation
  | DeleteOperation
  | CreateRuleOperation;

export type CleanupPlan = {
  merges: MergeOperation[];
  renames: RenameOperation[];
  deletions: DeleteOperation[];
  rules: CreateRuleOperation[];
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
  orphansToDelete: PayeeCleanupCandidate[] = []
): CleanupPlan {
  const merges: MergeOperation[] = [];
  const renames: RenameOperation[] = [];
  const rules: CreateRuleOperation[] = [];

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

  return {
    merges,
    renames,
    rules,
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

/** Names compare case- and punctuation-insensitively, as Actual matches them. */
function nameKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
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

  for (const merge of plan.merges) {
    const rename = plan.renames.find((r) => r.payeeId === merge.targetId);
    const finalName = rename ? rename.to : merge.targetName;
    const key = nameKey(finalName);
    finalNames.set(key, [...(finalNames.get(key) ?? []), merge.targetId]);
  }
  for (const rename of plan.renames) {
    if (plan.merges.some((m) => m.targetId === rename.payeeId)) continue;
    const key = nameKey(rename.to);
    finalNames.set(key, [...(finalNames.get(key) ?? []), rename.payeeId]);
  }

  const survivingIds = new Set([
    ...plan.merges.map((m) => m.targetId),
    ...plan.renames.map((r) => r.payeeId),
  ]);
  const disappearingOrDeleted = new Set([...disappearing, ...deleted]);

  for (const [key, payeeIds] of finalNames) {
    if (payeeIds.length > 1) {
      block(
        `${payeeIds.length} groups would all end up named "${key}" — that leaves ${payeeIds.length} payees with the same name. Give them different names, or put them in one group.`,
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
    if (!rule.value.trim()) {
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
    plan.rules.length
  );
}
