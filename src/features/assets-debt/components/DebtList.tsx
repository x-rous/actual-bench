"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Ban, CircleCheck, CircleDashed, Archive, House, CarFront, GraduationCap, Landmark, CreditCard, ArrowUpRight, CircleAlert } from "lucide-react";
import { getTransport } from "@/lib/actual";
import { readDatedBalance, toDebtMagnitude } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { cn } from "@/lib/utils";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { readOffsetHistories } from "@/lib/assets-debt/services/offsetHistoryService";
import { useLocalToday } from "../lib/useLocalToday";
import { withLoanOverviewRead } from "../lib/overviewReads";
import { getLoanSummary } from "../lib/debtsApi";
import { percentPaid } from "../lib/loanProgress";
import { formatAmount } from "../lib/money";
import { loanPath } from "../lib/routes";
import { useAccountDirectory } from "../lib/useAccountDirectory";
import { DEBT_TYPE_OPTIONS, REPAYMENT_FREQUENCY_OPTIONS, labelOf } from "../lib/vocabulary";

/** One compact visual table row per loan, with a bounded DOM and at most three lines per cell. */
// The previous Loan track used 60% of the space after 936px of fixed columns.
// Keep 75% of that width; share the remainder between progress, interest and accounts.
const COLUMNS = "grid-cols-[max(172.5px,calc(45%_-_421.2px))_125px_125px_140px_minmax(160px,1fr)_minmax(165px,.7fr)_115px_minmax(227.5px,1fr)_96px]";
const HEADERS = ["Loan", "Terms", "Outstanding", "Next payment", "Principal paid", "Interest", "Ends / Paid off", "Accounts", "Status"];
const ROW_HEIGHT = 96;

export type DebtStatusView = { label: string; icon: typeof Ban; tone: string };

export function statusOf(debt: DebtSummary): DebtStatusView {
  if (debt.blocked) {
    const label = debt.blocked.code === "invalid-config" ? "Blocked: the saved configuration cannot be used" : "Blocked: configured by a newer version of Actual Bench";
    return { label, icon: Ban, tone: "text-destructive" };
  }
  if (debt.status === "active" && debt.paidOffOn) return { label: "Paid off", icon: CircleCheck, tone: "text-emerald-700 dark:text-emerald-300" };
  if (debt.status === "active") return { label: "Active", icon: CircleCheck, tone: "text-emerald-700 dark:text-emerald-300" };
  if (debt.status === "archived") return { label: "Archived", icon: Archive, tone: "text-muted-foreground" };
  if (debt.status === "draft") return { label: "Draft", icon: CircleDashed, tone: "text-sky-700 dark:text-sky-300" };
  return { label: "Blocked: unknown status", icon: Ban, tone: "text-destructive" };
}

export function DebtList({ debts, attention = {}, hrefs = {} }: { debts: DebtSummary[]; /** Debt id → what needs the user, in words. */ attention?: Record<string, string>; /** Debt id → where it opens when it needs attention. */ hrefs?: Record<string, string> }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual; the compiler skips this component, which is what it needs.
  const virtualizer = useVirtualizer({
    count: debts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => debts[index].id,
    overscan: 8,
    initialRect: { width: 800, height: 600 },
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" role="region" aria-label="Debts">
      <div role="table" aria-label={`${debts.length} debt${debts.length === 1 ? "" : "s"}`} aria-rowcount={debts.length + 1} aria-colcount={HEADERS.length} className="min-w-[1326px] text-xs">
        <div role="rowgroup" className="sticky top-0 z-10 border-b border-border bg-background">
          <div role="row" aria-rowindex={1} className={cn("grid text-[11px] font-medium uppercase tracking-wide text-muted-foreground", COLUMNS)}>
            {HEADERS.map((label) => <div role="columnheader" key={label} className="whitespace-nowrap px-3 py-2">{label}</div>)}
          </div>
        </div>
        <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => (
            <DebtRow key={item.key} debt={debts[item.index]} attention={attention[debts[item.index].id]} href={hrefs[debts[item.index].id]} index={item.index} start={item.start} />
          ))}
        </div>
      </div>
    </div>
  );
}

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div role="cell" className={cn("min-w-0 space-y-1 px-3", className)}>{children}</div>;
}

function Line({ children, title, className }: { children: React.ReactNode; title?: string; className?: string }) {
  return <p title={title} className={cn("truncate leading-4", className)}>{children}</p>;
}

type Connection = ReturnType<typeof selectActiveInstance>;

