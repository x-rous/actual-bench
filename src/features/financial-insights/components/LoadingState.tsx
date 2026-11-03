"use client";

import { Loader2 } from "lucide-react";

/** A spinner in the middle of the page, with what is being read now. The spinner stands still for people who ask for less motion. */
export function LoadingState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center" role="status" aria-live="polite">
      <Loader2 className="size-8 text-muted-foreground motion-safe:animate-spin" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
