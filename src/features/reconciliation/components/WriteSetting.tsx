"use client";

import { cn } from "@/lib/utils";

/**
 * One choice about how a decision becomes a write.
 *
 * A segmented control rather than a select: there are two or three options, the
 * user is choosing a policy rather than picking from a list, and seeing the
 * alternatives is most of the explanation. Only the selected option explains
 * itself — three permanent hint blocks per setting was what made these taller
 * than the tables they were about.
 */
export function WriteSetting<T extends string>({
  label,
  legend,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint: string }[];
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <section className="rounded-md border border-border/60 px-3 py-2">
      <fieldset>
        <legend className="sr-only">{legend}</legend>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold text-muted-foreground">{label}</span>
          <div className="flex flex-wrap gap-px rounded border border-border bg-muted/40 p-px">
            {options.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded px-2 py-0.5 text-xs transition-colors",
                  option.value === value
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <input
                  type="radio"
                  name={name}
                  className="sr-only"
                  checked={option.value === value}
                  onChange={() => onChange(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
        {selected && <p className="mt-1 text-[11px] text-muted-foreground">{selected.hint}</p>}
      </fieldset>
    </section>
  );
}
