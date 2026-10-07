"use client";

import { useMemo, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Ban, CircleCheck, CircleDashed, Archive } from "lucide-react";
import { getTransport } from "@/lib/actual";
import { readDatedBalance, toDebtMagnitude } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { cn } from "@/lib/utils";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { getSchedule } from "../lib/debtsApi";
import { loanProgress, percentPaid } from "../lib/loanProgress";
import { formatAmount } from "../lib/money";
import { loanPath } from "../lib/routes";
import { useAccountDirectory } from "../lib/useAccountDirectory";
import { DEBT_TYPE_OPTIONS, labelOf } from "../lib/vocabulary";

/**
 * The Loans & Debt list (RD-084 P1.3; FR-197, FR-204, FR-206; rev 4 loan cards).
 *
 * One card per loan: what is left (Actual's balance when the loan is connected, otherwise the
 * calculation), how much is paid, payments made of the total, the next payment, interest so far
 * and the payoff date. Virtualized, so a long list keeps a bounded DOM. Every status is spelled out
 * in text next to its icon, never colour alone. A debt Blocked because it was
 * configured by a newer Actual Bench says so on its own row; the rest of the
 * list stays usable.
 */

/** A loan card plus the gap below it. Every card has the same height, so the list stays virtualized. */
const ROW_HEIGHT = 212;

export type DebtStatusView = { label: string; icon: typeof Ban; tone: string };

export function statusOf(debt: DebtSummary): DebtStatusView {
  if (debt.blocked) {
    const label = debt.blocked.code === "invalid-config" ? "Blocked: the saved configuration cannot be used" : "Blocked: configured by a newer version of Actual Bench";
    return { label, icon: Ban, tone: "text-destructive" };
  }
  if (debt.status === "active" && debt.paidOffOn) return { label: "Paid off", icon: CircleCheck, tone: "text-emerald-700 dark:text-emerald-300" };
  if (debt.status === "active") return { label: "Active", icon: CircleCheck, tone: "text-foreground" };
  if (debt.status === "archived") return { label: "Archived", icon: Archive, tone: "text-muted-foreground" };
  if (debt.status === "draft") return { label: "Draft", icon: CircleDashed, tone: "text-muted-foreground" };
  return { label: "Blocked: unknown status", icon: Ban, tone: "text-destructive" };
}

const WIDE = "(min-width: 1024px)";
/** Two cards per row on wide screens, one on narrow ones; read without an effect. */
function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => (typeof window !== "undefined" && !!window.matchMedia ? window.matchMedia(WIDE).matches : false),
    () => false,
  );
}

export function DebtList({ debts, attention = {}, hrefs = {} }: { debts: DebtSummary[]; /** Debt id → what needs the user, in words (from the needs-attention summary). */ attention?: Record<string, string>; /** Debt id → where it opens when it needs attention. */ hrefs?: Record<string, string> }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useWide() ? 2 : 1;
  const rows = Math.ceil(debts.length / columns);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual; the compiler skips this component, which is what it needs.
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // Lets the first render (and a test DOM without layout) size the window.
    initialRect: { width: 800, height: 600 },
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" role="region" aria-label="Debts">
      <ul role="list" aria-label={`${debts.length} debt${debts.length === 1 ? "" : "s"}`} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().flatMap((item) => debts.slice(item.index * columns, item.index * columns + columns).map((debt, column) => {
          const index = item.index * columns + column;
          const status = statusOf(debt);
          const type = typeof debt.debtType === "string" ? labelOf(DEBT_TYPE_OPTIONS, debt.debtType) : "Unknown type";
          return (
            <li
              key={debt.id}
              aria-setsize={debts.length}
              aria-posinset={index + 1}
              style={{ position: "absolute", top: 0, left: columns === 2 && column === 1 ? "50%" : 0, width: columns === 2 ? "50%" : "100%", height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              className={cn("pb-3", columns === 2 ? (column === 0 ? "pl-4 pr-1.5" : "pl-1.5 pr-4") : "px-4")}
            >
              <DebtCard debt={debt} status={status} type={type} attention={attention[debt.id]} href={hrefs[debt.id]} />
            </li>
          );
        }))}
      </ul>
    </div>
  );
}

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
const isoToday = () => new Date().toISOString().slice(0, 10);

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate text-[13px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}

type Connection = ReturnType<typeof selectActiveInstance>;

