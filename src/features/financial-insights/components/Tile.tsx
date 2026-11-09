import type { ReactNode } from "react";
import { withSmallDecimals } from "@/features/credit-cards/components/primitives/Figure";
import { cn } from "@/lib/utils";
import { InfoTip } from "./InfoTip";

/**
 * One headline figure, with the decimals set smaller so the whole part is what the eye reads. `children` may be a link.
 * Every tile has the same height (the one the Money in & out tiles take: the label, the figure and two short lines), so a row
 * of them lines up on every tab. What a long explanation would say, how the figure is worked out, goes behind the (i)
 * (`info`); `detail` keeps to the short lines: a sub-figure, the change against the stretch before, the period it covers.
 */
export function Tile({ label, children, detail, tone, info, delta }: { label: string; children: ReactNode; detail?: ReactNode; tone?: "warning"; /** How the figure is worked out, behind an (i) beside the label. */ info?: ReactNode; /** How it moved against the stretch before (a `Delta`), to the right of the figure. */ delta?: ReactNode }) {
  return (
    <div className="flex min-h-[118px] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card px-4 py-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">{label}{info && <InfoTip label={label}>{info}</InfoTip>}</p>
      <div className="mt-0.5 flex min-w-0 items-start justify-between gap-2">
        <div className={cn("min-w-0 text-2xl font-semibold leading-tight tracking-tight tabular-nums", tone === "warning" && "text-amber-700 dark:text-amber-400")}>{typeof children === "string" ? withSmallDecimals(children) : children}</div>
        {delta && <div className="shrink-0 pt-0.5">{delta}</div>}
      </div>
      {detail && <div className="mt-1 min-h-0 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}
