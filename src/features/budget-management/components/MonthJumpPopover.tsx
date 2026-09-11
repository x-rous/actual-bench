"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseMonth } from "@/lib/budget/monthMath";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type Props = {
  /** First month of the displayed window (YYYY-MM). */
  windowStart: string;
  /** Human range label, rendered as the trigger. */
  rangeLabel: string;
  /** Months the budget file actually has, for dimming the rest. */
  availableMonths?: string[];
  onWindowChange: (start: string) => void;
};

/**
 * Jump the 12-month window to any month (F-081).
 *
 * The toolbar could only step by one month or one year, so reaching a month two
 * years back meant a lot of clicking. The chosen month becomes the window's
 * first column, which is what the pan buttons already do.
 *
 * A month the budget file does not contain is still selectable: the grid has
 * always rendered missing past months as read-only rather than hiding them, and
 * refusing to navigate there would make a gap impossible to look at.
 */
export function MonthJumpPopover({
  windowStart,
  rangeLabel,
  availableMonths,
  onWindowChange,
}: Props) {
  const [open, setOpen] = useState(false);
  // `null` means "follow the window". Deriving rather than syncing means the
  // year is never stale when the window moves underneath us (pan buttons,
  // "current month"), and needs no effect to keep the two in step.
  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const year = yearOverride ?? parseMonth(windowStart)[0];
  const setYear = (next: (y: number) => number) =>
    setYearOverride((current) => next(current ?? parseMonth(windowStart)[0]));

  const availableSet = availableMonths ? new Set(availableMonths) : null;
  const [startYear, startMonth] = parseMonth(windowStart);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Drop the override on close so the next open starts from the window.
        if (!next) setYearOverride(null);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Displaying ${rangeLabel}. Jump to a month`}
            title="Jump to a month"
            className="min-w-[130px] text-center text-xs font-semibold text-foreground px-1 py-0.5 rounded hover:bg-muted transition-colors"
          >
            {rangeLabel}
          </button>
        }
      />
      <PopoverContent align="center" className="w-60 p-2">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            aria-label="Previous year"
            className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-semibold tabular-nums" aria-live="polite">
            {year}
          </span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            aria-label="Next year"
            className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {MONTH_LABELS.map((label, i) => {
            const month = `${year}-${String(i + 1).padStart(2, "0")}`;
            const isStart = year === startYear && i + 1 === startMonth;
            const missing = availableSet !== null && !availableSet.has(month);
            return (
              <button
                key={month}
                type="button"
                onClick={() => {
                  onWindowChange(month);
                  setOpen(false);
                }}
                aria-label={`Start the window at ${label} ${year}`}
                aria-current={isStart ? "true" : undefined}
                className={[
                  "px-2 py-1 text-xs rounded transition-colors",
                  isStart
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                  missing && !isStart ? "text-muted-foreground/60" : "",
                ].join(" ")}
                title={missing ? `${label} ${year} has no budget data` : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
