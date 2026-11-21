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

  /**
   * `phase` splits the save around the categories: "upsert" creates and
   * renames groups (categories need a new group's real id), "delete" removes
   * groups once categories have been moved out of them (Actual deletes a
   * group's remaining categories with it). Without a phase, both run.
   */
  async function save(phase: "upsert" | "delete" | "all" = "all"): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    try {
      const transport = getTransport(connection);
      // Read fresh: the delete phase runs after the categories save changed the store.
      const current = useStagedStore.getState().categoryGroups;
      const ops = computeSaveOperations<CategoryGroup>(current);
      const toCreate = phase === "delete" ? [] : ops.toCreate;
      const toUpdate = phase === "delete" ? [] : ops.toUpdate;
      const succeeded: SaveResult[] = [];
      const failed: SaveResult[] = [];
      // Actual deletes a group's remaining categories with it. A category whose
      // move out of the group did not save is still in it on the server, so the
      // group is kept (and its delete stays staged) until that move succeeds.
      const categories = useStagedStore.getState().categories;
      const toDelete = (phase === "upsert" ? [] : ops.toDelete).filter((groupId) => {
        const stuck = Object.values(categories).some((c) =>
          !c.isDeleted && !c.isNew && c.original?.groupId === groupId && c.entity.groupId !== groupId
        );
        if (stuck) {
          failed.push({
            status: "error",
            id: groupId,
            message: "Not deleted: a category moving out of this group did not save, and deleting the group would delete it too. Fix that category, then save again.",
          });
        }
        return !stuck;
      });
      const succeededCreateIds = new Set<string>();
      const idMap: Record<string, string> = {};

      // ── Creates (parallel) ──────────────────────────────────────────────────
      const createResults = await settleTransportWrites(
        transport,
        toCreate,
        (g) =>
          transport.createCategoryGroup({ name: g.name, isIncome: g.isIncome, hidden: g.hidden })
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
      const updateResults = await settleTransportWrites(
        transport,
        toUpdate,
        (g) => transport.updateCategoryGroup(g.id, { name: g.name, hidden: g.hidden })
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
      const deleteResults = await settleTransportWrites(
        transport,
        toDelete,
        (id) => transport.deleteCategoryGroup(id, current[id]?.transferCategoryId ?? null)
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

      await syncTransportAfterChanges(transport, succeeded.length > 0);

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
