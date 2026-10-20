import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { sourceLabels, typeLabel } from "../lib/classifications";
import type { TypeResolution } from "../lib/derive/types";

/**
 * The type chip (UI-4) with three visible states: Suggested is dotted, From category is plain,
 * Set by you is solid with a check. The source is spelled out, so colour is never the only cue.
 */
export function TypeChip({ type, amountMinor, className }: { type: TypeResolution; amountMinor: number; className?: string }) {
  return <span
    className={cn(
      "inline-flex h-5 min-w-0 max-w-full items-center gap-1 rounded border px-1.5 text-xs font-medium",
      type.source === "suggested" && "border-dotted border-muted-foreground/70 bg-background text-foreground",
      type.source === "user" && "border-foreground bg-foreground text-background",
      (type.source === "category" || type.source === "structure") && "border-border bg-muted text-foreground",
      className,
    )}
  >
    {type.source === "user" && <Check className="size-3 shrink-0" aria-hidden />}
    <span className="truncate">{typeLabel(type.kind, amountMinor)}{type.source === "suggested" ? " ?" : ""}</span>
    <span className="sr-only">, {sourceLabels[type.source]}</span>
    {type.changed && <span className="text-amber-700 dark:text-amber-400" aria-label="changed since you set it">•</span>}
  </span>;
}
