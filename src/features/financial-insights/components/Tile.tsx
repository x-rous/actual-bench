import type { ReactNode } from "react";
import { withSmallDecimals } from "@/features/credit-cards/components/primitives/Figure";
import { cn } from "@/lib/utils";

/** One headline figure, with the decimals set smaller so the whole part is what the eye reads. `children` may be a link. */
export function Tile({ label, children, detail, tone }: { label: string; children: ReactNode; detail?: ReactNode; tone?: "warning" }) {
  return (
    <div className="flex min-h-[110px] min-w-0 flex-col rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={cn("mt-0.5 text-2xl font-semibold leading-tight tracking-tight tabular-nums", tone === "warning" && "text-amber-700 dark:text-amber-400")}>{typeof children === "string" ? withSmallDecimals(children) : children}</div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}