/** The stored schedule a card (and the summary) reads; the same key, so it is fetched once. */
function scheduleQuery(debt: DebtSummary, today: string) {
  const usable = !debt.blocked && debt.openingPrincipalMinor !== null && !!debt.openingDate;
  return {
    queryKey: ["assets-debt", "card-schedule", debt.id, debt.currentRevision, today],
    queryFn: () => getSchedule(debt.id, { from: debt.openingDate!, to: `${Number(today.slice(0, 4)) + 60}-12-31`, resolution: "events" }),
    enabled: usable,
    staleTime: 5 * 60_000,
  };
}

/** The loan account's balance in Actual today, as a debt magnitude. */
function balanceQuery(debt: DebtSummary, connection: Connection, today: string) {
  const usable = !debt.blocked && debt.openingPrincipalMinor !== null && !!debt.openingDate;
  return {
    queryKey: ["assets-debt", "card-balance", connection?.id, debt.liabilityAccountId, today],
    queryFn: async () => {
      const read = await readDatedBalance(getTransport(connection!), { accountId: debt.liabilityAccountId!, date: today });
      return read.ok ? toDebtMagnitude(read.balanceMinor, debt.signConvention === "positive-is-debt" ? "positive-is-debt" : "negative-is-debt") : null;
    },
    enabled: usable && !!connection && !!debt.liabilityAccountId && debt.status !== "archived",
    staleTime: 60_000,
  };
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A short line of totals above the cards (owner request 2026-10-07): what is owed across the active
 * loans and what falls due in the next 30 days, one figure per currency. Reads what the cards read.
 */
export function LoansSummary({ debts }: { debts: DebtSummary[] }) {
  const connection = useConnectionStore(selectActiveInstance);
  const today = useMemo(() => isoToday(), []);
  const active = debts.filter((d) => d.status === "active" && !d.paidOffOn && !d.blocked);
  const schedules = useQueries({ queries: active.map((d) => scheduleQuery(d, today)) });
  const balances = useQueries({ queries: active.map((d) => balanceQuery(d, connection, today)) });
  const soon = addDays(today, 30);
  const byCurrency = new Map<string, { digits: number; owed: number; due: number; dueCount: number }>();
  active.forEach((debt, i) => {
    const schedule = schedules[i]?.data;
    const balance = balances[i]?.data;
    const events = schedule?.ok ? schedule.events : [];
    const progress = schedule?.ok && debt.openingPrincipalMinor !== null ? loanProgress(events, today, debt.openingPrincipalMinor) : null;
    const owed = typeof balance === "number" ? balance : progress?.calculatedBalanceMinor ?? debt.openingPrincipalMinor ?? 0;
    const upcoming = events.filter((e) => (e.eventType === "repayment" || e.eventType === "final-payment") && e.date > today && e.date <= soon);
    const entry = byCurrency.get(debt.currency) ?? { digits: debt.currencyMinorDigits, owed: 0, due: 0, dueCount: 0 };
    entry.owed += owed;
    entry.due += upcoming.reduce((sum, e) => sum - e.cashMovementMinor, 0);
    entry.dueCount += upcoming.length;
    byCurrency.set(debt.currency, entry);
  });
  if (!active.length) return null;
  const several = byCurrency.size > 1;
  return (
    <dl aria-label="All loans" className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
      <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Active loans</dt><dd className="font-semibold tabular-nums">{active.length}</dd></div>
      {[...byCurrency].map(([currency, t]) => (
        <div key={currency} className="contents">
          <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Owed{several ? ` (${currency})` : ""}</dt><dd className="font-semibold tabular-nums">{formatAmount(t.owed, t.digits)}</dd></div>
          <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Due in the next 30 days{several ? ` (${currency})` : ""}</dt><dd className="font-semibold tabular-nums">{formatAmount(t.due, t.digits)}{t.dueCount ? <span className="ml-1 font-normal text-muted-foreground">({t.dueCount} repayment{t.dueCount === 1 ? "" : "s"})</span> : null}</dd></div>
        </div>
      ))}
    </dl>
  );
}

/** One loan as a card (rev 4). Reads only: the stored schedule, and the loan account's balance in Actual. */
function DebtCard({ debt, status, type, attention, href }: { debt: DebtSummary; status: DebtStatusView; type: string; attention?: string; href?: string }) {
  const connection = useConnectionStore(selectActiveInstance);
  const directory = useAccountDirectory();
  const today = useMemo(() => isoToday(), []);
  const Icon = status.icon;
  const digits = debt.currencyMinorDigits;
  const money = (minor: number) => formatAmount(minor, digits);
  const opening = debt.openingPrincipalMinor;
  const usable = !debt.blocked && opening !== null && !!debt.openingDate;
  const schedule = useQuery(scheduleQuery(debt, today));
  const balance = useQuery(balanceQuery(debt, connection, today));
  const progress = schedule.data?.ok && opening !== null ? loanProgress(schedule.data.events, today, opening) : null;
  const inActual = typeof balance.data === "number";
  const remaining = inActual ? (balance.data as number) : progress?.calculatedBalanceMinor ?? opening;
  const paid = opening !== null && remaining !== null && remaining !== undefined ? percentPaid(opening, remaining) : 0;
  const accountName = directory.data?.accounts.find((a) => a.id === debt.liabilityAccountId)?.name ?? (debt.liabilityAccountId ? null : "account not chosen yet");
  const rate = debt.annualRateDecimal !== null ? `${(Number(debt.annualRateDecimal) * 100).toFixed(2)}%` : null;
  return (
    <Link href={href ?? loanPath(debt.id)} className="flex h-full flex-col gap-2.5 rounded-xl border border-border px-4 py-3 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{debt.name}</span>
          <span className="mt-1 flex min-w-0 flex-wrap gap-1 overflow-hidden" style={{ maxHeight: "1.25rem" }}>
            {[type, rate, accountName].filter((t): t is string => !!t).map((t) => <span key={t} className="truncate rounded bg-muted px-1.5 text-[11px] leading-5 text-foreground/80">{t}</span>)}
          </span>
        </span>
        {/* One chip: what needs you first, else the status (plain "Active" needs no chip). */}
        {attention ? (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{attention}</span>
        ) : status.label !== "Active" ? (
          <span className={cn("flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium", status.tone)}><Icon className="size-3" aria-hidden />{status.label}</span>
        ) : null}
      </span>
      {usable && remaining !== null && remaining !== undefined ? (
        <>
          {/* Owed on the left, the four facts in a 2 x 2 grid on the right, progress along the bottom. */}
          <span className="grid flex-1 grid-cols-1 items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <span className="flex min-w-0 flex-col">
              <span className={cn("truncate text-2xl font-semibold tabular-nums", !inActual && "text-muted-foreground")}>{money(remaining)}</span>
              <span className="truncate text-xs text-muted-foreground">owed of {money(opening!)}{inActual ? "" : " (calculated)"}</span>
            </span>
            {progress ? (
              <span className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Fact label="Next" value={debt.paidOffOn ? "None" : progress.next ? `${money(progress.next.amountMinor)} · ${shortDay(progress.next.date)}` : "None"} />
                <Fact label="Left" value={debt.paidOffOn ? "0" : `${progress.totalPayments - progress.paymentsMade} payment${progress.totalPayments - progress.paymentsMade === 1 ? "" : "s"}`} />
                <Fact label="Interest paid" value={money(progress.interestToDateMinor)} />
                <Fact label={debt.paidOffOn ? "Paid off" : "Ends"} value={debt.paidOffOn ? shortDay(debt.paidOffOn) : progress.payoffDate ? monthYear(progress.payoffDate) : "Beyond the projection"} />
              </span>
            ) : schedule.isError || (schedule.data && !schedule.data.ok) ? <span className="text-xs text-muted-foreground">The schedule could not be calculated for this card. Open the loan for details.</span> : <span />}
          </span>
          <span className="flex flex-col gap-1">
            <span role="img" aria-label={`${Math.round(paid)}% of the principal paid`} className="block h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-blue-600" style={{ width: `${paid}%` }} />
            </span>
            <span className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
              <span><span className="font-semibold text-foreground">{Math.round(paid)}% paid</span> · {money(Math.max(0, opening! - remaining))}</span>
              {progress ? <span>{progress.paymentsMade} of {progress.totalPayments} payments</span> : null}
            </span>
          </span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">{debt.blocked ? "This loan's settings cannot be used by this version." : "Finish the loan's Terms & Schedule and Link to Actual to see its progress."}</span>
      )}
    </Link>
  );
}
