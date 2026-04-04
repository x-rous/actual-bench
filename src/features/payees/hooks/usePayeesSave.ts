"use client";

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { createPayee, updatePayee, deletePayee, getPayees } from "@/lib/api/payees";
import { extractMessage, computeSaveOperations } from "@/lib/saveUtils";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { Payee } from "@/types/entities";

export function usePayeesSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.payees);
  const queryClient = useQueryClient();

  const hasPendingChanges = useMemo(
    () => Object.values(staged).some((s) => s.isNew || s.isUpdated || s.isDeleted),
    [staged]
  );

  async function save(): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    const { toCreate, toUpdate, toDelete } = computeSaveOperations<Payee>(staged);
    const succeeded: SaveResult[] = [];
    const failed: SaveResult[] = [];
    const succeededCreateIds = new Set<string>();
    const idMap: Record<string, string> = {};

    // ── Creates (parallel) ────────────────────────────────────────────────────
    const createResults = await Promise.allSettled(
      toCreate.map((p) => createPayee(connection, { name: p.name }))
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

    // ── Resolve server IDs for created payees ─────────────────────────────────
    // The Actual HTTP API does not return the new payee's ID in the create
    // response. Fetch the fresh list and match by name to build the mapping
    // so that rules referencing newly created payees get the correct server ID.
    if (succeededCreateIds.size > 0) {
      try {
        const freshPayees = await getPayees(connection);
        const serverIdByName = new Map(freshPayees.map((p) => [p.name, p.id]));
        for (const p of toCreate) {
          if (succeededCreateIds.has(p.id)) {
            const serverId = serverIdByName.get(p.name);
            if (serverId) idMap[p.id] = serverId;
          }
        }
      } catch {
        // idMap stays empty; rules will fall back to client UUIDs
      }
    }

    // ── Updates (parallel) ────────────────────────────────────────────────────
    const updateResults = await Promise.allSettled(
      toUpdate.map((p) => updatePayee(connection, p.id, { name: p.name }))
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
      toDelete.map((id) => deletePayee(connection, id))
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

    // Remove temp-UUID staged entries for successful creates before refetch.
    if (succeededCreateIds.size > 0) {
      for (const id of succeededCreateIds) store.stageDelete("payees", id);
    }

    // Remove staged entries for successfully saved updates/deletes so that
    // loadPayees replaces them with fresh server data instead of preserving them.
    const succeededNonCreateIds = succeeded
      .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id))
      .map((r) => r.id);
    if (succeededNonCreateIds.length > 0) {
      store.markSaved("payees", succeededNonCreateIds);
    }

    if (failed.length > 0) {
      const errors: Record<string, string> = {};
      for (const f of failed) {
        if (f.status === "error") errors[f.id] = f.message;
      }
      useStagedStore.getState().setSaveErrors("payees", errors);
    }

    await queryClient.invalidateQueries({ queryKey: ["payees", connection.id] });

    return { succeeded, failed, idMap };
  }

  return { save, isSaving, hasPendingChanges };
}
