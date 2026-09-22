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
 * `optgroup` and `option` children work as usual.
 */
function SelectField({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select-field"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80",
        className
      )}
      {...props}
    />
  )
}

export { SelectField }
