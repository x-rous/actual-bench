"use client";

import { useState, useMemo } from "react";
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
import type { Account, AccountGroup } from "@/types/entities";

export function useAccountsSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.accounts);
  const stagedGroups = useStagedStore((s) => s.accountGroups);
  const queryClient = useQueryClient();

  const hasPendingChanges = useMemo(
    () => hasPendingStagedChanges(staged) || hasPendingStagedChanges(stagedGroups),
    [staged, stagedGroups]
  );

  async function save(): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    try {
      const transport = getTransport(connection);
      const { toCreate, toUpdate, toDelete } = computeSaveOperations<Account>(staged);
      const succeeded: SaveResult[] = [];
      const failed: SaveResult[] = [];
      const succeededCreateIds = new Set<string>();
      const idMap: Record<string, string> = {};

      // ── Account groups: creates and renames first ───────────────────────────
      // Accounts reference groups, so a new group needs its real id before any
      // account is assigned to it. Group deletes run last (below), once no
      // account is being moved into the group any more.
      const groupsSupported =
        !!transport.createAccountGroup && !!transport.updateAccountGroup && !!transport.deleteAccountGroup;
      const groupOps = groupsSupported
        ? computeSaveOperations<AccountGroup>(stagedGroups)
        : { toCreate: [], toUpdate: [], toDelete: [] as string[] };
      const succeededGroupCreateIds = new Set<string>();
      const succeededGroupIds: string[] = [];

      const groupCreateResults = await settleTransportWrites(
        transport,
        groupOps.toCreate,
        (g) => transport.createAccountGroup!({ name: g.name })
      );
      groupOps.toCreate.forEach((g, i) => {
        const r = groupCreateResults[i];
        if (r.status === "fulfilled") {
          idMap[g.id] = r.value.id;
          succeeded.push({ status: "success", id: g.id });
          succeededGroupCreateIds.add(g.id);
        } else {
          failed.push({ status: "error", id: g.id, message: extractMessage(r.reason, "Create failed") });
        }
      });

      const groupUpdateResults = await settleTransportWrites(
        transport,
        groupOps.toUpdate,
        (g) => transport.updateAccountGroup!(g.id, { name: g.name })
      );
      groupOps.toUpdate.forEach((g, i) => {
        const r = groupUpdateResults[i];
        if (r.status === "fulfilled") {
          succeeded.push({ status: "success", id: g.id });
          succeededGroupIds.push(g.id);
        } else {
          failed.push({ status: "error", id: g.id, message: extractMessage(r.reason, "Update failed") });
        }
      });

      /** A group id the server knows, or undefined when its create failed. */
      const resolveGroupId = (groupId: string | null | undefined): string | null | undefined => {
        if (!groupId) return null;
        if (idMap[groupId]) return idMap[groupId];
        return stagedGroups[groupId]?.isNew ? undefined : groupId;
      };

      // ── Creates (parallel) ──────────────────────────────────────────────────
      const createResults = await settleTransportWrites(
        transport,
        toCreate,
        async (a) => {
          const created = await transport.createAccount({
            name: a.name,
            offBudget: a.offBudget,
            closed: a.closed,
            initialBalance: a.initialBalance,
          });
          // The create call has no group field, so a grouped new account is
          // created first and then assigned.
          let groupError: string | undefined;
          const groupId = resolveGroupId(a.groupId);
          if (a.groupId) {
            if (groupId === undefined) {
              groupError = "its group could not be created";
            } else if (groupId) {
              try {
                await transport.updateAccount(created.id, { groupId });
              } catch (error) {
                groupError = extractMessage(error, "assigning the group failed");
              }
            }
          }
          return { created, groupError };
        }
      );
      for (let i = 0; i < toCreate.length; i++) {
        const id = toCreate[i].id;
        const r = createResults[i];
        if (r.status === "fulfilled") {
          idMap[id] = r.value.created.id;
          succeeded.push({ status: "success", id });
          succeededCreateIds.add(id);
          if (r.value.groupError) {
            // The account exists; only its group is missing. Reported against
            // the real id, because the staged temp row is cleared below.
            failed.push({
              status: "error",
              id: r.value.created.id,
              message: `Account created, but ${r.value.groupError}. Assign its group again.`,
            });
          }
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Create failed") });
        }
      }

      // ── Updates (parallel) ──────────────────────────────────────────────────
      const updateResults = await settleTransportWrites(
        transport,
        toUpdate,
        async (a) => {
          const patch: Parameters<typeof transport.updateAccount>[1] = {
            name: a.name,
            offBudget: a.offBudget,
            closed: a.closed,
          };
          // Only touch the group when it changed, so servers without account
          // groups never see the field.
          const before = staged[a.id]?.original?.groupId ?? null;
          const after = a.groupId ?? null;
          if (groupsSupported && after !== before) {
            const groupId = resolveGroupId(after);
            if (groupId === undefined) throw new Error("Its group could not be created.");
            patch.groupId = groupId;
          }
          return transport.updateAccount(a.id, patch);
        }
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
        (id) => transport.deleteAccount(id)
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

      // ── Account groups: deletes last ────────────────────────────────────────
      // The server keeps a deleted group's accounts and leaves them ungrouped.
      const groupDeleteResults = await settleTransportWrites(
        transport,
        groupOps.toDelete,
        (id) => transport.deleteAccountGroup!(id)
      );
      groupOps.toDelete.forEach((id, i) => {
        const r = groupDeleteResults[i];
        if (r.status === "fulfilled") {
          succeeded.push({ status: "success", id });
          succeededGroupIds.push(id);
        } else {
          failed.push({ status: "error", id, message: extractMessage(r.reason, "Delete failed") });
        }
      });

      const store = useStagedStore.getState();

      // Same cleanup as accounts: drop the temp rows of created groups, and
      // clear the dirty flag of renamed/deleted ones.
      for (const id of succeededGroupCreateIds) store.stageDelete("accountGroups", id);
      if (succeededGroupIds.length > 0) store.markSaved("accountGroups", succeededGroupIds);

      // Remove temp-UUID staged entries for successful creates before refetch.
      // Without this, loadAccounts preserves every isNew entry not in the server
      // response, causing the temp entry to linger alongside the newly-created row.
      if (succeededCreateIds.size > 0) {
        for (const id of succeededCreateIds) store.stageDelete("accounts", id);
      }

      // Remove staged entries for successfully saved updates/deletes. Without this,
      // loadAccounts sees isUpdated:true and preserves the dirty entry, so the
      // "draft changes" list never clears after a successful save.
      const succeededGroupSet = new Set([...succeededGroupCreateIds, ...succeededGroupIds]);
      const succeededNonCreateIds = succeeded
        .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id) && !succeededGroupSet.has(r.id))
        .map((r) => r.id);
      if (succeededNonCreateIds.length > 0) {
        store.markSaved("accounts", succeededNonCreateIds);
      }

      // An account that failed to save may still point at a group that was
      // created under a temp id; repoint it so the retry is not left dangling.
      for (const f of failed) {
        const entry = staged[f.id];
        const groupId = entry?.entity.groupId;
        if (groupId && idMap[groupId]) {
          useStagedStore.getState().stageUpdate("accounts", f.id, { groupId: idMap[groupId] });
        }
      }

      if (failed.length > 0) {
        const accountErrors: Record<string, string> = {};
        const groupErrors: Record<string, string> = {};
        for (const f of failed) {
          if (f.status !== "error") continue;
          if (stagedGroups[f.id]) groupErrors[f.id] = f.message;
          else accountErrors[f.id] = f.message;
        }
        useStagedStore.getState().setSaveErrors("accounts", accountErrors);
        useStagedStore.getState().setSaveErrors("accountGroups", groupErrors);
      }

      await syncTransportAfterChanges(transport, succeeded.length > 0);

      await queryClient.invalidateQueries({ queryKey: ["accounts", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["accountGroups", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["transactionCounts", "account", connection.id] });
      await queryClient.invalidateQueries({ queryKey: ["budget-overview", connection.id] });

      return { succeeded, failed, idMap };
    } finally {
      setIsSaving(false);
    }
  }

  return { save, isSaving, hasPendingChanges };
}
