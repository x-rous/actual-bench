"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import {
  getTransport,
  settleTransportWrites,
  syncTransportAfterChanges,
} from "@/lib/actual";
import { applyRuleEntityIdMap } from "@/lib/actual/ruleMutation";
import {
  extractMessage,
  computeSaveOperations,
  hasPendingStagedChanges,
} from "@/lib/saveUtils";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { Rule } from "@/types/entities";

export function useRulesSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.rules);
  const queryClient = useQueryClient();
  const hasPendingChanges = useMemo(() => hasPendingStagedChanges(staged), [staged]);

  async function save(entityIdMap: Record<string, string> = {}): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    try {
      const transport = getTransport(connection);
      const { toCreate, toUpdate, toDelete } = computeSaveOperations<Rule>(staged);
      const mergeDeps = useStagedStore.getState().mergeDependencies;

      // IDs that are only allowed to be deleted after their linked new rule is created.
      const allMergeDepIds = new Set(Object.values(mergeDeps).flat());

      const succeeded: SaveResult[] = [];
      const failed: SaveResult[] = [];
      const succeededCreateIds = new Set<string>();

      // ── Creates (parallel) ──────────────────────────────────────────────────
      const createResults = await settleTransportWrites(
        transport,
        toCreate,
        (rule) =>
          transport.createRule({
            stage: rule.stage,
            conditionsOp: rule.conditionsOp,
            conditions: applyRuleEntityIdMap(rule.conditions, entityIdMap),
            actions: applyRuleEntityIdMap(rule.actions, entityIdMap),
          })
      );
      for (let i = 0; i < toCreate.length; i++) {
        const id = toCreate[i].id;
        const r = createResults[i];
        if (r.status === "fulfilled") {
          succeeded.push({ status: "success", id });
          succeededCreateIds.add(id);
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Create failed") });
        }
      }

      // ── Updates (parallel) ──────────────────────────────────────────────────
      const updateResults = await settleTransportWrites(
        transport,
        toUpdate,
        (rule) =>
          transport.updateRule(rule.id, {
            stage: rule.stage,
            conditionsOp: rule.conditionsOp,
            conditions: applyRuleEntityIdMap(rule.conditions, entityIdMap),
            actions: applyRuleEntityIdMap(rule.actions, entityIdMap),
          })
      );
      for (let i = 0; i < toUpdate.length; i++) {
        const id = toUpdate[i].id;
        const r = updateResults[i];
        if (r.status === "fulfilled") {
          succeeded.push({ status: "success", id });
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Update failed") });
        }
      }

      // ── Deletes ─────────────────────────────────────────────────────────────
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

      const deleteResults = await settleTransportWrites(
        transport,
        safeToDelete,
        (id) => transport.deleteRule(id)
      );
      for (let i = 0; i < safeToDelete.length; i++) {
        const id = safeToDelete[i];
        const r = deleteResults[i];
        if (r.status === "fulfilled") {
          succeeded.push({ status: "success", id });
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Delete failed") });
        }
      }

      const store = useStagedStore.getState();

      // Revert staged deletions that were skipped due to their create failing.
      if (skippedMergeDeps.length > 0) {
        for (const id of skippedMergeDeps) store.revertEntity("rules", id);
      }

      // Remove temp-UUID staged entries for rules that were successfully created.
      // Without this, loadRules after the refetch preserves every isNew entry
      // not found in the server response — causing the temp entry to linger.
      if (succeededCreateIds.size > 0) {
        for (const id of succeededCreateIds) store.stageDelete("rules", id);
      }

      // Remove staged entries for successfully saved updates/deletes so that
      // loadRules replaces them with fresh server data instead of preserving them.
      const succeededNonCreateIds = succeeded
        .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id))
        .map((r) => r.id);
      if (succeededNonCreateIds.length > 0) {
        store.markSaved("rules", succeededNonCreateIds);
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

      await syncTransportAfterChanges(transport, succeeded.length > 0);

      await queryClient.invalidateQueries({ queryKey: ["rules", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["budget-overview", connection.id] });

      return { succeeded, failed, idMap: {} };
    } finally {
      setIsSaving(false);
    }
  }

  return { save, isSaving, hasPendingChanges };
}
