"use client";

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { createTag, updateTag, deleteTag, getTags } from "@/lib/api/tags";
import { extractMessage, computeSaveOperations } from "@/lib/saveUtils";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { Tag } from "@/types/entities";

export function useTagsSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.tags);
  const queryClient = useQueryClient();

  const hasPendingChanges = useMemo(
    () => Object.values(staged).some((s) => s.isNew || s.isUpdated || s.isDeleted),
    [staged]
  );

  async function save(): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    const { toCreate, toUpdate, toDelete } = computeSaveOperations<Tag>(staged);
    const succeeded: SaveResult[] = [];
    const failed: SaveResult[] = [];
    const succeededCreateIds = new Set<string>();
    const idMap: Record<string, string> = {};

    // ── Creates (parallel) ────────────────────────────────────────────────────
    const createResults = await Promise.allSettled(
      toCreate.map((t) => createTag(connection, { name: t.name, color: t.color, description: t.description }))
    );
    for (let i = 0; i < toCreate.length; i++) {
      const id = toCreate[i].id;
      const r  = createResults[i];
      if (r.status === "fulfilled") {
        succeeded.push({ status: "success", id });
        succeededCreateIds.add(id);
        // Use server-assigned ID if returned
        if (r.value.id && r.value.id !== id) idMap[id] = r.value.id;
      } else {
        failed.push({ status: "error", id, message: extractMessage(r.reason, "Create failed") });
      }
    }

    // ── Fallback: refresh to resolve server IDs for creates without returned ID ──
    const unresolved = toCreate.filter((t) => succeededCreateIds.has(t.id) && !idMap[t.id]);
    if (unresolved.length > 0) {
      try {
        const freshTags = await getTags(connection);
        const serverIdByName = new Map(freshTags.map((t) => [t.name, t.id]));
        for (const t of unresolved) {
          const serverId = serverIdByName.get(t.name);
          if (serverId) idMap[t.id] = serverId;
        }
      } catch {
        // idMap stays partial; tags have no cross-entity references so this is safe
      }
    }

    // ── Updates (parallel) ────────────────────────────────────────────────────
    const updateResults = await Promise.allSettled(
      toUpdate.map((t) => updateTag(connection, t.id, { name: t.name, color: t.color, description: t.description }))
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

    // ── Deletes (parallel) ────────────────────────────────────────────────────
    const deleteResults = await Promise.allSettled(
      toDelete.map((id) => deleteTag(connection, id))
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

    setIsSaving(false);

    const store = useStagedStore.getState();

    if (succeededCreateIds.size > 0) {
      for (const id of succeededCreateIds) store.stageDelete("tags", id);
    }

    const succeededNonCreateIds = succeeded
      .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id))
      .map((r) => r.id);
    if (succeededNonCreateIds.length > 0) {
      store.markSaved("tags", succeededNonCreateIds);
    }

    if (failed.length > 0) {
      const errors: Record<string, string> = {};
      for (const f of failed) {
        if (f.status === "error") errors[f.id] = f.message;
      }
      store.setSaveErrors("tags", errors);
    }

    await queryClient.invalidateQueries({ queryKey: ["tags", connection.id] });

    return { succeeded, failed, idMap };
  }

  return { save, isSaving, hasPendingChanges };
}
