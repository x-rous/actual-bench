"use client";

import { useBudgetEditsStore } from "@/store/budgetEdits";
import { formatMonthLabel } from "@/lib/budget/monthMath";

/**
 * Sticky column header for a single month: full-name label plus a status dot.
 *
 *   transparent — month loaded, no staged edits
 *   amber  — month has unsaved staged changes
 *   gray   — month not yet created on the server
 *
 * Subscribes to the edits map only enough to know whether *any* key starts
 * with `${month}:`, so re-renders are scoped to changes for this column.
 */
export function MonthColumnHeader({
  month,
  availableMonths,
  isSelected,
}: {
  month: string;
  availableMonths: string[];
  isSelected?: boolean;
}) {
  const hasStagedEdits = useBudgetEditsStore((s) =>
    Object.keys(s.edits).some((k) => k.startsWith(`${month}:`))
  );
  const isAvailable = availableMonths.includes(month);

  const label = formatMonthLabel(month, "long");

  const dotColor = !isAvailable
    ? "bg-muted-foreground/40"
    : hasStagedEdits
    ? "bg-amber-400"
    : "bg-transparent";

  const dotTitle = !isAvailable
    ? "Month not yet created on server"
    : hasStagedEdits
    ? "Has unsaved staged changes"
    : "Loaded, no staged changes";

  return (
    <div
      className={`h-8 px-2 flex items-center justify-end gap-1.5 border-b-2 text-xs font-semibold sticky top-0 z-20 ${
        isSelected
          ? "border-primary/70 bg-muted text-foreground ring-1 ring-inset ring-primary/50"
          : "border-border bg-muted text-foreground"
      }`}
      aria-label={`Month: ${label}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`}
        title={dotTitle}
        aria-hidden="true"
      />
      {label}
    </div>
  );
}