/** The stored schedule a row (and the summary) reads; the same key, so it is fetched once. */
function scheduleQuery(debt: DebtSummary, today: string, connection: Connection) {
  const usable = !debt.blocked && debt.openingPrincipalMinor !== null && !!debt.openingDate;
  return {
    queryKey: ["assets-debt", "card-schedule", connection?.id, debt.id, debt.currentRevision, today],
    queryFn: async () => withLoanOverviewRead(connection?.id ?? debt.budgetSyncId ?? "stored-summary", async () => {
      const accounts = (debt.offsetAccountLinks ?? []).filter((offset) => offset.useActualBalance).map((offset) => offset.actualAccountId);
      if (accounts.length && (!connection || (debt.budgetSyncId && connection.budgetSyncId !== debt.budgetSyncId))) throw new Error("Connect to this loan’s budget to read offsets.");
      const offsets = accounts.length ? await readOffsetHistories(getTransport(connection!), { accountIds: accounts, asOfDate: today }) : null;
      if (offsets && !offsets.ok) throw new Error(offsets.failures.map((failure) => failure.message).join("; "));
      return getLoanSummary(debt.id, { today, offsetHistories: offsets?.ok ? offsets.snapshots : undefined });
    }),
    enabled: usable,
    staleTime: 5 * 60_000,
  };
}

/** The loan account's balance in Actual today, as a debt magnitude. */
function balanceQuery(debt: DebtSummary, connection: Connection, today: string) {
  const usable = !debt.blocked && debt.openingPrincipalMinor !== null && !!debt.openingDate;
  return {
    queryKey: ["assets-debt", "card-balance", connection?.id, debt.liabilityAccountId, today, debt.signConvention],
    queryFn: async () => withLoanOverviewRead(connection?.id ?? debt.budgetSyncId ?? "stored-summary", async () => {
      const read = await readDatedBalance(getTransport(connection!), { accountId: debt.liabilityAccountId!, date: today });
      if (!read.ok) throw new Error(read.message);
      return toDebtMagnitude(read.balanceMinor, debt.signConvention === "positive-is-debt" ? "positive-is-debt" : "negative-is-debt");
    }),
    enabled: usable && !!connection && (!debt.budgetSyncId || connection.budgetSyncId === debt.budgetSyncId) && !!debt.liabilityAccountId && debt.status !== "archived",
    staleTime: 60_000,
  };
}

/**
 * A short line of totals above the rows (owner request 2026-10-07): what is owed across the active
 * loans and what falls due in the next 30 days, one figure per currency. Reads what the rows read.
 */
export function LoansSummary({ debts }: { debts: DebtSummary[] }) {
  const connection = useConnectionStore(selectActiveInstance);
  const today = useLocalToday();
  const active = debts.filter((d) => d.status === "active" && !d.paidOffOn && !d.blocked);
  const schedules = useQueries({ queries: active.map((d) => scheduleQuery(d, today, connection)) });
  const balances = useQueries({ queries: active.map((d) => balanceQuery(d, connection, today)) });
  const byCurrency = new Map<string, { digits: number; owed: number; due: number; dueCount: number }>();
  active.forEach((debt, i) => {
    const schedule = schedules[i]?.data;
    const balance = balances[i]?.data;
    const progress = schedule?.ok ? schedule.summary : null;
    const owed = typeof balance === "number" ? balance : 0;
    const entry = byCurrency.get(debt.currency) ?? { digits: debt.currencyMinorDigits, owed: 0, due: 0, dueCount: 0 };
    entry.owed += owed;
    entry.due += progress?.dueSoonMinor ?? 0;
    entry.dueCount += progress?.dueSoonCount ?? 0;
    byCurrency.set(debt.currency, entry);
  });
  if (!active.length) return null;
  const incomplete = !connection || active.some((debt) => !debt.liabilityAccountId || !debt.openingDate || debt.openingPrincipalMinor === null || (debt.budgetSyncId && debt.budgetSyncId !== connection.budgetSyncId)) || balances.some((query) => query.isError);
  const loading = balances.some((query) => query.data === undefined && !query.isError);
  const unavailable = incomplete ? "Unavailable" : loading ? "Loading…" : null;
  const dueUnavailable = active.some((debt) => !debt.openingDate || debt.openingPrincipalMinor === null) || schedules.some((query) => query.isError) ? "Unavailable" : schedules.some((query) => query.data === undefined) ? "Loading…" : null;
  const several = byCurrency.size > 1;
  return (
    <dl aria-label="All loans" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
      <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Active loans</dt><dd className="font-semibold tabular-nums">{active.length}</dd></div>
      {[...byCurrency].map(([currency, t]) => (
        <div key={currency} className="contents">
          <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Owed{several ? ` (${currency})` : ""}</dt><dd className="font-semibold tabular-nums">{unavailable ?? formatAmount(t.owed, t.digits)}</dd></div>
          <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Due in the next 30 days{several ? ` (${currency})` : ""}</dt><dd className="font-semibold tabular-nums">{dueUnavailable ?? formatAmount(t.due, t.digits)}{!dueUnavailable && t.dueCount ? <span className="ml-1 font-normal text-muted-foreground">({t.dueCount} repayment{t.dueCount === 1 ? "" : "s"})</span> : null}</dd></div>
        </div>
      ))}
    </dl>
  );
}

