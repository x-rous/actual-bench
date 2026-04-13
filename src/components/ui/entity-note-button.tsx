"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { Loader2, RefreshCw, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { useEntityNote, type EntityNoteKind } from "@/hooks/useEntityNote";
import { cn } from "@/lib/utils";

let pinnedNoteKeyStore: string | null = null;
let previewNoteKeyStore: string | null = null;
const pinnedNoteListeners = new Set<() => void>();
const previewNoteListeners = new Set<() => void>();
const HOVER_PREVIEW_DELAY_MS = 350;

function subscribePinnedNote(listener: () => void) {
  pinnedNoteListeners.add(listener);
  return () => {
    pinnedNoteListeners.delete(listener);
  };
}

function getPinnedNoteSnapshot() {
  return pinnedNoteKeyStore;
}

function setPinnedNoteKey(nextKey: string | null) {
  if (pinnedNoteKeyStore === nextKey) return;
  pinnedNoteKeyStore = nextKey;
  for (const listener of pinnedNoteListeners) {
    listener();
  }
}

function subscribePreviewNote(listener: () => void) {
  previewNoteListeners.add(listener);
  return () => {
    previewNoteListeners.delete(listener);
  };
}

function getPreviewNoteSnapshot() {
  return previewNoteKeyStore;
}

function setPreviewNoteKey(nextKey: string | null) {
  if (previewNoteKeyStore === nextKey) return;
  previewNoteKeyStore = nextKey;
  for (const listener of previewNoteListeners) {
    listener();
  }
}

type EntityNoteButtonProps = {
  entityId: string;
  entityKind: EntityNoteKind;
  entityLabel: string;
  entityTypeLabel: string;
  className?: string;
};

export function EntityNoteButton({
  entityId,
  entityKind,
  entityLabel,
  entityTypeLabel,
  className,
}: EntityNoteButtonProps) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const noteKey = useMemo(() => `${entityKind}:${entityId}`, [entityId, entityKind]);
  const pinnedNoteKey = useSyncExternalStore(
    subscribePinnedNote,
    getPinnedNoteSnapshot,
    () => null
  );
  const previewNoteKey = useSyncExternalStore(
    subscribePreviewNote,
    getPreviewNoteSnapshot,
    () => null
  );
  const pinnedOpen = pinnedNoteKey === noteKey;
  const previewOpen = previewNoteKey === noteKey;
  const open = pinnedOpen || previewOpen;
  const noteQuery = useEntityNote(
    entityKind,
    entityId,
    shouldLoad || open
  );

  const trimmedNote = noteQuery.data?.trim() ?? "";
  const hasMeaningfulNote = trimmedNote.length > 0;

  function clearHoverTimer() {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function stopEvent(e: React.SyntheticEvent) {
    e.stopPropagation();
  }

  function clearActiveNote() {
    if (previewNoteKey !== null && previewNoteKey !== noteKey) {
      setPreviewNoteKey(null);
    }
    if (pinnedNoteKey !== null && pinnedNoteKey !== noteKey) {
      setPinnedNoteKey(null);
    }
  }

  function handleHoverPreviewIntent() {
    setShouldLoad(true);
    clearHoverTimer();
    clearActiveNote();
    hoverTimerRef.current = window.setTimeout(() => {
      setPreviewNoteKey(noteKey);
      hoverTimerRef.current = null;
    }, HOVER_PREVIEW_DELAY_MS);
  }

  function handleFocusPreviewIntent() {
    setShouldLoad(true);
    clearHoverTimer();
    clearActiveNote();
    setPreviewNoteKey(noteKey);
  }

  useEffect(() => {
    return () => {
      clearHoverTimer();
      if (getPreviewNoteSnapshot() === noteKey) {
        setPreviewNoteKey(null);
      }
      if (getPinnedNoteSnapshot() === noteKey) {
        setPinnedNoteKey(null);
      }
    };
  }, [noteKey]);

  return (
    <>
      <PreviewCard.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          clearHoverTimer();
          if (pinnedOpen) setPinnedNoteKey(null);
          if (!pinnedOpen && previewOpen) setPreviewNoteKey(null);
        }}
      >
        <PreviewCard.Trigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "h-5 w-5 shrink-0 touch-manipulation text-muted-foreground/80 hover:text-foreground focus-visible:text-foreground",
                className
              )}
            />
          }
          aria-label={`Preview note for ${entityTypeLabel} ${entityLabel || entityId}`}
          onMouseEnter={handleHoverPreviewIntent}
          onFocus={handleFocusPreviewIntent}
          onMouseDown={stopEvent}
          onClick={(e: React.MouseEvent) => {
            stopEvent(e);
            clearHoverTimer();
            setShouldLoad(true);
            setPreviewNoteKey(null);
            setPinnedNoteKey(pinnedOpen ? null : noteKey);
          }}
        >
          <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
        </PreviewCard.Trigger>

        <PreviewCard.Portal>
          <PreviewCard.Positioner
            side="right"
            align="start"
            sideOffset={10}
            className="z-[80]"
          >
            <PreviewCard.Popup
              className="z-[80] w-[min(30rem,calc(100vw-2rem))] origin-(--transform-origin) rounded-xl bg-popover p-0 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
              onMouseDown={stopEvent}
              onClick={stopEvent}
            >
              <div className="border-b border-border px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-muted-foreground">
                      {pinnedOpen ? "Note" : "Note Preview"}
                    </p>
                    <p className="truncate text-sm text-foreground">
                      {entityLabel || entityId}
                    </p>
                  </div>
                  {pinnedOpen && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setPinnedNoteKey(null)}
                    >
                      Close
                    </Button>
                  )}
                </div>
              </div>

              {noteQuery.isLoading ? (
                <div
                  aria-live="polite"
                  className="flex min-h-20 items-center justify-center gap-2 px-3 py-4 text-sm text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading note…
                </div>
              ) : noteQuery.isError ? (
                <div aria-live="polite" className="space-y-2 px-3 py-4">
                  <p className="text-sm text-destructive">
                    Could not load this note. Try again.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void noteQuery.refetch()}
                  >
                    <RefreshCw />
                    Retry
                  </Button>
                </div>
              ) : hasMeaningfulNote ? (
                <>
                  <div
                    aria-live="polite"
                    className="max-h-80 min-h-32 overflow-auto overscroll-contain px-3 py-3"
                  >
                    <MarkdownPreview markdown={trimmedNote} />
                  </div>
                  {!pinnedOpen && (
                    <div className="border-t border-border px-3 py-2 text-[13px] text-muted-foreground">
                      Click the note icon to keep this open.
                    </div>
                  )}
                </>
              ) : (
                <div aria-live="polite" className="px-3 py-4 text-sm text-muted-foreground">
                  This note is empty.
                </div>
              )}
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </>
  );
}
