import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared surfaces for the credit-card dashboards; tables keep their existing shell. */
export function DashboardPanel({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return <section aria-label={label} className={cn("min-w-0 rounded-xl border bg-background", className)}>{children}</section>;
}

export function DashboardStat({ label, value, detail, className }: { label: string; value: ReactNode; detail?: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-xl border bg-background px-4 py-3", className)}>
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
    {detail && <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd>}
  </div>;
}
