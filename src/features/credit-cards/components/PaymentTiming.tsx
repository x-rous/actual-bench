"use client";

import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatCardDate } from "../lib/displayDates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ActivityRow } from "../lib/activity";
import type { TimingState } from "../lib/paymentSummary";
import type { Statement } from "../lib/models";

/** A visual observation only; this component never determines payment satisfaction. */
export function PaymentTiming({ dueDate, date, closingDate, label, pending = false, state }: { dueDate: string; date?: string | null; closingDate?: string; label: string; pending?: boolean; state?: TimingState }) {
  const earlySpan = closingDate ? Math.max(1, daysBetween(closingDate, dueDate)) : 20;
  const delay = date ? daysBetween(dueDate, date) : null;
  const status = state ?? (pending ? "pending" : delay !== null && delay > 0 ? "late" : "on-time");
  const position = delay === null ? null : Math.max(2, Math.min(98, 75 + delay / earlySpan * 75));
  const description = `${label}. ${state ? `${state}. ` : ""} Due ${formatCardDate(dueDate)}${date ? `; ${status === "overdue" ? "as of" : "observed"} ${formatCardDate(date)}` : ""}${pending ? "; clearing pending" : ""}`;
  return <span className="block min-w-0" title={description}><span className="flex min-w-0 items-center gap-3"><span className="relative block h-4 w-28 shrink-0" aria-hidden><span className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-muted" /><span className="absolute left-3/4 top-0 h-4 w-0.5 bg-chart-1" />{position !== null && <span className={`absolute top-0.5 size-3 -translate-x-1/2 rounded-full border-2 border-background ring-1 ${status === "overdue" ? "bg-destructive ring-destructive" : ["partial", "pending"].includes(status) ? "bg-background ring-amber-600" : status === "late" ? "bg-amber-600 ring-amber-600" : "bg-green-600 ring-green-600"}`} style={{ left: `${position}%` }} />}</span><span className={`min-w-0 break-normal text-xs ${status === "overdue" ? "font-medium text-destructive" : status === "late" ? "text-amber-700 dark:text-amber-400" : ""}`}>{label}</span></span></span>;
}

export function PaymentDistribution({ payments, onDetails }: { payments: { row: ActivityRow; matchedStatement?: Statement }[]; onDetails: (id: string) => void }) {
  const matched = payments.filter((entry) => entry.matchedStatement?.bankConfirmed);
  if (!matched.length) return <p className="text-xs text-muted-foreground">Matched payments will appear against their statement’s due date here.</p>;
  const observations = matched.map(({ row, matchedStatement }) => ({ row, delay: daysBetween(matchedStatement!.dueDate, row.date) }));
  const earliest = Math.min(-20, ...observations.map((entry) => entry.delay));
  const latest = Math.max(7, ...observations.map((entry) => entry.delay));
  const x = (day: number) => (day - earliest) / (latest - earliest) * 100;
  const maximum = Math.max(...matched.map((entry) => entry.row.amountMinor), 1);
  const grouped = new Map<number, number>();
  return <div className="min-w-0" aria-label="Payment dates relative to statement due dates"><div className="relative mx-5 h-24"><span className="absolute inset-x-0 top-10 h-5 rounded bg-chart-1/5" aria-hidden /><span className="absolute top-10 right-0 h-5 bg-destructive/10" style={{ left: `${x(0)}%`, backgroundImage: "repeating-linear-gradient(135deg,transparent,transparent 4px,color-mix(in srgb,var(--destructive) 10%,transparent) 4px,color-mix(in srgb,var(--destructive) 10%,transparent) 8px)" }} aria-hidden /><span className="absolute top-5 bottom-4 w-0.5 bg-chart-1" style={{ left: `${x(0)}%` }} aria-hidden /><span className="absolute top-0 -translate-x-1/2 text-xs font-medium text-chart-1" style={{ left: `${x(0)}%` }}>Due date</span>{observations.map(({ row, delay }) => {
    const index = grouped.get(delay) ?? 0; grouped.set(delay, index + 1);
    const size = 10 + Math.sqrt(row.amountMinor / maximum) * 12;
    const lane = index % 5;
    return <button key={row.id} type="button" className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring ${row.cleared !== true ? "border-amber-700 bg-background" : delay > 0 ? "border-amber-700 bg-amber-500/60" : "border-green-700 bg-green-500/60"}`} style={{ left: `${x(delay)}%`, top: `${50 + (lane - 2) * 6}px`, width: size, height: size }} aria-label={`${formatCardDate(row.date)} · ${formatAmount(row.amountMinor, 2)} · ${delay === 0 ? "on due date" : `${Math.abs(delay)} days ${delay < 0 ? "early" : "late"}`}${row.cleared !== true ? " · clearing pending" : ""}`} title={`${formatCardDate(row.date)} · ${formatAmount(row.amountMinor, 2)}`} onClick={() => onDetails(row.id)} />;
  })}<span className="absolute bottom-0 left-0 text-xs text-muted-foreground">{Math.abs(earliest)} days early</span><span className="absolute right-0 bottom-0 text-xs text-muted-foreground">{latest} days late</span></div><p className="mt-2 text-xs text-muted-foreground">Each dot is an Actual payment; size reflects amount. Outlined dots await clearance.</p></div>;
}
