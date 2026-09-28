import * as React from "react"

import { cn } from "@/lib/utils"
import { FIELD_FOCUS } from "@/components/ui/field-focus"

/**
 * The app's multi-line field: the same border, corners, text size and focus
 * ring as `Input`, sized by the caller (`rows`, or a height class).
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- the shared Textarea itself
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs transition-colors outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:scheme-dark",
        FIELD_FOCUS,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
