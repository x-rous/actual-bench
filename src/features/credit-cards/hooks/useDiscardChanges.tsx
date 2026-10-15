"use client";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { registerUnsavedDraft } from "@/lib/unsavedDrafts";
export function useDiscardChanges(dirty: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerUnsavedDraft();
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.getAttribute("href")?.startsWith("#") || event.ctrlKey || event.metaKey) return;
      if (!window.confirm("Discard unsaved credit-card changes and leave this page?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { unregister(); window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  return {
    requestClose: () => dirty ? setConfirming(true) : onClose(),
    discardDialog: <ConfirmDialog open={confirming} onOpenChange={setConfirming} state={{
      title: "Discard unsaved changes?",
      message: "Your saved records stay unchanged. Unsaved fields and transaction-review decisions will be lost.",
      cancelLabel: "Keep editing",
      destructiveLabel: "Discard changes",
      onConfirm: onClose,
    }} />,
  };
}
