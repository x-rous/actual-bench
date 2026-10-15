"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export function useDiscardChanges(dirty: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.getAttribute("href")?.startsWith("#") || event.ctrlKey || event.metaKey) return;
      if (!window.confirm("Discard unsaved credit-card changes and leave this page?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  return { requestClose: () => dirty ? setConfirming(true) : onClose(), discardDialog: <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent><DialogTitle>Discard unsaved changes?</DialogTitle><DialogDescription>Your saved records stay unchanged. Unsaved fields and transaction-review decisions will be lost.</DialogDescription><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(false)}>Keep editing</Button><Button variant="destructive" onClick={() => { setConfirming(false); onClose(); }}>Discard changes</Button></div></DialogContent></Dialog> };
}
