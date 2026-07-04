"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAllNotes } from "@/hooks/useAllNotes";
import { useNoteMutation, type EntityNoteKind } from "@/hooks/useNoteMutation";
import { toAccountNoteId, toBudgetNoteId } from "@/lib/api/notes";
import {
  useConnectionStore,
  selectActiveInstance,
  isBrowserApiConnection,
} from "@/store/connection";

/** What the panel's note editor points at: the entity kind + its own id. */
export type BudgetNoteTarget = { kind: EntityNoteKind; id: string };

function noteKeyFor({ kind, id }: BudgetNoteTarget): string {
  if (kind === "account") return toAccountNoteId(id);
  if (kind === "budgetMonth") return toBudgetNoteId(id);
  return id;
}

/**
 * Inline, always-visible note for the Budget Management details panel.
 *
 * Unlike the table popovers (which hide content behind a click), this renders
 * the note text in place so it's readable the moment a cell/category/group is
 * selected; the Edit / Add affordance toggles an in-panel textarea that
 * direct-saves through the shared {@link useNoteMutation} stack.
 *
 * The parent re-keys this component per target, so a new selection mounts a
 * fresh editor — no effect-driven state reset (which the React Compiler's
 * set-state-in-effect rule forbids).
 */
export function BudgetNoteSection({ target }: { target: BudgetNoteTarget }) {
  const connection = useConnectionStore(selectActiveInstance);
  const directReadOnly = isBrowserApiConnection(connection);
  const { data: allNotes } = useAllNotes();
  const note = allNotes?.get(noteKeyFor(target)) ?? "";
  const { save, remove } = useNoteMutation(target.kind, target.id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const dirty = draft !== note;
  const busy = save.isPending || remove.isPending;

  function enterEdit() {
    if (directReadOnly) return;
    setDraft(note);
    save.reset();
    remove.reset();
    setEditing(true);
  }

  function cancel() {
    save.reset();
    setEditing(false);
    setDraft("");
  }

  function handleSave() {
    if (directReadOnly) return;
    // Blank draft on an entity that has no note: nothing to persist or clear, so
    // close without issuing a DELETE for a note that doesn't exist.
    if (!note && draft.trim() === "") {
      cancel();
      return;
    }
    save.mutate(draft, { onSuccess: () => setEditing(false) });
  }

  function handleClear() {
    if (directReadOnly) return;
    remove.mutate(undefined, {
      onSuccess: () => {
        setDraft("");
        setEditing(false);
      },
    });
  }

  return (
    <section className="rounded border border-border/60 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Note
        </p>
        {!editing && note && (
          <Button
            variant="ghost"
            size="xs"
            className="-mr-1 h-5 text-muted-foreground hover:text-foreground"
            onClick={enterEdit}
            disabled={directReadOnly}
            title={directReadOnly ? "Direct browser API mode is read-only" : undefined}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
        )}
      </div>

      {allNotes === undefined ? (
        <p className="text-[11px] text-muted-foreground/60">Loading…</p>
      ) : editing ? (
        <>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Write a note… Markdown supported."
            className="w-full resize-y rounded border border-input bg-transparent px-2 py-1.5 text-[11px] outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring"
          />
          {(save.isError || remove.isError) && (
            <p aria-live="polite" className="mt-1 text-[10px] text-destructive">
              {save.isError ? "Could not save the note. Try again." : "Could not clear the note. Try again."}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            {note ? (
              <Button
                variant="ghost"
                size="xs"
                className="-ml-1 h-5 text-destructive hover:text-destructive"
                onClick={handleClear}
                disabled={busy || directReadOnly}
                title={directReadOnly ? "Direct browser API mode is read-only" : undefined}
              >
                <Trash2 className="h-3 w-3" />
                {remove.isPending ? "Clearing…" : "Clear"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="xs" className="h-5" onClick={cancel} disabled={save.isPending}>
                Cancel
              </Button>
              <Button
                size="xs"
                className="h-5"
                onClick={handleSave}
                disabled={!dirty || busy || directReadOnly}
                title={directReadOnly ? "Direct browser API mode is read-only" : undefined}
              >
                {save.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </>
      ) : note ? (
        <p className="whitespace-pre-wrap text-[11px] text-foreground/80">{note}</p>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="-ml-1 h-5 text-muted-foreground hover:text-foreground"
          onClick={enterEdit}
          disabled={directReadOnly}
          title={directReadOnly ? "Direct browser API mode is read-only" : undefined}
        >
          <Plus className="h-3 w-3" />
          Add note
        </Button>
      )}
    </section>
  );
}
