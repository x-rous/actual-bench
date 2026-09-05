"use client";

import { Info } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/**
 * An explanation that costs no vertical space until it is asked for.
 *
 * Settings panels that explain every option in a block beneath it grow past the
 * height they are given, and then scroll — which is how the reconciliation
 * import panel ended up hiding its own preview behind a scrollbar despite a
 * docblock saying it is "sized to fit rather than to scroll" (F-135).
 *
 * Deliberately a `button`, not a bare icon with a `title`: `title` is
 * unreachable by keyboard, unreadable on touch, and appears after a delay the
 * user cannot predict. This opens on hover *and* on focus, so the explanation
 * is available to whoever needs it by whatever means they are using.
 */
export function InfoHint({
  children,
  label,
  className,
}: {
  /** The explanation. Keep it to a sentence or two — this is not documentation. */
  children: React.ReactNode;
  /**
   * What the hint is about, for anyone who reaches the control without seeing
   * the label beside it. Rendered as "More about {label}".
   */
  label: string;
  className?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            aria-label={`More about ${label}`}
            className={cn(
              "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full",
              "text-muted-foreground transition-colors hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className
            )}
          />
        }
      >
        <Info className="size-3.5" aria-hidden="true" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" align="start" sideOffset={6}>
          <Tooltip.Popup
            className={cn(
              "z-50 max-w-64 rounded-md bg-popover px-2.5 py-1.5",
              "text-[11px] leading-relaxed text-popover-foreground",
              "border border-border shadow-md"
            )}
          >
            {children}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
