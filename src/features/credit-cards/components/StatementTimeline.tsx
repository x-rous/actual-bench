"use client";

import { addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { activityKind, paymentEvidence, type ActivityRow, type ActivitySnapshot } from "../lib/activity";
import { cycleDates } from "../lib/cycles";
import { formatCardDate } from "../lib/displayDates";
import { matchedPaymentStatement, type Settlement } from "../lib/repayments";
import { paymentTarget, paymentTargetRemaining } from "../lib/paymentTargets";
import { statementOutcome } from "../lib/paymentSummary";
import { statementChargeBreakdown } from "../lib/planReporting";
import { planSchedule } from "../lib/plans";
import { sumMinor } from "../lib/statements";
import type { Card, Statement, Workspace } from "../lib/models";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Four recent calendar months (including this month), followed by two ahead. */
export function timelineMonths(today: string) {
  return Array.from({ length: 6 }, (_, index) => addMonths(`${today.slice(0, 7)}-01`, index - 3, 1));
}

type Cycle = { periodStart: string; closingDate: string; dueDate: string; statement?: Statement; estimated: boolean };
const money = (minor: number | null | undefined) => minor == null ? "-" : formatAmount(minor, 2);

/** Bar length means time to the deadline; payment status never changes its date position. */
export function StatementTimeline({ card, statements, snapshot, workspace, today, available, statuses = [], onStatement, onPayment }: {
  card: Card; statements: Statement[]; snapshot?: ActivitySnapshot; workspace: Workspace; today: string; available: boolean; statuses?: Settlement[];
  onStatement: (statement: Statement) => void; onPayment?: (id: string) => void;
}) {
  const months = timelineMonths(today), from = months[0], until = addMonths(months[5], 1, 1);
  const saved = statements.filter((entry) => entry.cardId === card.id);
  const cycles: Cycle[] = Array.from({ length: 7 }, (_, index) => {
    const close = addMonths(from, index - 1, card.closingDay ?? 1);
    const actual = saved.filter((entry) => entry.closingDate.slice(0, 7) === close.slice(0, 7));
    if (actual.length) return actual.map((statement) => ({ ...statement, statement, estimated: !statement.bankConfirmed }));
    if (card.closingDay === null || close <= today || card.firstTrackedStatementDate && close < card.firstTrackedStatementDate) return [];
    return [{ ...cycleDates(card, close), estimated: true }];
  }).flat();
  const span = daysBetween(from, until);
  const x = (date: string) => 9 + Math.max(0, Math.min(1, daysBetween(from, date) / span)) * 89;
  const payments = available && snapshot ? snapshot.rows.filter((row) => row.date >= from && row.date < until && row.date <= today && row.amountMinor > 0 && activityKind(row, card, workspace, snapshot) === "payment") : [];
  const groups = new Map<string, ActivityRow[]>();
  for (const row of payments) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
  const schedules = (workspace.plans ?? []).filter((plan) => plan.cardId === card.id && plan.status === "active").flatMap((plan) => planSchedule(plan, card, workspace.planLinks?.filter((link) => link.planId === plan.id) ?? []));
  const markers: { date: string; entries: ActivityRow[]; lane: number }[] = [];
  for (const [date, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const previous = markers.at(-1);
    markers.push({ date, entries, lane: previous && x(date) - x(previous.date) < 2.4 ? (previous.lane + 1) % 3 : 0 });
  }
  const cycleDetail = (cycle: Cycle) => {
    const statement = cycle.statement, status = statuses.find((entry) => entry.statementId === statement?.id);
    const known = available && status?.recordedDebtRemainingMinor != null;
    const credits = status?.confirmedCreditMinor ?? status?.confirmedCashbackMinor ?? 0;
    const remaining = known && statement ? paymentTargetRemaining(statement, status.confirmedPaidMinor) : null;
    const outcome = statement ? statementOutcome(statement, status, today, available) : null;
    const charges = available && snapshot && statement ? statementChargeBreakdown(card, statement, workspace, snapshot) : null;
    return <><p className="font-semibold">Statement {formatCardDate(cycle.closingDate)}</p><p className="mt-1 text-muted-foreground">Due {formatCardDate(cycle.dueDate)}{cycle.estimated ? " · Estimated from billing settings" : ""}</p>{statement ? <><dl className="mt-3 space-y-1.5">{[["Statement balance", statement.officialBalanceMinor], ["Monthly target", paymentTarget(statement)], ["Repaid", known ? status.confirmedPaidMinor : null], ["Credits", known ? credits : null], ["To pay", remaining], ["Minimum to pay", known && statement ? Math.max(0, statement.minimumDueMinor - status.confirmedPaidMinor) : null]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{money(value as number | null)}</dd></div>)}</dl><p className="mt-3 font-medium">{outcome?.label}</p>{outcome?.date && <p className="text-muted-foreground">{outcome.timing}</p>}{charges && <details className="mt-3 border-t pt-2"><summary className="cursor-pointer text-muted-foreground">Charges in this cycle</summary><dl className="mt-2 space-y-1">{[["New charges", charges.newChargesMinor], ["Plan charges", charges.planChargesMinor], ["Interest and fees", charges.otherCostsMinor], ["Credits", charges.creditsMinor]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="tabular-nums">{money(Number(value))}</dd></div>)}</dl></details>}<Button className="mt-3" size="xs" variant="outline" onClick={() => onStatement(statement)}>Open statement</Button></> : <p className="mt-3 text-muted-foreground">Future amounts show known plan expectations only. Other spending and the next bank statement are not predicted.</p>}</>;
  };
  return <div className="shrink-0 overflow-x-auto border-b bg-background px-4 py-2"><figure aria-label="Statement and payment timeline" className="min-w-[760px]">
    <div className="relative h-[132px]" data-testid="timeline-axis">
      <svg aria-hidden="true" viewBox="0 0 1000 132" preserveAspectRatio="none" className="absolute inset-0 size-full"><rect x={x(today) * 10} y="20" width={980 - x(today) * 10} height="85" fill="var(--muted)" opacity="0.25" />{months.map((month) => <line key={month} x1={x(month) * 10} x2={x(month) * 10} y1="20" y2="106" stroke="var(--border)" opacity="0.6" />)}<line x1="90" x2="980" y1="90" y2="90" stroke="var(--border)" opacity="0.6" /></svg>
      <span className="absolute left-0 top-[37px] text-[11px] text-muted-foreground">Statements</span><span className="absolute left-0 top-[83px] text-[11px] text-muted-foreground">Payments</span>
      {cycles.filter((cycle) => cycle.dueDate >= from && cycle.closingDate < until).map((cycle) => {
        const statement = cycle.statement, status = statuses.find((entry) => entry.statementId === statement?.id);
        const outcome = statement ? statementOutcome(statement, status, today, available) : null;
        const known = available && !cycle.estimated && status?.recordedDebtRemainingMinor != null;
        const target = statement ? paymentTarget(statement) : null;
        const remaining = known ? paymentTargetRemaining(statement!, status.confirmedPaidMinor) : null;
        const minimumRemaining = known && statement ? Math.max(0, statement.minimumDueMinor - status.confirmedPaidMinor) : null;
        const expected = sumMinor(schedules.filter((entry) => entry.date > cycle.closingDate && entry.date <= cycle.dueDate).map((entry) => entry.amountMinor));
        const label = `${cycle.estimated ? "Estimated" : "Open"} closing ${formatCardDate(cycle.closingDate)}`;
        const color = cycle.estimated ? "border border-dashed text-muted-foreground" : outcome?.overdue ? "border border-destructive/40 bg-destructive/10 text-destructive" : outcome?.late || outcome?.carried ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : outcome?.paid ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" : !known || !target ? "bg-muted text-muted-foreground" : "bg-chart-1/10 text-foreground";
        const text = cycle.estimated ? `${expected ? `${money(expected)} ` : ""}expected` : target === 0 && !minimumRemaining ? "Nothing to pay" : !known ? `${money(target)} · check` : remaining === 0 && minimumRemaining! > 0 ? `${money(minimumRemaining)} · Minimum ${outcome?.overdue ? "overdue" : "due"}` : outcome?.paid ? `${money(target)} · ${outcome.late ? "paid late" : "paid"}` : `${money(remaining)} ${outcome?.overdue ? "overdue" : outcome?.carried ? "carried" : "to pay"}`;
        return <div key={cycle.closingDate}><Popover><PopoverTrigger aria-label={label} title={`${formatCardDate(cycle.closingDate)} → ${formatCardDate(cycle.dueDate)} · ${text}`} className={`absolute top-[30px] h-7 overflow-hidden rounded-md px-2 text-left text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring ${color}`} style={{ left: `${x(cycle.closingDate)}%`, width: `${Math.max(0.15, x(cycle.dueDate) - x(cycle.closingDate))}%` }}><span className="block truncate">{text}</span></PopoverTrigger><PopoverContent aria-label={label} className="max-h-80 w-80 overflow-auto p-3 text-xs">{cycleDetail(cycle)}</PopoverContent></Popover>{cycle.closingDate >= from && <span className="absolute top-[61px] truncate text-[10px] text-muted-foreground" style={{ left: `${x(cycle.closingDate)}%`, width: `${Math.max(0, x(cycle.dueDate) - x(cycle.closingDate))}%` }}>{formatCardDate(cycle.closingDate).slice(0, 6)} → {formatCardDate(cycle.dueDate).slice(0, 6)}</span>}{cycle.dueDate >= from && cycle.dueDate < until && <Popover><PopoverTrigger aria-label={`${cycle.estimated ? "Estimated" : "Open"} deadline ${formatCardDate(cycle.dueDate)}`} className="absolute top-[28px] z-10 flex h-8 w-3 -translate-x-1/2 justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ left: `${x(cycle.dueDate)}%` }}><span aria-hidden className={`h-full border-l-2 border-chart-1 ${cycle.estimated ? "border-dashed opacity-50" : ""}`} /></PopoverTrigger><PopoverContent aria-label={`Deadline ${formatCardDate(cycle.dueDate)}`} className="max-h-80 w-80 overflow-auto p-3 text-xs">{cycleDetail(cycle)}</PopoverContent></Popover>}</div>;
      })}
      {markers.map(({ date, entries, lane }) => {
        const pending = entries.some((row) => paymentEvidence(row, snapshot!, workspace) !== "confirmed");
        const late = entries.some((row) => { const statement = matchedPaymentStatement(row.date, saved, statuses); return statement && row.date > statement.dueDate; });
        const label = entries.length === 1 ? `Payment ${formatCardDate(date)} ${money(entries[0].amountMinor)}` : `${entries.length} payments on ${formatCardDate(date)}`;
        return <Popover key={date}><PopoverTrigger aria-label={label} title={`${label}${pending ? " · pending" : late ? " · late" : ""}`} className="absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ left: `${x(date)}%`, top: 90 + [0, -6, 6][lane] }}><span aria-hidden className={`size-3 rounded-full border-2 border-background ring-1 ${pending ? "bg-background ring-amber-600" : late ? "bg-amber-600 ring-amber-700" : "bg-green-600 ring-green-700"}`} />{entries.length > 1 && <span className="absolute -right-1 -top-1 rounded bg-muted px-0.5 text-[9px]">{entries.length}</span>}</PopoverTrigger><PopoverContent aria-label={label} className="max-h-72 w-80 overflow-auto p-3 text-xs"><p className="mb-2 font-semibold">Payments · {formatCardDate(date)}</p>{entries.map((row) => { const statement = matchedPaymentStatement(row.date, saved, statuses); return <div key={row.id} className="space-y-2 border-t py-2 first:border-0"><p className="flex justify-between gap-3"><span>{row.label}</span><strong>{money(row.amountMinor)}</strong></p><p className="text-muted-foreground">{paymentEvidence(row, snapshot!, workspace) === "confirmed" ? "Confirmed payment" : "Pending clearance"}{statement && row.date > statement.dueDate ? ` · ${daysBetween(statement.dueDate, row.date)} days late` : ""}</p>{onPayment && <Button size="xs" variant="outline" onClick={() => onPayment(row.id)}>Open payment details</Button>}</div>; })}</PopoverContent></Popover>;
      })}
      <span aria-hidden className="pointer-events-none absolute top-4 bottom-6 z-20 w-px bg-foreground" style={{ left: `${x(today)}%` }} /><span className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded bg-foreground px-1 text-[10px] text-background" style={{ left: `${x(today)}%` }}>Today {formatCardDate(today).slice(0, 6)}</span>
      {months.map((month) => <span key={month} className="absolute top-[114px] -translate-x-1/2 text-[10px] text-muted-foreground" style={{ left: `${x(month)}%` }}>{formatCardDate(month).slice(3)}</span>)}
    </div>
    <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[10px] text-muted-foreground"><span>Bar = closing date → due date</span><span className="inline-flex items-center gap-1"><i aria-hidden className="size-2 rounded-sm bg-green-500/40" />Paid / covered</span><span className="inline-flex items-center gap-1"><i aria-hidden className="size-2 rounded-sm bg-chart-1/20" />To pay</span><span className="inline-flex items-center gap-1"><i aria-hidden className="size-2 rounded-sm bg-amber-500/40" />Late / carried</span><span className="inline-flex items-center gap-1"><i aria-hidden className="size-2 rounded-sm bg-destructive/30" />Overdue</span><span>● Payment · ○ Pending</span><span className="inline-flex items-center gap-1"><i aria-hidden className="h-3 border-l-2 border-chart-1" />Due date</span><span className="inline-flex items-center gap-1"><i aria-hidden className="h-2 w-3 rounded-sm border border-dashed" />Expected</span>{!available && <span>Payment history unavailable</span>}</figcaption>
  </figure></div>;
}
