import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatCardDate } from "../lib/displayDates";

type CyclePreview = { closingDate: string; dueDate: string };

/** Visualizes the editor's existing calendar predictions; never changes billing rules. */
export function BillingCyclePreview({ today, cycle, next }: { today: string; cycle: CyclePreview; next: CyclePreview | null }) {
  const end = [cycle.closingDate, cycle.dueDate, next?.closingDate ?? cycle.closingDate].sort().at(-1)!;
  const span = Math.max(1, daysBetween(today, end));
  const x = (date: string) => 8 + daysBetween(today, date) / span * 584;
  const close = x(cycle.closingDate), due = x(cycle.dueDate), following = x(next?.closingDate ?? cycle.closingDate);
  return <figure className="col-span-full rounded-lg border bg-muted/10 px-3 py-2 text-xs" aria-label="Billing cycle preview">
    <figcaption className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Your next two cycles</span><span className="text-muted-foreground">Closes <strong className="font-medium text-foreground">{formatCardDate(cycle.closingDate)}</strong> · pay by <strong className="font-medium text-chart-1">{formatCardDate(cycle.dueDate)}</strong> · {daysBetween(cycle.closingDate, cycle.dueDate)} days to pay</span></figcaption>
    <svg viewBox="0 0 600 82" className="mt-2 w-full overflow-visible" aria-hidden="true">
      <rect x="8" y="8" width={Math.max(0, close - 8)} height="13" rx="2" className="fill-muted stroke-muted-foreground/40" />
      {next && <rect x={close} y="8" width={Math.max(0, following - close)} height="13" rx="2" strokeDasharray="3 2" className="fill-transparent stroke-chart-1/40" />}
      <text x="12" y="18" fontSize="10" className="fill-muted-foreground">This cycle</text>
      <rect x={close} y="30" width={Math.max(0, due - close)} height="13" rx="2" className="fill-chart-1/15" />
      {due - close > 45 && <text x={close + 5} y="40" fontSize="10" className="fill-chart-1">To pay</text>}
      <line x1="8" x2="8" y1="25" y2="47" className="stroke-foreground" />
      <line x1={close} x2={close} y1="8" y2="47" className="stroke-muted-foreground/50" />
      <line x1={due} x2={due} y1="26" y2="48" strokeWidth="2" className="stroke-chart-1" />
      <text x="8" y="77" fontSize="10" className="fill-muted-foreground">Today</text>
      <text x={Math.max(50, Math.min(550, close))} y="59" textAnchor="middle" fontSize="10" className="fill-muted-foreground">{formatCardDate(cycle.closingDate)}</text>
      {next && <text x={Math.min(592, following)} y="59" textAnchor="end" fontSize="10" className="fill-muted-foreground">{formatCardDate(next.closingDate)}</text>}
      <text x={Math.max(90, due)} y="77" textAnchor="end" fontSize="10" className="fill-chart-1">{formatCardDate(cycle.dueDate)}</text>
    </svg>
    {next && <p className="text-muted-foreground">Next cycle: closes {formatCardDate(next.closingDate)} · pay by {formatCardDate(next.dueDate)}</p>}
  </figure>;
}
