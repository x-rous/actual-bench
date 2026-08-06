"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

/**
 * Small, accessible help tooltip for the details panel.
 *
 * Replaces the hidden native `title=` attributes: the trigger is a focusable
 * button with a dotted underline (so the explanation is *discoverable*), and the
 * tooltip opens on hover **and** keyboard focus, closes on Escape, and wires
 * `role="tooltip"` + `aria-describedby` automatically — so the guidance we wrote
 * actually reaches keyboard and screen-reader users.
 */
export function InfoTooltip({
  content,
  children,
  side = "top",
  className,
}: {
  /** The explanatory text shown in the tooltip. */
  content: ReactNode;
  /** The visible trigger — typically the row label it explains. */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Applied to the trigger so it can keep the label's typography. */
  className?: string;
}) {
  return (
    <Tooltip.Provider delay={150} closeDelay={0}>
      <Tooltip.Root>
        <Tooltip.Trigger
          className={cn(
            "cursor-help rounded-sm text-left underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            className
          )}
        >
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side={side} sideOffset={6} className="z-[80]">
            <Tooltip.Popup className="max-w-[15rem] rounded-md bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-lg ring-1 ring-foreground/10">
              {content}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
