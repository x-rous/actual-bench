"use client";

import { withSmallDecimals } from "@/features/credit-cards/components/primitives/Figure";
import { cn } from "@/lib/utils";

/** A figure that opens the transactions behind it. Underlined, so it reads as a link and is reachable by keyboard. */
export function DrillLink({ children, label, onClick, className, smallDecimals }: { children: React.ReactNode; label: string; onClick: () => void; className?: string; /** Set the decimals smaller, for a headline figure. */ smallDecimals?: boolean }) {
  return (
    <button type="button" className={cn("tabular-nums underline decoration-muted-foreground/60 underline-offset-4 hover:text-primary hover:decoration-primary", className)} aria-label={`${label}. Show the transactions`} onClick={onClick}>
      {smallDecimals ? withSmallDecimals(children) : children}
    </button>
  );
}
