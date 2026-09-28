"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type CheckboxProps = Omit<React.ComponentProps<"input">, "type" | "checked" | "onChange"> & {
  checked?: boolean
  /**
   * "Some of these": the dash a select-all box shows over a partial
   * selection. The browser has this state built in but only as a DOM
   * property, so it is set here rather than by every table.
   */
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}

/**
 * The app's checkbox: the browser's own, so it looks exactly like the one
 * people know from every other site - the browser's colour, tick and hover,
 * in light and dark mode. One component still, so every checkbox behaves the
 * same and the select-all dash is one prop.
 */
function Checkbox({ className, indeterminate = false, onCheckedChange, ref, ...props }: CheckboxProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      {...props}
      ref={(node) => {
        inputRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      // The one raw checkbox in the app; everything else uses this component.
      // eslint-disable-next-line no-restricted-syntax
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "m-0 shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 dark:scheme-dark",
        className
      )}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  )
}

export { Checkbox }
