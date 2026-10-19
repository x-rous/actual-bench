import { Circle, CircleAlert, CircleCheck, CircleDashed, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "../../lib/derive/status";

const TONES: Record<Tone, { className: string; Icon: typeof Circle }> = {
  success: { className: "border-green-600/25 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300", Icon: CircleCheck },
  attention: { className: "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200", Icon: TriangleAlert },
  danger: { className: "border-red-600/30 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300", Icon: CircleAlert },
  info: { className: "border-blue-600/25 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300", Icon: Clock },
  neutral: { className: "border-border bg-muted/60 text-foreground", Icon: Circle },
  muted: { className: "border-dashed border-muted-foreground/40 bg-background text-muted-foreground", Icon: CircleDashed },
};

/**
 * One badge set for the whole feature (§9.13): text plus an icon shape, so status never relies on
 * colour alone. Red is only overdue and errors; green only completed states. The detail line is a
 * tooltip (and read by screen readers) in tables; `stacked` shows it beside the badge, on the same line, for panels.
 */
export function StatusBadge({ label, tone, line, stacked = false, className }: {
  label: string; tone: Tone; line?: string; stacked?: boolean; className?: string;
}) {
  const { className: toneClass, Icon } = TONES[tone];
  const badge = <span title={line || undefined} className={cn("inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap", toneClass, !stacked && className)}>
    <Icon className="size-3 shrink-0" aria-hidden />
    <span className="truncate">{label}</span>
    {line && !stacked && <span className="sr-only">, {line}</span>}
  </span>;
  if (!stacked) return badge;
  return <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
    {badge}
    {line && <span className="min-w-0 truncate text-xs text-muted-foreground">{line}</span>}
  </span>;
}
