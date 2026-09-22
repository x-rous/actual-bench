"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background text-primary-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary data-[indeterminate]:border-primary data-[indeterminate]:bg-primary",
        className
      )}
      {...props}
    >
      {/*
        Indeterminate is a third state, not a checked box: a dash says "some of
        these", which is what a select-all box over a partial selection means.
        The indicator renders for both states, so the glyphs swap on its own
        data attribute rather than needing a second element outside it.
      */}
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/checkbox-indicator flex items-center justify-center"
      >
        <CheckIcon
          className="size-3 group-data-[indeterminate]/checkbox-indicator:hidden"
          aria-hidden="true"
        />
        <MinusIcon
          className="hidden size-3 group-data-[indeterminate]/checkbox-indicator:block"
          aria-hidden="true"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
