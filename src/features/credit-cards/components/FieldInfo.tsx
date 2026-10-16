"use client";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
export function FieldInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return <Popover><PopoverTrigger type="button" aria-label={`About ${label}`} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"><Info className="size-3.5" aria-hidden /></PopoverTrigger><PopoverContent className="max-h-[80dvh] max-w-[min(28rem,90vw)] overflow-y-auto p-3 text-xs leading-relaxed [overflow-wrap:anywhere]" aria-label={label}>{children}</PopoverContent></Popover>;
}
