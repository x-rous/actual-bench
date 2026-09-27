import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"
import { FIELD_FOCUS } from "@/components/ui/field-focus"

type InputSize = "sm" | "default" | "lg"

const SIZES: Record<InputSize, string> = {
  sm: "h-7 px-2 text-xs",
  default: "h-8 px-2 text-xs",
  /** Full-page forms (sign-in, connect), where a field is the whole screen's point. */
  lg: "h-9 px-3 text-sm",
}

/**
 * The app's text field: the same height, border, corners and focus ring as
 * `Select`, so a row of fields and dropdowns reads as one form. `size="sm"` is
 * the compact form for dense rows.
 *
 * Dates use `DateInput` (typed in the budget's format, with a calendar). A
 * time stays the browser's own (`type="time"`); `scheme-dark` gives its
 * picker dark colours in dark mode.
 */
function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & { size?: InputSize }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        "w-full min-w-0 rounded-md border border-input bg-background transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:scheme-dark dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        FIELD_FOCUS,
        SIZES[size],
        className
      )}
      {...props}
    />
  )
}

export { Input }
