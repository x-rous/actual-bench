"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChoiceOption<T extends string> = { value: T; title: ReactNode; detail?: ReactNode; disabled?: boolean; /** Why it is unavailable, shown instead of the detail. */ reason?: string };

/**
 * A small set of mutually exclusive choices drawn as cards, for a question with plain-language answers (a wizard step).
 * Native radio inputs underneath: one tab stop, arrow keys move the choice, and the group is named for assistive tech.
 */
export function ChoiceCards<T extends string>({ legend, hideLegend = false, name, value, onChange, options, columns = 1, className }: {
  legend: ReactNode; /** Keep the legend for assistive technology only (the step heading already says it). */ hideLegend?: boolean; name: string; value: T | null; onChange: (value: T) => void; options: ChoiceOption<T>[]; columns?: 1 | 2 | 3 | 4; className?: string;
}) {
  return <fieldset className={cn("grid gap-2", className)}>
    <legend className={cn("text-xs font-medium text-muted-foreground", hideLegend ? "sr-only" : "mb-1.5")}>{legend}</legend>
    <div className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3", columns === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
      {options.map((option) => <label key={option.value} className={cn("relative block", option.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
        <input type="radio" name={name} className="peer sr-only" value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} />
        <span className="flex h-full flex-col gap-0.5 rounded-lg border bg-background px-3 py-2.5 transition-colors hover:bg-accent/40 peer-checked:border-foreground peer-checked:bg-accent/50 peer-checked:ring-1 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:hover:bg-background">
          <span className="text-xs font-medium">{option.title}</span>
          {(option.reason || option.detail) && <span className="text-[11px] leading-snug text-muted-foreground">{option.reason ?? option.detail}</span>}
        </span>
      </label>)}
    </div>
  </fieldset>;
}
