"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { useAllNotes } from "@/hooks/useAllNotes";
import { useNoteMutation, type EntityNoteKind } from "@/hooks/useNoteMutation";
import { toAccountNoteId, toBudgetNoteId } from "@/lib/api/notes";
import { cn } from "@/lib/utils";

type EntityNoteButtonProps = {
  entityId: string;
  entityKind: EntityNoteKind;
  entityLabel: string;
  entityTypeLabel: string;
  /** Cheap "this entity already has a note" hint (from the notes index) for trigger styling. */
  hasNote?: boolean;
  /** Popover placement relative to the trigger. Defaults to right/start. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
};

export function EntityNoteButton({
  entityId,
  entityKind,
  entityLabel,
  entityTypeLabel,
  hasNote = false,
  side = "right",
  align = "start",
  className,
}: EntityNoteButtonProps) {
  const [open, setOpen] = useState(false);
  // `userMode` overrides the default; null means "derive from whether a note exists".
  const [userMode, setUserMode] = useState<"read" | "edit" | null>(null);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const notesQuery = useAllNotes();
  const { save, remove } = useNoteMutation(entityKind, entityId);

  // Note content for every entity is already batched into one shared query (the
  // same data that drives the note indicators), so opening a popover reads from
  // cache instead of firing a slow per-entity request.
  const noteKey =
    entityKind === "account"
      ? toAccountNoteId(entityId)
      : entityKind === "budgetMonth"
        ? toBudgetNoteId(entityId)
        : entityId;
  const loadedNote = notesQuery.data?.get(noteKey) ?? "";
  // Until the batch resolves, fall back to the index hint; afterwards, trust the data.
  const noteExists = notesQuery.isSuccess ? loadedNote.trim().length > 0 : hasNote;
  // An empty note opens straight into edit (the "add note" path); otherwise read.
  const mode = userMode ?? (noteExists ? "read" : "edit");
  const dirty = draft !== loadedNote;
  const label = entityLabel || entityId;

  useEffect(() => {
    if (open && mode === "edit") textareaRef.current?.focus();
  }, [open, mode]);

  function enterEdit() {
    setDraft(loadedNote);
    save.reset();
    remove.reset();
    setUserMode("edit");
  }

  function handleCancel() {
    save.reset();
    if (noteExists) setUserMode("read");
    else setOpen(false);
  }

  function handleSave() {
    save.mutate(draft, { onSuccess: () => setUserMode("read") });
  }

  function handleClear() {
    remove.mutate(undefined, {
      onSuccess: () => {
        setDraft("");
        setUserMode("read");
      },
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUserMode(null);
          setDraft("");
          save.reset();
          remove.reset();
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "h-5 w-5 shrink-0 touch-manipulation transition-colors",
              noteExists
                ? "text-foreground/80 hover:text-foreground"
                : "text-muted-foreground/40 hover:text-foreground",
              className
            )}
          />
        }
        aria-label={
          noteExists
            ? `Edit note for ${entityTypeLabel} ${label}`
            : `Add note for ${entityTypeLabel} ${label}`
        }
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent
        side={side}
        align={align}
        sideOffset={10}
        className="w-[min(20rem,calc(100vw-2rem))] rounded"
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <StickyNote
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="truncate text-sm font-medium text-foreground">{label}</span>
          </div>
          {mode === "read" && noteExists && (
            <Button
              variant="ghost"
              size="xs"
              className="-mr-1 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={enterEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>

        {notesQuery.isLoading ? (
          <div
            aria-live="polite"
            className="flex min-h-16 items-center justify-center gap-2 px-3 pb-4 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading note…
          </div>
        ) : notesQuery.isError ? (
          <div aria-live="polite" className="space-y-2 px-3 pb-4">
            <p className="text-sm text-destructive">Could not load this note. Try again.</p>
            <Button variant="outline" size="sm" onClick={() => void notesQuery.refetch()}>
              <RefreshCw />
              Retry
            </Button>
          </div>
        ) : mode === "edit" ? (
          <div className="px-3 pb-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              placeholder="Write a note… Markdown supported."
              className="w-full resize-y rounded border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            {(save.isError || remove.isError) && (
              <p aria-live="polite" className="mt-2 text-xs text-destructive">
                {save.isError ? "Could not save the note. Try again." : "Could not clear the note. Try again."}
              </p>
            )}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              {noteExists ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-1 text-destructive hover:text-destructive"
                  onClick={handleClear}
                  disabled={save.isPending || remove.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {remove.isPending ? "Clearing…" : "Clear"}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="xs" onClick={handleCancel} disabled={save.isPending}>
                  Cancel
                </Button>
                <Button size="xs" onClick={handleSave} disabled={!dirty || save.isPending}>
                  {save.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : noteExists ? (
          <div
            aria-live="polite"
            className="max-h-80 overflow-auto overscroll-contain px-3 pb-3"
          >
            <MarkdownPreview markdown={loadedNote.trim()} />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2 px-3 pb-4">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              No note yet.
            </p>
            <Button variant="outline" size="xs" onClick={enterEdit}>
              <Plus className="h-3.5 w-3.5" />
              Add note
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
