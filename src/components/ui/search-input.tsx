"use client"

import * as React from "react"
import { Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const HEIGHTS = {
  /** Filter bars, beside `Select className="h-6"` and pill groups. */
  xs: "h-6",
  sm: "h-7",
  default: "h-8",
} as const

/**
 * The search box every list and filter bar uses: a magnifier, the field, and
 * a clear button once there is something to clear.
 *
 * `className` sizes the box (usually a width); the field fills it.
 */
export function SearchInput({
  value,
  onValueChange,
  placeholder = "Search…",
  "aria-label": ariaLabel,
  clearLabel = "Clear search",
  size = "xs",
  className,
  title,
  autoFocus,
  onKeyDown,
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  "aria-label": string
  clearLabel?: string
  size?: keyof typeof HEIGHTS
  className?: string
  title?: string
  autoFocus?: boolean
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
}) {
  return (
    <div className={cn("relative flex w-44 items-center", className)}>
      <Search
        className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        title={title}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        className={cn(HEIGHTS[size], "pl-7 pr-7")}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label={clearLabel}
          className="absolute right-2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
