"use client";

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { createAccount, updateAccount, deleteAccount } from "@/lib/api/accounts";
import {
  extractMessage,
  computeSaveOperations,
  hasPendingStagedChanges,
} from "@/lib/saveUtils";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { Account } from "@/types/entities";

export function useAccountsSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.accounts);
  const queryClient = useQueryClient();

  const hasPendingChanges = useMemo(
    () => hasPendingStagedChanges(staged),
    [staged]
  );

  async function save(): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    try {
      const { toCreate, toUpdate, toDelete } = computeSaveOperations<Account>(staged);
      const succeeded: SaveResult[] = [];
      const failed: SaveResult[] = [];
      const succeededCreateIds = new Set<string>();
      const idMap: Record<string, string> = {};

      // ── Creates (parallel) ──────────────────────────────────────────────────
      const createResults = await Promise.allSettled(
        toCreate.map((a) =>
          createAccount(connection, { name: a.name, offBudget: a.offBudget, closed: a.closed })
        )
      );
      for (let i = 0; i < toCreate.length; i++) {
        const id = toCreate[i].id;
        const r  = createResults[i];
        if (r.status === "fulfilled") {
          idMap[id] = r.value.id;
          succeeded.push({ status: "success", id });
          succeededCreateIds.add(id);
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Create failed") });
        }
      }

      // ── Updates (parallel) ──────────────────────────────────────────────────
      const updateResults = await Promise.allSettled(
        toUpdate.map((a) =>
          updateAccount(connection, a.id, { name: a.name, offBudget: a.offBudget, closed: a.closed })
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
        toDelete.map((id) => deleteAccount(connection, id))
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
      // Without this, loadAccounts preserves every isNew entry not in the server
      // response, causing the temp entry to linger alongside the newly-created row.
      if (succeededCreateIds.size > 0) {
        for (const id of succeededCreateIds) store.stageDelete("accounts", id);
      }

      // Remove staged entries for successfully saved updates/deletes. Without this,
      // loadAccounts sees isUpdated:true and preserves the dirty entry, so the
      // "draft changes" list never clears after a successful save.
      const succeededNonCreateIds = succeeded
        .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id))
        .map((r) => r.id);
      if (succeededNonCreateIds.length > 0) {
        store.markSaved("accounts", succeededNonCreateIds);
      }

      if (failed.length > 0) {
        const errors: Record<string, string> = {};
        for (const f of failed) {
          if (f.status === "error") errors[f.id] = f.message;
        }
        useStagedStore.getState().setSaveErrors("accounts", errors);
      }

      await queryClient.invalidateQueries({ queryKey: ["accounts", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["transactionCounts", "account", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["budget-overview", connection.id] });

      return { succeeded, failed, idMap };
    } finally {
      setIsSaving(false);
    }
  }

  return { save, isSaving, hasPendingChanges };
}
