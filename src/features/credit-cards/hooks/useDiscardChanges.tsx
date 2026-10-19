"use client";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { registerUnsavedDraft } from "@/lib/unsavedDrafts";

/**
 * Asks before an open editor with unsaved changes is closed, or the page is left by a link,
 * with the app's ConfirmDialog (§9.14). Closing the browser tab still uses the browser's prompt.
 */
export function useDiscardChanges(dirty: boolean, onClose: () => void) {
  const [pending, setPending] = useState<{ leave: () => void } | null>(null);
  const bypass = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerUnsavedDraft();
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      if (bypass.current) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      // Leave the browser's own link behaviours alone: new tab or window, downloads, and clicks already handled.
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ leave: () => { bypass.current = true; link.click(); bypass.current = false; } });
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { unregister(); window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  return {
    requestClose: () => (dirty ? setPending({ leave: onClose }) : onClose()),
    /** Runs `action` at once, or after the user agrees to discard unsaved changes. */
    confirmThen: (action: () => void) => (dirty ? setPending({ leave: action }) : action()),
    discardDialog: <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }} state={pending && {
      title: "Discard unsaved changes?",
      message: "Your saved records stay unchanged. Unsaved fields and review answers will be lost.",
      cancelLabel: "Keep editing",
      destructiveLabel: "Discard changes",
      onConfirm: pending.leave,
    }} />,
  };
}
