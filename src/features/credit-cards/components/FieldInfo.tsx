"use client";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
export function FieldInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return <Popover><PopoverTrigger type="button" aria-label={`About ${label}`} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"><Info className="size-3.5" aria-hidden /></PopoverTrigger><PopoverContent className="max-w-[min(28rem,90vw)] text-xs leading-relaxed" aria-label={label}>{children}</PopoverContent></Popover>;
}
