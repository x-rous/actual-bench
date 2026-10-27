import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A figure like "-1,306,000.00" or "171.75%" split into its whole part and its decimals, so the decimals can be set smaller. */
export function withSmallDecimals(value: ReactNode): ReactNode {
  const match = typeof value === "string" ? /^([+\-\u2212]?\d[\d,]*)(\.\d+)(.*)$/.exec(value) : null;
  return match ? <>{match[1]}<span className="text-[0.7em] font-medium">{match[2]}</span>{match[3]}</> : value;
}
export function Figure({ label, value, detail, tone, trend, onTrend, wrap, smallDecimals }: {
  label: string; value: ReactNode; detail?: ReactNode; tone?: "danger"; trend?: ReactNode; onTrend?: () => void;
  /** Let the caption run to two lines instead of cutting it off with an ellipsis. */ wrap?: boolean;
  /** Set the decimals of a numeric value smaller, so the whole part is what the eye reads. */ smallDecimals?: boolean;
}) {
  return <div className={cn("relative min-w-0 px-4 py-3", trend && "pr-32")}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className={cn("mt-0.5 text-xl font-semibold whitespace-nowrap tabular-nums", tone === "danger" && "text-red-700 dark:text-red-400")}>{smallDecimals ? withSmallDecimals(value) : value}</dd>
    {detail && <dd className={cn("text-xs text-muted-foreground", wrap ? "line-clamp-2 min-h-8" : "truncate")}>{detail}</dd>}
    {trend && <dd className="absolute right-4 bottom-3">
      <button type="button" onClick={onTrend} aria-label={`Show ${label} trend`} className="rounded hover:bg-muted">{trend}</button>
    </dd>}
  </div>;
}
