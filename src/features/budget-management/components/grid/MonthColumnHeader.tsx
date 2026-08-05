"use client";

import { cn } from "@/lib/utils";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { currentMonth, formatMonthLabel, monthElapsedFraction } from "@/lib/budget/monthMath";

/**
 * Sticky column header for a single month: full-name label plus a status dot.
 *
 *   transparent — month loaded, no staged edits
 *   amber  — month has unsaved staged changes
 *   gray   — month not yet created on the server
 *
 * Subscribes to the edits map only enough to know whether *any* key starts
 * with `${month}:`, so re-renders are scoped to changes for this column.
 *
 * Available months are clickable: selecting the header picks the whole month so
 * the details panel shows a month overview and the editable month note.
 */
export function MonthColumnHeader({
  month,
  availableMonths,
  isSelected,
  onSelect,
}: {
  month: string;
  availableMonths: string[];
  isSelected?: boolean;
  onSelect?: (month: string) => void;
}) {
  const hasStagedEdits = useBudgetEditsStore((s) =>
    Object.keys(s.edits).some((k) => k.startsWith(`${month}:`))
  );
  const isAvailable = availableMonths.includes(month);
  const isCurrentMonth = month === currentMonth();

  // RD-067: how far through the current month "today" is, for a subtle marker on
  // the current-month column (so a spending bar reads as fair — 80% spent on the
  // 5th ≠ on the 25th). Only meaningful for the current month.
  const now = new Date();
  const elapsedFraction = isCurrentMonth ? monthElapsedFraction(month, now) : null;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsedText = isCurrentMonth ? `, day ${now.getDate()} of ${daysInMonth}` : "";

  const label = formatMonthLabel(month, "long");

  const dotColor = !isAvailable
    ? "bg-muted-foreground/40"
    : hasStagedEdits
    ? "bg-amber-400 dark:bg-amber-500"
    : "bg-transparent";

  const dotTitle = !isAvailable
    ? "Month not yet created on server"
    : hasStagedEdits
    ? "Has unsaved staged changes"
    : "Loaded, no staged changes";

  const selectable = isAvailable && onSelect != null;

  return (
    <div
      className={cn(
        "relative h-8 px-2 flex items-center justify-end gap-1.5 border-b-2 text-xs sticky top-0 z-20",
        isCurrentMonth ? "font-bold" : "font-semibold",
        isSelected
          ? "border-primary/70 bg-muted text-foreground"
          : isCurrentMonth
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border bg-muted text-foreground",
        selectable && "cursor-pointer hover:bg-muted/70"
      )}
      aria-label={`Month: ${label}${isCurrentMonth ? ` (current month${elapsedText})` : ""}`}
      // Always present on the current-month header (even when the month is not
      // yet available/selectable) so orientation can reliably scroll to it.
      {...(isCurrentMonth ? { "aria-current": "date" as const, "data-current-month-header": "" } : {})}
      {...(selectable
        ? {
            role: "button",
            tabIndex: 0,
            "data-month-header": month,
            "aria-pressed": isSelected ?? false,
            title: `Select ${label}`,
            onClick: () => onSelect(month),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(month);
              }
            },
          }
        : {})}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`}
        title={dotTitle}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>

      {elapsedFraction !== null && (
        <span
          className="pointer-events-none absolute bottom-0 w-px h-2 bg-primary/70 rounded-t"
          style={{ left: `${elapsedFraction * 100}%` }}
          title={`Today${elapsedText}`}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
