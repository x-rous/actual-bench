"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getTransport, syncTransportAfterChanges } from "@/lib/actual";
import {
  extractMessage,
  computeSaveOperations,
  hasPendingStagedChanges,
} from "@/lib/saveUtils";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { Category } from "@/types/entities";

export function useCategoriesSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.categories);
  const queryClient = useQueryClient();
  const hasPendingChanges = useMemo(() => hasPendingStagedChanges(staged), [staged]);

  async function save(groupIdMap: Record<string, string> = {}): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    try {
      const transport = getTransport(connection);
      const { toCreate, toUpdate, toDelete } = computeSaveOperations<Category>(staged);
      const succeeded: SaveResult[] = [];
      const failed: SaveResult[] = [];
      const succeededCreateIds = new Set<string>();
      const idMap: Record<string, string> = {};

      // ── Creates (parallel) ──────────────────────────────────────────────────
      // Substitute any client-UUID groupId with the server-assigned group ID so
      // that new categories correctly reference newly created groups.
      const createResults = await Promise.allSettled(
        toCreate.map((c) =>
          transport.createCategory({
            name: c.name,
            groupId: groupIdMap[c.groupId] ?? c.groupId,
            isIncome: c.isIncome,
            hidden: c.hidden,
          })
        )
      );
      for (let i = 0; i < toCreate.length; i++) {
        const id = toCreate[i].id;
        const r = createResults[i];
        if (r.status === "fulfilled") {
          idMap[id] = r.value;
          succeeded.push({ status: "success", id });
          succeededCreateIds.add(id);
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Create failed") });
        }
      }

      // ── Updates (parallel) ──────────────────────────────────────────────────
      const updateResults = await Promise.allSettled(
        toUpdate.map((c) =>
          transport.updateCategory(c.id, { name: c.name, hidden: c.hidden })
        )
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

      // ── Deletes (parallel) ──────────────────────────────────────────────────
      const deleteResults = await Promise.allSettled(
        toDelete.map((id) => transport.deleteCategory(id))
      );
      for (let i = 0; i < toDelete.length; i++) {
        const id = toDelete[i];
        const r = deleteResults[i];
        if (r.status === "fulfilled") {
          succeeded.push({ status: "success", id });
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Delete failed") });
        }
      }

      const store = useStagedStore.getState();

      // Remove temp-UUID staged entries for successful creates before refetch.
      if (succeededCreateIds.size > 0) {
        for (const id of succeededCreateIds) store.stageDelete("categories", id);
      }

      // Remove staged entries for successfully saved updates/deletes so that
      // loadCategories replaces them with fresh server data.
      const succeededNonCreateIds = succeeded
        .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id))
        .map((r) => r.id);
      if (succeededNonCreateIds.length > 0) {
        store.markSaved("categories", succeededNonCreateIds);
      }

      if (failed.length > 0) {
        const errors: Record<string, string> = {};
        for (const f of failed) {
          if (f.status === "error") errors[f.id] = f.message;
        }
        useStagedStore.getState().setSaveErrors("categories", errors);
      }

      await syncTransportAfterChanges(transport, succeeded.length > 0);

      // Both entity types share one query key since they're loaded together
      await queryClient.invalidateQueries({ queryKey: ["categoryGroups", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["transactionCounts", "category", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["budget-overview", connection.id] });

      return { succeeded, failed, idMap };
    } finally {
      setIsSaving(false);
    }
  }

  return { save, isSaving, hasPendingChanges };
}
