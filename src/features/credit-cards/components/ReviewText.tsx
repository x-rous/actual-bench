"use client";
import { cn } from "@/lib/utils";
import { useRef, type ReactNode } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

/** Keep source text searchable and on one line; keyboard users can open it in full. */
export function ReviewText({ text, label, detail, className, children }: { text: string; label: string; detail?: string; className?: string; children?: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null);
  return <Popover><PopoverTrigger ref={trigger} className={cn("block w-full truncate text-left rounded-sm focus-visible:outline-2 focus-visible:outline-ring", className)} title={detail ?? text} aria-label={`Read full ${label}`}>{children ?? text}</PopoverTrigger><PopoverContent aria-label={label} finalFocus={() => { trigger.current?.focus({ preventScroll: true }); return false; }} align="start" className="max-w-[min(36rem,90vw)] p-3 text-xs"><p className="mb-1 font-medium">{label}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{detail ?? text}</p></PopoverContent></Popover>;
}
