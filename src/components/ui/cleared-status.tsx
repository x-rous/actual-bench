import { Check, CircleCheck, Circle, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A transaction's Actual clearing state, drawn the way Actual draws it: a filled green circle with a
 * check when cleared, an empty circle when not, a question mark when unknown. The label is always
 * available to screen readers and as a tooltip (DESIGN.md §4.1).
 */
export function ClearedStatus({ cleared, className }: { cleared: boolean | null; className?: string }) {
  const label = cleared === true ? "Cleared" : cleared === false ? "Not cleared" : "Clearing unknown";
  return <span role="img" aria-label={label} title={label} className={cn("inline-flex justify-center", className)}>
    {cleared === true
      ? <CircleCheck className="size-4 fill-green-600 text-background dark:fill-green-500" aria-hidden />
      : cleared === false
        ? <Circle className="size-4 text-muted-foreground" aria-hidden />
        : <CircleHelp className="size-4 text-muted-foreground" aria-hidden />}
  </span>;
}

/** The Cleared column header: a check icon, with "Cleared" for screen readers and as a tooltip. */
export function ClearedHeader() {
  return <span title="Cleared" className="inline-flex justify-center">
    <Check className="size-3.5 text-primary" aria-hidden />
    <span className="sr-only">Cleared</span>
  </span>;
}