/** The table row reads the same stored schedule and Actual balance as the totals. */
function DebtRow({ debt, attention, href, index, start }: { debt: DebtSummary; attention?: string; href?: string; index: number; start: number }) {
  const connection = useConnectionStore(selectActiveInstance);
  const directory = useAccountDirectory();
  const today = useLocalToday();
  const router = useRouter();
  const status = statusOf(debt);
  const StatusIcon = status.icon;
  const compactStatus = status.label.startsWith("Blocked:") ? "Blocked" : status.label;
  const LoanIcon = debt.debtType === "mortgage" ? House : debt.debtType === "car-loan" ? CarFront : debt.debtType === "student-loan" ? GraduationCap : debt.behaviorClass === "revolving-credit" ? CreditCard : Landmark;
  const type = typeof debt.debtType === "string" ? labelOf(DEBT_TYPE_OPTIONS, debt.debtType) : "Unknown type";
  const money = (minor: number) => formatAmount(minor, debt.currencyMinorDigits);
  const opening = debt.openingPrincipalMinor;
  const usable = !debt.blocked && opening !== null && !!debt.openingDate;
  const schedule = useQuery(scheduleQuery(debt, today, connection));
  const balance = useQuery(balanceQuery(debt, connection, today));
  const progress = schedule.data?.ok ? schedule.data.summary : null;
  const inActual = typeof balance.data === "number";
  const remaining = inActual ? (balance.data as number) : debt.liabilityAccountId && debt.status !== "archived" ? null : progress?.calculatedBalanceMinor ?? null;
  const hasBalance = usable && remaining !== null && remaining !== undefined;
  const paid = hasBalance ? percentPaid(opening!, remaining) : 0;
  const accountName = (id: string | null | undefined) => !id ? "Not configured" : directory.data?.accounts.find((a) => a.id === id)?.name ?? (directory.isLoading ? "Loading…" : "Account unavailable");
  const activeOffsets = [...new Set((debt.offsetAccountLinks ?? []).filter((o) => o.effectiveFrom <= today && (!o.effectiveTo || o.effectiveTo > today)).map((o) => o.actualAccountId))];
  const offsetNames = activeOffsets.map(accountName).join(", ");
  const rates = [...(debt.ratePeriods ?? [])].sort((a, b) => a.accrualEffectiveFrom.localeCompare(b.accrualEffectiveFrom));
  const currentRate = rates.filter((r) => r.accrualEffectiveFrom <= today).at(-1)?.annualRateDecimal ?? debt.annualRateDecimal;
  const nextRate = rates.find((r) => r.accrualEffectiveFrom > today);
  const rateLabel = (value: string) => `${(Number(value) * 100).toFixed(2)}%`;
  const months = debt.contractualTermMonths;
  const term = months ? `${Math.floor(months / 12) ? `${Math.floor(months / 12)}y ` : ""}${months % 12 ? `${months % 12}m` : ""}`.trim() : null;
  const frequency = debt.repaymentFrequency ? labelOf(REPAYMENT_FREQUENCY_OPTIONS, debt.repaymentFrequency).split(" (")[0] : "Frequency not set";
  const failed = schedule.isError || (schedule.data && !schedule.data.ok);
  const placeholder = !usable ? "-" : failed ? "Unavailable" : "Loading…";
  const issue = debt.blocked ? null : !usable ? "Complete loan setup" : failed ? "Schedule unavailable" : null;
  const notice = attention ?? issue;
  return (
    <div data-index={index} role="row" aria-rowindex={index + 2}
      onClick={(event) => { if (!(event.target as HTMLElement).closest("a")) router.push(href ?? loanPath(debt.id)); }}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
      className={cn("group grid cursor-pointer items-center border-b border-border/30 hover:bg-accent/40 focus-within:bg-accent/40 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring", COLUMNS)}>
      <Cell>
        <div className="flex min-w-0 items-center gap-2">
          <LoanIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Link href={href ?? loanPath(debt.id)} aria-describedby={`loan-status-${debt.id}${notice ? ` loan-notice-${debt.id}` : ""}`} title={debt.name} className="truncate font-medium focus-visible:outline-none">
            {debt.name}<ArrowUpRight className="ml-1 inline size-3 text-muted-foreground" aria-hidden />
          </Link>
        </div>
        <Line title={type} className="text-muted-foreground">{type}</Line>
        {notice ? <Line title={notice} className="text-amber-700 dark:text-amber-300"><span id={`loan-notice-${debt.id}`}><CircleAlert className="mr-1 inline size-3" aria-hidden />{notice}</span></Line> : debt.openingDate ? <Line className="text-muted-foreground">Opened {shortDay(debt.openingDate)}</Line> : null}
      </Cell>
      <Cell>
        <Line className="font-medium tabular-nums">{currentRate ? rateLabel(currentRate) : "-"}</Line>
        <Line title={`${frequency}${term ? ` · ${term} term` : ""}`} className="text-muted-foreground">{frequency}{term ? ` · ${term}` : ""}</Line>
        {nextRate ? <Line title={`Rate changes to ${rateLabel(nextRate.annualRateDecimal)} on ${shortDay(nextRate.accrualEffectiveFrom)}`} className="text-muted-foreground">{rateLabel(nextRate.annualRateDecimal)} · {shortDay(nextRate.accrualEffectiveFrom)}</Line> : null}
      </Cell>
      <Cell>
        <Line className="text-sm font-semibold tabular-nums">{hasBalance ? money(remaining) : balance.isError ? "Unavailable" : placeholder}</Line>
        {hasBalance ? <Line className="text-muted-foreground">of {money(opening!)}</Line> : null}
        {hasBalance && !inActual ? <Line className="text-muted-foreground">(calculated)</Line> : null}
      </Cell>
      <Cell>
        <Line className="font-medium tabular-nums">{debt.paidOffOn ? "None" : progress?.next ? money(progress.next.amountMinor) : progress ? "None" : placeholder}</Line>
        {!debt.paidOffOn && progress?.next ? <Line className="text-muted-foreground">{shortDay(progress.next.date)}</Line> : null}
      </Cell>
      <Cell>
        {hasBalance ? <>
          <Line className="tabular-nums"><span className="font-medium">{Math.round(paid)}% recorded</span><span className="text-muted-foreground"> · {money(Math.max(0, opening! - remaining))}</span></Line>
          <div role="progressbar" aria-label={`Principal paid for ${debt.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(paid)} className="my-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${paid}%` }} />
          </div>
        </> : <Line className="text-muted-foreground">-</Line>}
        {progress ? <Line className="tabular-nums text-muted-foreground">{progress.paymentsMade} recorded · {progress.totalPayments - progress.paymentsMade} scheduled left</Line> : null}
      </Cell>
      <Cell>
        <Line className="font-medium tabular-nums">{progress ? money(progress.interestToDateMinor) : placeholder}{progress ? <span className="font-normal text-muted-foreground"> recorded</span> : null}</Line>
        {progress ? <>
          <Line title="Projected interest remaining" className="tabular-nums text-muted-foreground">{money(Math.max(0, progress.totalInterestMinor - progress.interestToDateMinor))} left (projected)</Line>
          <Line title={`Forecast restarted from ${progress.forecastFrom}; recorded interest may cover only part of the loan history`} className="tabular-nums text-muted-foreground">Forecast from {shortDay(progress.forecastFrom)}</Line>
        </> : null}
      </Cell>
      <Cell>
        <Line title={!debt.paidOffOn && progress && !progress.payoffDate ? "Beyond the projection" : undefined} className="font-medium tabular-nums">{debt.paidOffOn ? shortDay(debt.paidOffOn) : progress ? progress.payoffDate ? monthYear(progress.payoffDate) : "Not reached" : placeholder}</Line>
        {debt.paidOffOn || progress ? <Line className="text-muted-foreground">{debt.paidOffOn ? "Paid off" : "Projected"}</Line> : null}
      </Cell>
      <Cell>
        {debt.liabilityAccountId ? <Line title={`Loan account: ${accountName(debt.liabilityAccountId)}`}><span className="text-muted-foreground">Loan · </span>{accountName(debt.liabilityAccountId)}</Line> : null}
        {debt.paymentAccountId ? <Line title={`Repayment account: ${accountName(debt.paymentAccountId)}`}><span className="text-muted-foreground">Repayments · </span>{accountName(debt.paymentAccountId)}</Line> : null}
        {activeOffsets.length ? <Line title={`Active offsets: ${offsetNames}`}><span className="text-muted-foreground">Offset · </span>{offsetNames}</Line> : null}
      </Cell>
      <Cell>
        <Line title={status.label}><span id={`loan-status-${debt.id}`} className={cn("inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5", status.tone, debt.blocked ? "border-destructive/30 bg-destructive/5" : status.label === "Active" || status.label === "Paid off" ? "border-emerald-500/30 bg-emerald-500/5" : debt.status === "draft" ? "border-sky-500/30 bg-sky-500/5" : "border-border bg-muted/40")}><StatusIcon className="size-3 shrink-0" aria-hidden /><span className="truncate" aria-label={status.label}>{compactStatus}</span></span></Line>
      </Cell>
    </div>
  );
}
