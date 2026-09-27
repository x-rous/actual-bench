import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A native select that looks like the rest of the app's fields.
 *
 * Deliberately native rather than a listbox built out of popovers: these are
 * short lists of settings, often inside a dialog, and the platform control
 * already handles typeahead, keyboard, touch, and being opened near the edge
 * of a small screen. What it does not do on its own is match `Input`, which is
 * what this adds - the same height, radius, border, and focus ring, so a form
 * of selects and text fields reads as one form.
 *
 * `size="sm"` is the compact form for dense rows (toolbars, table filters,
 * inline editors), where the default would stand taller than its neighbours.
 * `optgroup` and `option` children work as usual.
 */
function SelectField({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "default" | "sm" }) {
  return (
    <select
      data-slot="select-field"
      data-size={size}
      className={cn(
        "w-full min-w-0 rounded-lg border border-input bg-background transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-2 py-1 text-sm",
        className
      )}
      {...props}
    />
  )
}

export { SelectField }
