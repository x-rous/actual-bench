"use client";
import { useEffect, useState } from "react";
import { CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  notice: string | undefined;
  /** Changes with every commit (the committed workspace), so a repeated message shows again. */
  stamp: unknown;
  canUndo: boolean;
  onUndo: () => void;
};

/** Destructive changes, and the outcome of Undo, get the popup; routine saves don't (users assume they're saved). */
const SHOWN = /deleted|reset|removed|undo/i;

/**
 * "Statement deleted · Undo" (§9.14). A live region; it hides after a few seconds. Undo is command-scoped
 * and refuses when the record changed since.
 */
export function SaveToast({ notice, stamp, canUndo, onUndo }: Props) {
  const [hidden, setHidden] = useState<{ notice: string; stamp: unknown } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setHidden({ notice, stamp }), 6000);
    return () => clearTimeout(timer);
  }, [notice, stamp]);
  const show = notice && SHOWN.test(notice) && (hidden?.notice !== notice || hidden.stamp !== stamp);
  return <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50">
    {show && <div className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm shadow-lg">
      <CircleCheck className="size-4 text-green-700 dark:text-green-400" aria-hidden />
      <span>{notice}</span>
      {canUndo && <Button size="xs" variant="outline" onClick={onUndo}>Undo</Button>}
      <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={() => setHidden({ notice, stamp })}><X className="size-3.5" aria-hidden /></Button>
    </div>}
  </div>;
}
