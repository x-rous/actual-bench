"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import {
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
} from "@/lib/api/categoryGroups";
import {
  extractMessage,
  computeSaveOperations,
  hasPendingStagedChanges,
} from "@/lib/saveUtils";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { CategoryGroup } from "@/types/entities";

export function useCategoryGroupsSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.categoryGroups);
  const queryClient = useQueryClient();
  const hasPendingChanges = useMemo(() => hasPendingStagedChanges(staged), [staged]);

  async function save(): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    try {
      const { toCreate, toUpdate, toDelete } = computeSaveOperations<CategoryGroup>(staged);
      const succeeded: SaveResult[] = [];
      const failed: SaveResult[] = [];
      const succeededCreateIds = new Set<string>();
      const idMap: Record<string, string> = {};

      // ── Creates (parallel) ──────────────────────────────────────────────────
      const createResults = await Promise.allSettled(
        toCreate.map((g) =>
          createCategoryGroup(connection, { name: g.name, isIncome: g.isIncome, hidden: g.hidden })
        )
      );
      for (let i = 0; i < toCreate.length; i++) {
        const id = toCreate[i].id;
        const r  = createResults[i];
        if (r.status === "fulfilled") {
          idMap[id] = r.value; // createCategoryGroup returns the server ID string
          succeeded.push({ status: "success", id });
          succeededCreateIds.add(id);
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Create failed") });
        }
      }

      // ── Updates (parallel) ──────────────────────────────────────────────────
      const updateResults = await Promise.allSettled(
        toUpdate.map((g) =>
          updateCategoryGroup(connection, g.id, { name: g.name, hidden: g.hidden })
        )
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

      // ── Deletes (parallel) ──────────────────────────────────────────────────
      const deleteResults = await Promise.allSettled(
        toDelete.map((id) => deleteCategoryGroup(connection, id))
      );
      for (let i = 0; i < toDelete.length; i++) {
        const id = toDelete[i];
        const r  = deleteResults[i];
        if (r.status === "fulfilled") {
          succeeded.push({ status: "success", id });
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Delete failed") });
        }
      }

      const store = useStagedStore.getState();

      // Remove temp-UUID staged entries for successful creates before refetch.
      if (succeededCreateIds.size > 0) {
        for (const id of succeededCreateIds) store.stageDelete("categoryGroups", id);
      }

      // Remove staged entries for successfully saved updates/deletes so that
      // loadCategoryGroups replaces them with fresh server data.
      const succeededNonCreateIds = succeeded
        .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id))
        .map((r) => r.id);
      if (succeededNonCreateIds.length > 0) {
        store.markSaved("categoryGroups", succeededNonCreateIds);
      }

      if (failed.length > 0) {
        const errors: Record<string, string> = {};
        for (const f of failed) {
          if (f.status === "error") errors[f.id] = f.message;
        }
        useStagedStore.getState().setSaveErrors("categoryGroups", errors);
      }

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
