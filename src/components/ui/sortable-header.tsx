"use client";

import { useId } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A column header you can sort by.
 *
 * The entity tables each grew their own copy of this - the same tri-state
 * button, the same three icons, the same `aria-sort` on the cell. This is that
 * pattern extracted rather than reinvented, so a sortable column behaves and
 * announces itself the same way wherever it appears.
 *
 * Tri-state on purpose: ascending, descending, and back to the table's own
 * order. A sort you cannot undo forces a reload to see the default again.
 */

export type SortDirection = "asc" | "desc" | null;

export function nextSortDirection(current: SortDirection): SortDirection {
  return current === null ? "asc" : current === "asc" ? "desc" : null;
}

/**
 * Sort state for a table with one active column at a time.
 *
 * Returns the direction for `key` if it is the active column, and null
 * otherwise - so a header can render itself without knowing about its siblings.
 */
export function directionFor<K extends string>(
  sort: { key: K; direction: SortDirection } | null,
  key: K
): SortDirection {
  return sort && sort.key === key ? sort.direction : null;
}

export function SortableHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = "left",
  leading,
  note,
  description,
}: {
  label: string;
  sortKey: K;
  sort: { key: K; direction: SortDirection } | null;
  onSort: (key: K, direction: SortDirection) => void;
  className?: string;
  align?: "left" | "right" | "center";
  /** A marker shown before the label, such as the column a value is taken from. */
  leading?: React.ReactNode;
  /** What `leading` means, for anyone who cannot see it. */
  note?: string;
  /** Optional column explanation, available on hover and keyboard focus. */
  description?: string;
}) {
  const direction = directionFor(sort, sortKey);
  const descriptionId = useId();

  const sortButton = (
    <button
      type="button"
      className={cn(
        "flex max-w-full select-none items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        align === "right" && "ml-auto",
        align === "center" && "mx-auto",
        direction && "text-foreground"
      )}
      onClick={() => onSort(sortKey, nextSortDirection(direction))}
      title={description ? undefined :
        direction
          ? "Sort the other way, then back to the table's own order"
          : `Sort by ${label.toLowerCase()}`
      }
      aria-describedby={description ? descriptionId : undefined}
      aria-label={`Sort by ${label}${note ? ` (${note})` : ""}${
        direction === "asc" ? ", ascending" : direction === "desc" ? ", descending" : ""
      }`}
    >
      {leading}
      <span className={cn("truncate", description && "underline decoration-dotted underline-offset-4")}>{label}</span>
      {/* In the cell's own text, so the column announces what it is even
          when the reader lands on the header rather than the button. */}
      {note && <span className="sr-only">({note})</span>}
      {direction === null ? (
        <ArrowUpDown className="size-3 shrink-0 opacity-30" aria-hidden />
      ) : direction === "asc" ? (
        <ArrowUp className="size-3 shrink-0" aria-hidden />
      ) : (
        <ArrowDown className="size-3 shrink-0" aria-hidden />
      )}
    </button>
  );

  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2 font-medium",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      aria-sort={
        direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"
      }
    >
      {description ? <Tooltip.Root><Tooltip.Trigger render={sortButton} /><Tooltip.Portal><Tooltip.Positioner side="bottom" align="start" sideOffset={6} className="z-[80]"><Tooltip.Popup id={descriptionId} role="tooltip" className="max-w-72 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-md">{description}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root> : sortButton}
    </th>
  );
}

/**
 * Compare two rows by a value that may be missing.
 *
 * Missing values sort last in both directions rather than being treated as
 * empty strings or zeros: a backup that has never run is not "older than
 * everything", it is unknown, and burying it under real data in one direction
 * while floating it to the top in the other is how sorted tables mislead.
 */
export function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: Exclude<SortDirection, null>
): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return direction === "asc" ? result : -result;
}
