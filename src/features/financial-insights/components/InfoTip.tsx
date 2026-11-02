"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The longer explanation of a card, kept out of the way: a small (i) beside the title opens it. What it says is also the
 * accessible name's description, so nothing is hidden from assistive technology.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button type="button" aria-label={`About ${label}`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-80 space-y-1.5 p-3 text-xs leading-relaxed text-muted-foreground">{children}</PopoverContent>
    </Popover>
  );
}

/** A card title with its short grey hint beside it and the full explanation behind an (i). */
export function CardTitle({ title, hint, info, infoLabel }: { title: ReactNode; hint?: ReactNode; info?: ReactNode; infoLabel?: string }) {
  const label = infoLabel ?? (typeof title === "string" ? title : "this chart");
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 className="text-sm font-semibold leading-tight">{title}</h2>
      {info && <span className="self-center"><InfoTip label={label}>{info}</InfoTip></span>}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </div>
  );
}
