"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean };
export type SelectOptionGroup = { label: string; options: SelectOption[] };

/**
 * The app's dropdown: the same look as the searchable pickers (budgets,
 * categories), for choices short enough not to need a search box. Its list
 * opens in a layer above the page, so a scrolling table or dialog never clips
 * it, and it keeps the platform's keys: arrows, Enter, Escape, and typing to
 * jump to an option.
 *
 * Pass `options`, or `groups` for a list with headings (or both: ungrouped
 * options come first). Values are strings, as with a native select.
 * `size="sm"` is the compact form for dense rows.
 */
export function Select({
  value,
  onValueChange,
  options = [],
  groups = [],
  placeholder,
  size = "default",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  title,
  defaultOpen,
  onOpenChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  /** Shown when `value` matches no option (typically ""). */
  placeholder?: string;
  size?: "default" | "sm";
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  title?: string;
  /** Open the list on mount: an inline editor that appears when a cell is clicked. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const all = [...options, ...groups.flatMap((group) => group.options)];
  const items = Object.fromEntries(all.map((option) => [option.value, option.label]));
  const known = Object.prototype.hasOwnProperty.call(items, value);

  return (
    <SelectPrimitive.Root
      value={known ? value : null}
      items={items}
      disabled={disabled}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined}
      onValueChange={(next) => {
        if (next !== null) onValueChange(String(next));
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        title={title}
        data-size={size}
        className={cn(
          "flex w-full min-w-0 items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
          size === "sm" ? "h-7" : "h-8",
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} className="truncate" />
        <SelectPrimitive.Icon className="shrink-0">
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-[80] outline-none">
          <SelectPrimitive.Popup className="max-h-[min(20rem,var(--available-height))] min-w-(--anchor-width) overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md outline-none">
            {options.map((option) => (
              <SelectItem key={option.value} option={option} />
            ))}
            {groups.map((group) => (
              <SelectPrimitive.Group key={group.label}>
                <SelectPrimitive.GroupLabel className="px-2 pt-2 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase select-none">
                  {group.label}
                </SelectPrimitive.GroupLabel>
                {group.options.map((option) => (
                  <SelectItem key={option.value} option={option} indent />
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function SelectItem({ option, indent }: { option: SelectOption; indent?: boolean }) {
  return (
    <SelectPrimitive.Item
      value={option.value}
      disabled={option.disabled}
      className={cn(
        "flex w-full cursor-default items-center gap-2 py-1.5 pr-2 text-xs outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        indent ? "pl-4" : "pl-2"
      )}
    >
      <span className="flex h-3 w-3 shrink-0 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3 w-3" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText className="truncate">{option.label}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
