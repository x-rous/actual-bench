"use client";

import { useBudgetEditsStore } from "@/store/budgetEdits";
import { formatMonthLabel } from "@/lib/budget/monthMath";

/**
 * Sticky column header for a single month: full-name label plus a status dot.
 *
 *   green  — month loaded, no staged edits
 *   amber  — month has unsaved staged changes
 *   gray   — month not yet created on the server
 *
 * Subscribes to the edits map only enough to know whether *any* key starts
 * with `${month}:`, so re-renders are scoped to changes for this column.
 */
export function MonthColumnHeader({
  month,
  availableMonths,
}: {
  month: string;
  availableMonths: string[];
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
    : "bg-green-500";

  const dotTitle = !isAvailable
    ? "Month not yet created on server"
    : hasStagedEdits
    ? "Has unsaved staged changes"
    : "Loaded, no staged changes";

  return (
    <div
      className="h-8 px-2 flex items-center justify-end gap-1.5 border-b-2 border-border bg-muted text-xs font-semibold text-foreground sticky top-0 z-10"
      aria-label={`Month: ${label}`}
    >
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`}
        title={dotTitle}
        aria-hidden="true"
      />
      {label}
    </div>
  );
}
