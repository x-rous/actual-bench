"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { createRule, updateRule, deleteRule } from "@/lib/api/rules";
import { extractMessage, computeSaveOperations } from "@/lib/saveUtils";
import { CONDITION_FIELDS, ACTION_FIELDS } from "../utils/ruleFields";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { Rule, ConditionOrAction, AmountRange } from "@/types/entities";

/** Fields whose values are entity IDs that may need client→server substitution */
const ENTITY_REF_FIELDS = new Set(["payee", "account", "category"]);

/**
 * Substitute any client-generated UUID in entity reference fields with the
 * server-assigned ID, so that rules referencing new payees/accounts/categories
 * are saved with the correct IDs.
 */
function applyEntityIdMap(
  parts: ConditionOrAction[],
  idMap: Record<string, string>
): ConditionOrAction[] {
  if (Object.keys(idMap).length === 0) return parts;
  return parts.map((p) => {
    if (!ENTITY_REF_FIELDS.has(p.field)) return p;
    const v = p.value;
    if (typeof v === "string" && idMap[v]) return { ...p, value: idMap[v] };
    if (Array.isArray(v)) {
      const mapped = v.map((x) => (typeof x === "string" && idMap[x] ? idMap[x] : x));
      return { ...p, value: mapped };
    }
    return p;
  });
}

/**
 * Prepare condition/action values for the API:
 *  1. Coerce any string typed by the user in a number input to a JS number.
 *  2. Scale display-unit amounts back to Actual's internal ×100 representation.
 */
function coerceParts(parts: ConditionOrAction[]): ConditionOrAction[] {
  return parts.map((p) => {
    const def = CONDITION_FIELDS[p.field] ?? ACTION_FIELDS[p.field];
    if (def?.type !== "number") return p;

    let value: ConditionOrAction["value"] = p.value;

    // 1. Coerce string → number (HTML number inputs always yield strings)
    if (typeof value === "string" && value !== "") value = Number(value);

    // 2. Multiply by 100 to convert display units → Actual's internal format
    if (typeof value === "number") {
      value = Math.round(value * 100);
    } else if (typeof value === "object" && value !== null && "num1" in value) {
      const r = value as AmountRange;
      value = { num1: Math.round(r.num1 * 100), num2: Math.round(r.num2 * 100) };
    }

    return { ...p, value };
  });
}

function coerceRule(rule: Rule): Rule {
  return {
    ...rule,
    conditions: coerceParts(rule.conditions),
    actions: coerceParts(rule.actions),
  };
}

export function useRulesSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.rules);
  const queryClient = useQueryClient();

  async function save(entityIdMap: Record<string, string> = {}): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    const { toCreate, toUpdate, toDelete } = computeSaveOperations<Rule>(staged);
    const mergeDeps = useStagedStore.getState().mergeDependencies;

    // IDs that are only allowed to be deleted after their linked new rule is created.
    const allMergeDepIds = new Set(Object.values(mergeDeps).flat());

    const succeeded: SaveResult[] = [];
    const failed: SaveResult[] = [];
    const succeededCreateIds = new Set<string>();

    // ── Creates (parallel) ────────────────────────────────────────────────────
    const createResults = await Promise.allSettled(
      toCreate.map((raw) => {
        const rule = coerceRule(raw);
        return createRule(connection, {
          stage: rule.stage,
          conditionsOp: rule.conditionsOp,
          conditions: applyEntityIdMap(rule.conditions, entityIdMap),
          actions: applyEntityIdMap(rule.actions, entityIdMap),
        });
      })
    );
    for (let i = 0; i < toCreate.length; i++) {
      const id = toCreate[i].id;
      const r  = createResults[i];
      if (r.status === "fulfilled") {
        succeeded.push({ status: "success", id });
        succeededCreateIds.add(id);
      } else {
        failed.push({ status: "error", id, message: extractMessage(r.reason, "Create failed") });
      }
    }

    // ── Updates (parallel) ────────────────────────────────────────────────────
    const updateResults = await Promise.allSettled(
      toUpdate.map((raw) => {
        const rule = coerceRule(raw);
        return updateRule(connection, rule.id, {
          stage: rule.stage,
          conditionsOp: rule.conditionsOp,
          conditions: applyEntityIdMap(rule.conditions, entityIdMap),
          actions: applyEntityIdMap(rule.actions, entityIdMap),
        });
      })
    );
    for (let i = 0; i < toUpdate.length; i++) {
      const id = toUpdate[i].id;
      const r  = updateResults[i];
      if (r.status === "fulfilled") {
        succeeded.push({ status: "success", id });
      } else {
        failed.push({ status: "error", id, message: extractMessage(r.reason, "Update failed") });
      }
    }

    // ── Deletes ───────────────────────────────────────────────────────────────
    // Build the set of merge-dependent IDs that are now safe to delete
    // (their linked new rule was created successfully).
    const safeToDeleteFromMerge = new Set<string>();
    for (const [newRuleId, originalIds] of Object.entries(mergeDeps)) {
      if (succeededCreateIds.has(newRuleId)) {
        for (const id of originalIds) safeToDeleteFromMerge.add(id);
      }
    }

    const skippedMergeDeps: string[] = [];
    const safeToDelete: string[] = [];

    for (const id of toDelete) {
      if (allMergeDepIds.has(id) && !safeToDeleteFromMerge.has(id)) {
        // Linked create failed — revert the staged deletion so the original
        // rule reappears in the table for the user to retry or discard.
        skippedMergeDeps.push(id);
      } else {
        safeToDelete.push(id);
      }
    }

    const deleteResults = await Promise.allSettled(
      safeToDelete.map((id) => deleteRule(connection, id))
    );
    for (let i = 0; i < safeToDelete.length; i++) {
      const id = safeToDelete[i];
      const r  = deleteResults[i];
      if (r.status === "fulfilled") {
        succeeded.push({ status: "success", id });
      } else {
        failed.push({ status: "error", id, message: extractMessage(r.reason, "Delete failed") });
      }
    }

    setIsSaving(false);

    // Revert staged deletions that were skipped due to their create failing.
    if (skippedMergeDeps.length > 0) {
      const store = useStagedStore.getState();
      for (const id of skippedMergeDeps) store.revertEntity("rules", id);
    }

    // Remove temp-UUID staged entries for rules that were successfully created.
    // Without this, loadRules after the refetch preserves every isNew entry
    // not found in the server response — causing the temp entry to linger.
    if (succeededCreateIds.size > 0) {
      const store = useStagedStore.getState();
      for (const id of succeededCreateIds) store.stageDelete("rules", id);
    }

    // Clear merge dependencies whose creates succeeded.
    const processedMergeIds = [...succeededCreateIds].filter((id) => id in mergeDeps);
    if (processedMergeIds.length > 0) {
      useStagedStore.getState().clearMergeDependencies(processedMergeIds);
    }

    if (failed.length > 0) {
      const errors: Record<string, string> = {};
      for (const f of failed) {
        if (f.status === "error") errors[f.id] = f.message;
      }
      useStagedStore.getState().setSaveErrors("rules", errors);
    }

    await queryClient.invalidateQueries({ queryKey: ["rules", connection.id] });

    return { succeeded, failed, idMap: {} };
  }

  return { save, isSaving };
}
