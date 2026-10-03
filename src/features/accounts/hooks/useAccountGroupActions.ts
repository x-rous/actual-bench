"use client";

import { useCallback } from "react";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { validateGroupName } from "../lib/accountGroups";

/**
 * Stage-only actions for account groups. Nothing here writes to Actual: every
 * change goes into the staged store (one undo step each) and is saved with the
 * rest of the draft.
 */
export function useAccountGroupActions() {
  const pushUndo = useStagedStore((s) => s.pushUndo);
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);

  /** Stages a new group, optionally assigning accounts to it. Returns the temp id, or an error. */
  const createGroup = useCallback(
    (
      name: string,
      assignAccountIds: string[] = [],
      /** False when the caller already took the undo step (a CSV import is one step). */
      recordUndo = true
    ): { id: string } | { error: string } => {
      const state = useStagedStore.getState();
      const error = validateGroupName(name, state.accountGroups);
      if (error) return { error };
      const id = generateId();
      if (recordUndo) pushUndo();
      stageNew("accountGroups", { id, name: name.trim() });
      for (const accountId of assignAccountIds) {
        if (state.accounts[accountId] && !state.accounts[accountId].isDeleted) {
          stageUpdate("accounts", accountId, { groupId: id });
        }
      }
      return { id };
    },
    [pushUndo, stageNew, stageUpdate]
  );

  const renameGroup = useCallback(
    (id: string, name: string): string | null => {
      const state = useStagedStore.getState();
      const error = validateGroupName(name, state.accountGroups, id);
      if (error) return error;
      if (state.accountGroups[id]?.entity.name === name.trim()) return null;
      pushUndo();
      stageUpdate("accountGroups", id, { name: name.trim() });
      return null;
    },
    [pushUndo, stageUpdate]
  );

  /**
   * Stages a group delete. Its accounts are shown as ungrouped straight away
   * (Actual keeps them and clears their group), so the draft matches the
   * result of Save.
   */
  const deleteGroup = useCallback(
    (id: string) => {
      const state = useStagedStore.getState();
      pushUndo();
      for (const entry of Object.values(state.accounts)) {
        if (entry.entity.groupId === id && !entry.isDeleted) {
          stageUpdate("accounts", entry.entity.id, { groupId: null });
        }
      }
      stageDelete("accountGroups", id);
    },
    [pushUndo, stageUpdate, stageDelete]
  );

  /** Assigns accounts to a group, or un-assigns them with `null`. One undo step. */
  const assignAccounts = useCallback(
    (accountIds: string[], groupId: string | null) => {
      const state = useStagedStore.getState();
      const targets = accountIds.filter((id) => {
        const entry = state.accounts[id];
        return entry && !entry.isDeleted && (entry.entity.groupId ?? null) !== groupId;
      });
      if (targets.length === 0) return;
      pushUndo();
      for (const id of targets) stageUpdate("accounts", id, { groupId });
    },
    [pushUndo, stageUpdate]
  );

  return { createGroup, renameGroup, deleteGroup, assignAccounts };
}
