import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Figure({ label, value, detail, tone, trend, onTrend }: {
  label: string; value: ReactNode; detail?: ReactNode; tone?: "danger"; trend?: ReactNode; onTrend?: () => void;
}) {
  return <div className={cn("relative min-w-0 px-4 py-3", trend && "pr-32")}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className={cn("mt-0.5 text-xl font-semibold whitespace-nowrap tabular-nums", tone === "danger" && "text-red-700 dark:text-red-400")}>{value}</dd>
    {detail && <dd className="truncate text-xs text-muted-foreground">{detail}</dd>}
    {trend && <dd className="absolute right-4 bottom-3">
      <button type="button" onClick={onTrend} aria-label={`Show ${label} trend`} className="rounded hover:bg-muted">{trend}</button>
    </dd>}
  </div>;
}
