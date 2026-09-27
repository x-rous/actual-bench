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
 *
 * `layout="radio"` stacks the options as radio buttons instead, for a choice
 * whose labels are long enough to be read as sentences.
 */
export function WriteSetting<T extends string>({
  label,
  legend,
  name,
  value,
  onChange,
  options,
  disabled = false,
  layout = "segmented",
}: {
  label: string;
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint: string }[];
  /** Keep a historical choice visible without allowing it to be changed. */
  disabled?: boolean;
  layout?: "segmented" | "radio";
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <section
      className={cn(
        "rounded-md border border-border/60 px-3 py-2",
        disabled && "bg-muted/20"
      )}
    >
      <fieldset disabled={disabled}>
        <legend className="sr-only">{legend}</legend>
        {layout === "radio" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{label}</span>
            {options.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 text-xs",
                  disabled && "cursor-not-allowed opacity-60"
                )}
              >
                <input
                  type="radio"
                  name={name}
                  className="size-3.5 accent-foreground"
                  checked={option.value === value}
                  disabled={disabled}
                  onChange={() => onChange(option.value)}
                />
                <span className={cn(option.value === value && "font-medium")}>{option.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold text-muted-foreground">{label}</span>
            <div className="flex flex-wrap gap-px rounded border border-border bg-muted/40 p-px">
              {options.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "cursor-pointer rounded px-2 py-0.5 text-xs transition-colors",
                    "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring",
                    disabled && "cursor-not-allowed opacity-60",
                    option.value === value
                      ? "bg-background font-medium shadow-sm"
                      : cn("text-muted-foreground", !disabled && "hover:text-foreground")
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    className="sr-only"
                    checked={option.value === value}
                    disabled={disabled}
                    onChange={() => onChange(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        )}
        {selected && <p className="mt-1 text-[11px] text-muted-foreground">{selected.hint}</p>}
      </fieldset>
    </section>
  );
}
