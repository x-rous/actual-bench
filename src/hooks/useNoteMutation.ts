"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  setAccountNote,
  deleteAccountNote,
  setCategoryNote,
  deleteCategoryNote,
  setBudgetMonthNote,
  deleteBudgetMonthNote,
  toAccountNoteId,
  toBudgetNoteId,
} from "@/lib/api/notes";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export type EntityNoteKind = "account" | "category" | "budgetMonth";

/**
 * Direct-save mutations for a single entity note.
 *
 * **Intentional exception to the staged-mutation model.** AGENTS.md's contract
 * is "stage every mutation (stageNew/stageUpdate/stageDelete); nothing writes
 * until the user clicks Save." Notes are deliberately exempt: they live in their
 * own key-value table, orthogonal to entity dirty-state, with a self-contained
 * popover/panel editor. So Save/Clear here issue an immediate PUT/DELETE and
 * invalidate the note caches rather than routing through staged.ts /
 * budgetEdits.ts — don't "fix" this back onto the staged stores.
 *
 * `save` writes the note (empty/whitespace-only content clears it via DELETE
 * instead of persisting an empty string); `remove` clears it outright. When the
 * loaded notes cache confirms there's no note to clear, the DELETE is skipped
 * (an idempotent no-op) so an empty save on a fresh entity never surfaces a
 * false error; a cold cache still issues the DELETE rather than risk skipping a
 * note that exists server-side. Both invalidate the three note caches so the
 * popover, row indicators, and the budget grid refresh.
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

  // The notes-table key for this entity, matching how getAllNotes indexes them.
  function noteCacheKey(): string {
    if (kind === "account") return toAccountNoteId(id);
    if (kind === "budgetMonth") return toBudgetNoteId(id);
    return id;
  }

  // True only when the shared notes cache is loaded *and* shows no (non-empty)
  // note for this entity. A cold/never-fetched cache returns false — absence of
  // data is not evidence of absence — so clearNote() falls through to the DELETE
  // instead of silently skipping a note that may exist server-side.
  function noteKnownAbsent(): boolean {
    const state = queryClient.getQueryState<Map<string, string>>([
      "allNotes",
      connection?.id,
    ]);
    if (state?.status !== "success") return false;
    return (state.data?.get(noteCacheKey())?.trim().length ?? 0) === 0;
  }

  function clearNote(): Promise<void> {
    if (!connection) throw new Error("No active connection");
    // Skip the DELETE only when the cache positively confirms there's nothing to
    // clear; an unguarded DELETE on a never-created note can 404 and surface a
    // false "could not clear" error. A cold cache isn't confirmation, so delete.
    if (noteKnownAbsent()) return Promise.resolve();
    if (kind === "account") return deleteAccountNote(connection, id);
    if (kind === "budgetMonth") return deleteBudgetMonthNote(connection, id);
    return deleteCategoryNote(connection, id);
  }

  const save = useMutation({ mutationFn: writeNote, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: clearNote, onSuccess: invalidate });

  return { save, remove };
}
