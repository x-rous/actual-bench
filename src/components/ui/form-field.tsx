"use client";

import type { ReactNode } from "react";
import { InfoHint } from "@/components/ui/info-hint";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The label every editor uses: small, gray, with an (i) hint for the explanation (the Credit Cards editor's
 * look). The explanation lives in `help`, so forms stay short and the guidance is one hover or focus away.
 * Pass `error` to show a message beneath the control; give the control `aria-describedby={errorId}`.
 */
export function FormField({ label, htmlFor, help, required, error, errorId, note, className, children }: {
  label: ReactNode; htmlFor?: string; help?: ReactNode; required?: boolean; error?: string | null; errorId?: string;
  /** A quiet line beneath the control (for example today's recorded value). */ note?: ReactNode; className?: string; children: ReactNode;
}) {
  return <div className={cn("flex min-w-0 flex-col gap-1", className)}>
    <div className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
      <Label className={cn("text-xs leading-4", required && "after:ml-0.5 after:text-destructive after:content-['*']")} htmlFor={htmlFor}>{label}</Label>
      {help && <InfoHint label={typeof label === "string" ? label : "this field"}>{help}</InfoHint>}
    </div>
    {children}
    {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    {error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
