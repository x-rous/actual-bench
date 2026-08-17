"use client";

import { useCallback, useState } from "react";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import { getPayeeCleanupMetadata, fallbackMetadata } from "../lib/payeeMetadata";
import { generateId } from "@/lib/uuid";
import { buildNormalizationRule } from "../lib/ruleCandidates";
import { buildExactMatchRule, extendExactMatchConditions } from "../lib/ruleGaps";
import { validatePlan, type CleanupPlan, type PlanProblem } from "../lib/plan";
import type { PayeeCleanupCandidate } from "../types";

export type StageOutcome =
  | { status: "staged"; operations: number }
  | { status: "blocked"; problems: PlanProblem[] }
  | { status: "stale"; changedCount: number };

/**
 * Stages a validated cleanup plan (RD-078 §21–§23).
 *
 * Nothing here writes to Actual. It puts operations into the shared staged
 * store, where they join anything else the user has pending and are written by
 * the existing payee save pipeline on an explicit Save — same as every other
 * entity edit in the app.
 *
 * The one thing this hook insists on is a **fresh read immediately before
 * staging**. A scan can be minutes old; in that time a sync, another tab, or the
 * user's own edits elsewhere can rename, merge or delete the very payees the
 * plan names. Applying a stale plan would merge into a payee that no longer
 * exists, or silently no-op against one Actual has since made a transfer payee.
 */
export function usePayeeCleanupPlan() {
  const connection = useConnectionStore(selectActiveInstance);
  // `stagePayeeMerge` also marks the source payees deleted in the staged view,
  // so the payees page stops showing rows that are about to be merged away.
  const stagePayeeMerge = useStagedStore((s) => s.stagePayeeMerge);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const stageNew = useStagedStore((s) => s.stageNew);
  const pushUndo = useStagedStore((s) => s.pushUndo);
  // Needed to extend a payee's existing rename rule rather than create a second
  // one: the update has to be built from the rule as it currently stands.
  const stagedRules = useStagedStore((s) => s.rules);

  const [isStaging, setIsStaging] = useState(false);

  const stage = useCallback(
    async (plan: CleanupPlan): Promise<StageOutcome> => {
      if (!connection) throw new Error("No active connection");
      setIsStaging(true);

      try {
        // ── Re-read, then re-validate against what is true *now* ────────────
        const transport = getTransport(connection);
        const payees = await transport.getPayees();
        const metadata = await getPayeeCleanupMetadata(connection);

        const byId = new Map<string, PayeeCleanupCandidate>(
          payees.map((payee) => [
            payee.id,
            {
              ...payee,
              metadata:
                metadata.get(payee.id) ??
                fallbackMetadata(payee.id, payee.transferAccountId ?? null),
            },
          ])
        );

        const problems = validatePlan(plan, { byId });
        const blocking = problems.filter((p) => p.severity === "blocking");
        if (blocking.length > 0) {
          // Report every problem, not just the first: a user fixing them one at
          // a time through repeated re-validation is a bad afternoon.
          return { status: "blocked", problems };
        }

        // A payee named by the plan whose *name* changed under us means the
        // review screen showed something that is no longer true, even when the
        // plan still validates. Surface it rather than quietly proceeding.
        const changed = [
          ...plan.merges.flatMap((m) => [
            { id: m.targetId, name: m.targetName },
            ...m.mergeIds.map((id, i) => ({ id, name: m.memberNames[i] })),
          ]),
          ...plan.renames.map((r) => ({ id: r.payeeId, name: r.from })),
          ...plan.deletions.map((d) => ({ id: d.payeeId, name: d.name })),
        ].filter(({ id, name }) => {
          const live = byId.get(id);
          return live !== undefined && live.name !== name;
        });

        if (changed.length > 0) {
          return { status: "stale", changedCount: changed.length };
        }

        // ── Stage ───────────────────────────────────────────────────────────
        // One undo entry for the whole plan: the user made one decision, so
        // undo should reverse one decision rather than peel operations off.
        pushUndo();

        for (const rename of plan.renames) {
          stageUpdate("payees", rename.payeeId, { name: rename.to });
        }
        for (const merge of plan.merges) {
          stagePayeeMerge(merge.targetId, merge.mergeIds);
        }
        for (const deletion of plan.deletions) {
          stageDelete("payees", deletion.payeeId);
        }
        for (const rule of plan.rules) {
          // Staged through the normal rules pipeline, so it appears on the Rules
          // page for review and is written by the same Save as everything else.
          stageNew(
            "rules",
            rule.op === "oneOf"
              ? buildExactMatchRule(
                  rule.field,
                  Array.isArray(rule.value) ? rule.value : [rule.value],
                  rule.targetPayeeId,
                  generateId()
                )
              : buildNormalizationRule(
                  {
                    field: rule.field,
                    op: rule.op,
                    value: Array.isArray(rule.value) ? rule.value[0] : rule.value,
                    description: rule.description,
                  },
                  rule.targetPayeeId,
                  generateId()
                )
          );
        }

        for (const extension of plan.ruleExtensions) {
          // An update, not a create: the payee already has a rename rule and
          // this adds the texts it has not seen. Same mechanism Actual uses.
          const existing = stagedRules[extension.ruleId]?.entity;
          if (!existing) continue;
          stageUpdate("rules", extension.ruleId, {
            conditions: extendExactMatchConditions(existing, extension.addTexts),
          });
        }

        return {
          status: "staged",
          operations:
            plan.merges.length +
            plan.renames.length +
            plan.deletions.length +
            plan.rules.length +
            plan.ruleExtensions.length,
        };
      } finally {
        setIsStaging(false);
      }
    },
    [connection, pushUndo, stageDelete, stageNew, stagePayeeMerge, stageUpdate, stagedRules]
  );

  return { stage, isStaging };
}
