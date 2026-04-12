"use client";

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { createSchedule, updateSchedule, deleteSchedule } from "@/lib/api/schedules";
import { extractMessage, computeSaveOperations } from "@/lib/saveUtils";
import type { SaveResult, SaveSummary } from "@/types/diff";
import type { Schedule } from "@/types/entities";

export function useSchedulesSave() {
  const [isSaving, setIsSaving] = useState(false);

  const connection = useConnectionStore(selectActiveInstance);
  const staged = useStagedStore((s) => s.schedules);
  const queryClient = useQueryClient();

  const hasPendingChanges = useMemo(
    () => Object.values(staged).some((s) => s.isNew || s.isUpdated || s.isDeleted),
    [staged]
  );

  async function save(): Promise<SaveSummary> {
    if (!connection) throw new Error("No active connection");

    setIsSaving(true);

    try {
    const ops = computeSaveOperations<Schedule>(staged);
    // Skip incomplete schedules (no date set)
    const toCreate = ops.toCreate.filter((s) => !!s.date);
    const toUpdate = ops.toUpdate.filter((s) => !!s.date);
    const { toDelete } = ops;

    const succeeded: SaveResult[] = [];
    const failed: SaveResult[] = [];
    const succeededCreateIds = new Set<string>();
    const idMap: Record<string, string> = {};

    // ── Creates (parallel) ────────────────────────────────────────────────────
    const createResults = await Promise.allSettled(
      toCreate.map((s) =>
        createSchedule(connection, {
          name: s.name,
          postsTransaction: s.postsTransaction,
          payeeId: s.payeeId,
          accountId: s.accountId,
          amount: s.amount,
          amountOp: s.amountOp,
          date: s.date,
        })
      )
    );
    for (let i = 0; i < toCreate.length; i++) {
      const stagedId = toCreate[i].id;
      const r = createResults[i];
      if (r.status === "fulfilled") {
        succeeded.push({ status: "success", id: stagedId });
        succeededCreateIds.add(stagedId);
        if (r.value.id && r.value.id !== stagedId) {
          idMap[stagedId] = r.value.id;
        }
      } else {
        failed.push({
          status: "error",
          id: stagedId,
          message: extractMessage(r.reason, "Create failed"),
        });
      }
    }

    // ── Updates (parallel) ────────────────────────────────────────────────────
    const updateResults = await Promise.allSettled(
      toUpdate.map((s) =>
        updateSchedule(connection, s.id, {
          name: s.name,
          postsTransaction: s.postsTransaction,
          payeeId: s.payeeId,
          accountId: s.accountId,
          amount: s.amount,
          amountOp: s.amountOp,
          date: s.date,
        })
      )
    );
    for (let i = 0; i < toUpdate.length; i++) {
      const id = toUpdate[i].id;
      const r = updateResults[i];
      if (r.status === "fulfilled") {
        succeeded.push({ status: "success", id });
      } else {
        failed.push({
          status: "error",
          id,
          message: extractMessage(r.reason, "Update failed"),
        });
      }
    }

    // ── Deletes (parallel) ────────────────────────────────────────────────────
    const deleteResults = await Promise.allSettled(
      toDelete.map((id) => deleteSchedule(connection, id))
    );
    for (let i = 0; i < toDelete.length; i++) {
      const id = toDelete[i];
      const r = deleteResults[i];
      if (r.status === "fulfilled") {
        succeeded.push({ status: "success", id });
      } else {
        failed.push({
          status: "error",
          id,
          message: extractMessage(r.reason, "Delete failed"),
        });
      }
    }

    const store = useStagedStore.getState();

    for (const id of succeededCreateIds) store.stageDelete("schedules", id);

    const succeededNonCreateIds = succeeded
      .filter((r) => r.status === "success" && !succeededCreateIds.has(r.id))
      .map((r) => r.id);
    if (succeededNonCreateIds.length > 0) {
      store.markSaved("schedules", succeededNonCreateIds);
    }

    if (failed.length > 0) {
      const errors: Record<string, string> = {};
      for (const f of failed) {
        if (f.status === "error") errors[f.id] = f.message;
      }
      store.setSaveErrors("schedules", errors);
    }

    await queryClient.invalidateQueries({ queryKey: ["schedules", connection.id] });
    await queryClient.invalidateQueries({ queryKey: ["rules", connection.id] });
    await queryClient.invalidateQueries({ queryKey: ["transactionCounts", "schedule", connection.id] });

    await queryClient.invalidateQueries({ queryKey: ["budget-overview", connection.id] });
    return { succeeded, failed, idMap };
    } finally {
      setIsSaving(false);
    }
  }

  return { save, isSaving, hasPendingChanges };
}
