"use client";

import { cn } from "@/lib/utils";

/**
 * The same control where more than one option can be on at once.
 *
 * Kept beside `PillGroup` so the two read identically on screen — a filter that
 * happens to allow multiple choices should not look like a different kind of
 * control. `aria-pressed` rather than a radio role, because each pill toggles
 * independently.
 */
export function MultiPillGroup<T extends string>({
  options,
  values,
  onChange,
  emptyMeansAll = true,
}: {
  options: { value: T; label: string; count?: number }[];
  values: T[];
  onChange: (v: T[]) => void;
  /** Show the "All" pill as active when nothing is selected. */
  emptyMeansAll?: boolean;
}) {
  const selected = new Set(values);
  return (
    <div className="flex flex-wrap gap-px rounded border border-border bg-muted/40 p-px">
      {emptyMeansAll && (
        <button
          type="button"
          aria-pressed={selected.size === 0}
          onClick={() => onChange([])}
          className={cn(
            "rounded px-2 py-0.5 text-xs transition-colors",
            selected.size === 0
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          All
        </button>
      )}
      {options.map((opt) => {
        const on = selected.has(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                on ? values.filter((v) => v !== opt.value) : [...values, opt.value]
              )
            }
            className={cn(
              "rounded px-2 py-0.5 text-xs transition-colors",
              on
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className="ml-1 tabular-nums opacity-60">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-px rounded border border-border bg-muted/40 p-px">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded px-2 py-0.5 text-xs transition-colors",
            value === opt.value
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
