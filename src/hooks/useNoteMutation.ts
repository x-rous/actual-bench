"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  setAccountNote,
  deleteAccountNote,
  setCategoryNote,
  deleteCategoryNote,
  setBudgetMonthNote,
  deleteBudgetMonthNote,
} from "@/lib/api/notes";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export type EntityNoteKind = "account" | "category" | "budgetMonth";

/**
 * Direct-save mutations for a single entity note.
 *
 * `save` writes the note (empty/whitespace-only content clears it via DELETE
 * instead of persisting an empty string); `remove` clears it outright. Both
 * invalidate the three note caches so the popover, row indicators, and the
 * budget grid refresh.
 *
 * `id` is the entity's own id, not the notes-table key:
 *   - `account`      → `/notes/account/{id}`      (stored key `account-{id}`)
 *   - `category`     → `/notes/category/{id}`     (stored key `{id}` — also
 *                       covers a `{categoryId}-{month}` cell, since the category
 *                       route is a raw pass-through to the key-value note store)
 *   - `budgetMonth`  → `/notes/budgetmonth/{id}`  (id is the bare `YYYY-MM`
 *                       month; stored key `budget-{id}`)
 */
export function useNoteMutation(kind: EntityNoteKind, id: string) {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ["entityNote", kind, connection?.id, id],
    });
    void queryClient.invalidateQueries({ queryKey: ["notesIndex", connection?.id] });
    void queryClient.invalidateQueries({ queryKey: ["allNotes", connection?.id] });
  }

  function writeNote(note: string) {
    if (!connection) throw new Error("No active connection");
    if (note.trim() === "") return clearNote();
    if (kind === "account") return setAccountNote(connection, id, note);
    if (kind === "budgetMonth") return setBudgetMonthNote(connection, id, note);
    return setCategoryNote(connection, id, note);
  }

  function clearNote() {
    if (!connection) throw new Error("No active connection");
    if (kind === "account") return deleteAccountNote(connection, id);
    if (kind === "budgetMonth") return deleteBudgetMonthNote(connection, id);
    return deleteCategoryNote(connection, id);
  }

  const save = useMutation({ mutationFn: writeNote, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: clearNote, onSuccess: invalidate });

  return { save, remove };
}
