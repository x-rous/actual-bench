"use client";

import { useCallback, useState } from "react";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import { getTransactionCountsForIds } from "@/lib/api/query";
import type { Rule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import { getPayeeCleanupMetadata, fallbackMetadata } from "../lib/payeeMetadata";
import { generateId } from "@/lib/uuid";
import { buildNormalizationRule } from "../lib/ruleCandidates";
import { buildExactMatchRule, extendExactMatchConditions } from "../lib/ruleGaps";
import { validatePlan, type CleanupPlan, type PlanProblem } from "../lib/plan";
import { findOrphanPayees } from "../lib/orphans";
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
  const loadPayees = useStagedStore((s) => s.loadPayees);

  const [isStaging, setIsStaging] = useState(false);

  const stage = useCallback(
    async (plan: CleanupPlan): Promise<StageOutcome> => {
      if (!connection) throw new Error("No active connection");
      setIsStaging(true);

      try {
        // ── Re-read, then re-validate against what is true *now* ────────────
        const transport = getTransport(connection);
        const deletionIds = plan.deletions.map((deletion) => deletion.payeeId);
        const [payees, metadata, transactionCounts, liveRules] = await Promise.all([
          transport.getPayees(),
          getPayeeCleanupMetadata(connection),
          getTransactionCountsForIds(connection, "payee", deletionIds),
          plan.deletions.length > 0 ? transport.getRules() : Promise.resolve([]),
        ]);

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

        // The cleanup route can be opened directly, without visiting the
        // Payees page that normally initializes this store. Populate it from
        // the same fresh read used for validation; `loadPayees` preserves any
        // existing staged edits, which the conflict check below then catches.
        loadPayees(payees);

        const problems = validatePlan(plan, { byId });

        // Cleanup shares the same staged store as the Payees page. Never layer
        // a cleanup decision over an existing unsaved payee edit: even a
        // partial update can replace a rename the user already reviewed there.
        const affectedPayeeIds = new Set([
          ...plan.merges.flatMap((merge) => [merge.targetId, ...merge.mergeIds]),
          ...plan.renames.map((rename) => rename.payeeId),
          ...plan.deletions.map((deletion) => deletion.payeeId),
          ...plan.rules.map((rule) => rule.targetPayeeId),
          ...plan.ruleExtensions.map((extension) => extension.targetPayeeId),
        ]);
        const stagedPayees = useStagedStore.getState().payees;
        const conflictingPayeeIds = [...affectedPayeeIds].filter((id) => {
          const entry = stagedPayees[id];
          return Boolean(
            entry && (entry.isNew || entry.isUpdated || entry.isDeleted)
          );
        });
        if (conflictingPayeeIds.length > 0) {
          const names = conflictingPayeeIds
            .map((id) => stagedPayees[id]?.entity.name ?? byId.get(id)?.name ?? id)
            .map((name) => `"${name}"`)
            .join(", ");
          problems.push({
            severity: "blocking",
            payeeIds: conflictingPayeeIds,
            message: `${names} already ${
              conflictingPayeeIds.length === 1 ? "has" : "have"
            } unsaved payee changes. Save or undo them before staging this cleanup.`,
          });
        }

        if (plan.deletions.length > 0) {
          // The Unused tab is a scan result, not a permanent property. Overlay
          // local staged rule edits on a fresh server read so a rule the user is
          // about to create also protects its payee from deletion.
          const rulesNow = useStagedStore.getState().rules;
          const currentRules: StagedMap<Rule> = Object.fromEntries(
            liveRules.map((rule) => [
              rule.id,
              {
                entity: rule,
                original: rule,
                isNew: false,
                isUpdated: false,
                isDeleted: false,
                validationErrors: {},
              },
            ])
          );
          for (const [id, entry] of Object.entries(rulesNow)) {
            if (entry.isDeleted) delete currentRules[id];
            else currentRules[id] = entry;
          }

          const currentOrphanIds = new Set(
            findOrphanPayees({
              candidates: plan.deletions
                .map((deletion) => byId.get(deletion.payeeId))
                .filter((candidate): candidate is PayeeCleanupCandidate => candidate !== undefined),
              stagedRules: currentRules,
              transactionCounts,
            }).map(({ payee }) => payee.id)
          );

          for (const deletion of plan.deletions) {
            if (!currentOrphanIds.has(deletion.payeeId)) {
              problems.push({
                severity: "blocking",
                payeeIds: [deletion.payeeId],
                message:
                  "\"" +
                  deletion.name +
                  "\" is no longer unused, so its deletion cannot be staged. Scan again before deciding.",
              });
            }
          }
        }
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

        // Counted as they are staged, not assumed. A rule that has since gone
        // from the staged set is skipped here, and reporting it anyway told the
        // user a change had been made that had not — after `pushUndo`, with
        // nothing else to signal it.
        let extended = 0;
        // Read now, not when this callback was built. Staging waits on the
        // payee list and its metadata first, and a rule edited during that wait
        // would otherwise be rewritten from the copy captured at render — the
        // edit silently replaced by its older self plus the new texts.
        const rulesNow = useStagedStore.getState().rules;
        for (const extension of plan.ruleExtensions) {
          // An update, not a create: the payee already has a rename rule and
          // this adds the texts it has not seen. Same mechanism Actual uses.
          const existing = rulesNow[extension.ruleId]?.entity;
          if (!existing) continue;
          stageUpdate("rules", extension.ruleId, {
            conditions: extendExactMatchConditions(existing, extension.addTexts),
          });
          extended += 1;
        }

        return {
          status: "staged",
          operations:
            plan.merges.length +
            plan.renames.length +
            plan.deletions.length +
            plan.rules.length +
            extended,
        };
      } finally {
        setIsStaging(false);
      }
    },
    [
      connection,
      loadPayees,
      pushUndo,
      stageDelete,
      stageNew,
      stagePayeeMerge,
      stageUpdate,
    ]
  );

  return { stage, isStaging };
}
