import type { ReactNode } from "react";
import { CircleDollarSign, Wallet, CalendarClock, AlertTriangle, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Settlement } from "../lib/repayments";

export type Tone = "info" | "success" | "attention" | "danger" | "neutral";
const tones = {
  info: { surface: "border-border bg-background", accent: "bg-muted text-muted-foreground", icon: CircleDollarSign },
  success: { surface: "border-chart-2/25 bg-chart-2/5", accent: "bg-chart-2/10 text-green-700 dark:text-green-400", icon: Wallet },
  attention: { surface: "border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/20", accent: "bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400", icon: CalendarClock },
  danger: { surface: "border-destructive/25 bg-destructive/5", accent: "bg-destructive/10 text-destructive", icon: AlertTriangle },
  neutral: { surface: "border-border bg-muted/20", accent: "bg-muted text-muted-foreground", icon: CircleDollarSign },
};

export function Metric({ label, children, detail, tone = "info", icon }: { label: string; children: ReactNode; detail?: string; tone?: Tone; icon?: LucideIcon }) {
  const style = tones[tone];
  const Icon = icon ?? style.icon;
  return <div className={cn("rounded-2xl border bg-background p-4", style.surface)}><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{label}</p><span className={cn("rounded-md p-1.5", style.accent)}><Icon className="size-3.5" aria-hidden="true" /></span></div><div className="text-2xl font-semibold tabular-nums">{children}</div>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>;
}

export function Status({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const variant = tone === "success" ? "status-active" : tone === "attention" ? "status-warning" : tone === "danger" ? "status-error" : "status-inactive";
  return <Badge className={tone === "info" ? "border-chart-1/20 bg-chart-1/5 text-chart-1" : undefined} variant={tone === "info" ? "outline" : variant}>{children}</Badge>;
}

export function settlementTone(payment?: Settlement): Tone {
  if (!payment || payment.fullRemainingMinor === null) return "neutral";
  if (payment.status === "Settled" || payment.status === "Settled · includes cashback" || payment.status === "Settled · includes credits" || payment.status === "No payment required") return "success";
  if (["Upcoming", "Due today"].includes(payment.status)) return "info";
  if (payment.status === "Minimum overdue") return "danger";
  return "attention";
}

/** Display bars clamp visually; their text retains overpayment/over-limit percentages. */
export function BalanceProgress({ label, percent, tone = "info", compact = false }: { label: string; percent: number; tone?: Tone; compact?: boolean }) {
  const bounded = Math.min(100, Math.max(0, percent));
  const fill = tone === "danger" ? "bg-destructive" : tone === "attention" ? "bg-amber-500" : tone === "success" ? "bg-chart-2" : "bg-chart-1";
  if (compact) return <div className="flex items-center gap-2"><div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} aria-valuetext={`${percent.toFixed(1)}%`} className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", fill)} style={{ width: `${bounded}%` }} /></div><span className="text-xs font-medium tabular-nums">{percent.toFixed(1)}%</span></div>;
  return <div className="space-y-1.5"><div className="flex items-center justify-between gap-3 text-xs">{!compact && <span className="text-muted-foreground">{label}</span>}<span className="font-medium tabular-nums">{percent.toFixed(1)}%</span></div><div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} aria-valuetext={`${percent.toFixed(1)}%`} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", fill)} style={{ width: `${bounded}%` }} /></div></div>;
}
