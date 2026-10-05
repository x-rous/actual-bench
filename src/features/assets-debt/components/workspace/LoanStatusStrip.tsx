"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import { DUE_LABEL, type DueCell, type DueState, type MatchingFacts } from "./matchingStrip";
import type { LoanStatus, RefreshState } from "./useBackgroundRefresh";

/**
 * The status strip (RD-084 P1.6b T289; `ux-loan-workspace.md` §3.2). The only
 * place drift is shown: three figures and one state, worst first, with the
 * refresh state and the age of what is shown. Statement entry and history
 * open in the drawer from here.
 */

export type StripState = { tone: "ok" | "attention" | "problem"; text: string; hint?: string };

/** One state, worst first: lender drift, then Actual vs calculation, then changes to review, then in sync. */
export function stripState(status: LoanStatus | null, counts: { review: number; notApplied: number }, digits: number, driftExplained = false): StripState {
  const fmt = (minor: number) => formatAmount(Math.abs(minor), digits);
  if (status && status.drift === "material" && status.actualVsLenderMinor !== null && status.actualVsLenderMinor !== 0) {
    return { tone: "problem", text: `Differs from the lender by ${fmt(status.actualVsLenderMinor)}`, hint: "Record the latest statement, or accept the difference in the statement panel." };
  }
  if (status && status.drift === "material" && status.modelVsActualMinor !== null) {
    return {
      tone: "attention",
      text: `Actual differs from the calculation by ${fmt(status.modelVsActualMinor)}`,
      hint: counts.notApplied
        ? driftExplained
          ? `Applying the ${counts.notApplied} pending change${counts.notApplied === 1 ? "" : "s"} closes this gap.`
          : `${counts.notApplied} change${counts.notApplied === 1 ? " is" : "s are"} not applied yet; they do not close the whole gap. Check against a lender statement to see which side is right.`
        : "Check against a lender statement to see which side is right.",
    };
  }
  if (counts.review) return { tone: "attention", text: `${counts.review} change${counts.review === 1 ? "" : "s"} to review` };
  if (status) return { tone: "ok", text: "In sync" };
  return { tone: "attention", text: "Reading Actual" };
}

/** "Calculated" follows the repayments as paid; say how that compares with paying on schedule (T309). */
export function asPaidNote(status: LoanStatus | null, digits: number): string | null {
  if (!status?.asPaidFrom || status.scheduledMinor === null || status.scheduledMinor === undefined || status.modelMinor === null) return null;
  const difference = status.scheduledMinor - status.modelMinor;
  const onSchedule = `On schedule: ${formatAmount(status.scheduledMinor, digits)}`;
  if (difference === 0) return `Calculated as paid. ${onSchedule}.`;
  return `Calculated as paid. ${onSchedule} (${formatAmount(Math.abs(difference), digits)} ${difference > 0 ? "more" : "less"}; the difference comes from when repayments were actually paid).`;
}

function age(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export type StripMatching = {
  cells: DueCell[];
  facts: MatchingFacts;
  /** The account the repayment comes from, and the rule's window around each due date. */
  accountName: string | null;
  window: { before: number; after: number } | null;
  ruleOn: boolean | null;
  lastCheck: string | null;
  /** Payments into the loan account not yet recorded as extra payments. */
  unrecordedExtra: number;
  /** Recorded extra payments whose date or amount was changed in Actual afterwards. */
  changedExtra?: number;
};

const CELL: Record<DueState, string> = {
  applied: "bg-emerald-500",
  edited: "bg-emerald-200 dark:bg-emerald-800",
  found: "bg-blue-400",
  blocked: "bg-red-400",
  missing: "bg-amber-500",
  "not-checked": "bg-muted bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.08)_3px,rgba(0,0,0,0.08)_5px)]",
  next: "bg-muted ring-2 ring-blue-600 ring-inset",
  upcoming: "bg-muted ring-1 ring-border ring-inset",
};
const LEGEND: DueState[] = ["applied", "edited", "found", "missing", "upcoming"];

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

function Fact({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-t border-border/60 pt-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs">{children}</span>
      {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function gapCause(facts: MatchingFacts, drift: string | undefined, unrecordedExtra = 0, changedExtra = 0): { text: string; sub: string } {
  if (changedExtra) return { text: `${changedExtra} extra payment${changedExtra === 1 ? " was" : "s were"} changed in Actual`, sub: "Update Terms & Schedule below, so the calculation uses the new date and amount." };
  if (drift !== "material") return { text: "Nothing to explain", sub: "Actual and the calculation agree within your allowed difference." };
  if (unrecordedExtra) return { text: `${unrecordedExtra} payment${unrecordedExtra === 1 ? "" : "s"} into the loan ${unrecordedExtra === 1 ? "is" : "are"} not in the schedule`, sub: "Record it as an extra payment below, so the calculation includes it." };
  if (facts.notApplied) return { text: `${facts.notApplied} found repayment${facts.notApplied === 1 ? " is" : "s are"} not applied yet`, sub: "Applying them usually closes the gap." };
  if (facts.missing) return { text: `${facts.missing} repayment${facts.missing === 1 ? " was" : "s were"} not found in Actual`, sub: "Check those months in Actual, or the matching rule." };
  if (facts.edited) return { text: `${facts.edited} split${facts.edited === 1 ? "" : "s"} applied with your edit`, sub: "Check against a lender statement to confirm which side is right." };
  return { text: "Not from repayment matching", sub: "Check against a lender statement to see which side is right." };
}

/** The repayments of the whole loan as one row of cells, oldest first, with today's next one outlined. */
function Timeline({ cells }: { cells: DueCell[] }) {
  const counts = LEGEND.map((state) => [state, cells.filter((c) => c.state === state || (state === "upcoming" && c.state === "next")).length] as const);
  const summary = counts.filter(([, n]) => n > 0).map(([state, n]) => `${n} ${DUE_LABEL[state].toLowerCase()}`).join(", ");
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={`${cells.length} repayments: ${summary}`} className="flex items-center gap-[3px]">
        {cells.map((c) => <span key={c.date} title={`${shortDay(c.date)}: ${DUE_LABEL[c.state]}`} className={cn("h-4 min-w-[3px] flex-1 rounded-[3px]", CELL[c.state])} />)}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {LEGEND.filter((state) => cells.some((c) => c.state === state || (state === "upcoming" && c.state === "next"))).map((state) => (
          <span key={state} className="flex items-center gap-1"><span aria-hidden="true" className={cn("inline-block size-2.5 rounded-[2px]", CELL[state])} />{DUE_LABEL[state]}</span>
        ))}
        {cells.some((c) => c.state === "not-checked") ? <span className="flex items-center gap-1"><span aria-hidden="true" className={cn("inline-block size-2.5 rounded-[2px]", CELL["not-checked"])} />{DUE_LABEL["not-checked"]}</span> : null}
        {cells.length ? <span className="ml-auto">{monthYear(cells[0].date)} to {monthYear(cells[cells.length - 1].date)}</span> : null}
      </div>
    </div>
  );
}

export function LoanStatusStrip({ refresh, counts, digits, onRefresh, onStatements, matching }: { refresh: RefreshState; counts: { review: number; notApplied: number }; digits: number; onRefresh: () => void; onStatements: () => void; /** Repayment matching at a glance (rev 4); absent until the schedule is known. */ matching?: StripMatching | null }) {
  const { status } = refresh;
  const state = stripState(status, counts, digits, refresh.driftExplained);
  const Icon = state.tone === "ok" ? CheckCircle2 : AlertTriangle;
  const show = (minor: number | null) => (minor === null ? "Not available" : formatAmount(minor, digits));
  return (
    <section aria-label="Loan status" className={cn("flex flex-col gap-2 rounded-lg border p-3 text-sm", state.tone === "problem" ? "border-destructive/50" : state.tone === "attention" ? "border-amber-500/50" : "border-border")}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div className="flex gap-1.5"><dt className="text-muted-foreground">Actual</dt><dd className="font-semibold tabular-nums">{show(status?.actualMinor ?? null)}</dd></div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Calculated</dt>
            <dd className="font-semibold tabular-nums" title={status?.asPaidFrom ? `As paid: from the repayment applied on ${status.asPaidFrom}, then on schedule` : "On schedule: repayments on their due dates"}>{show(status?.modelMinor ?? null)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Lender</dt>
            <dd className="font-semibold tabular-nums">{status?.lenderMinor !== null && status?.lenderMinor !== undefined ? `${show(status.lenderMinor)}${status.lenderDate ? ` (${status.lenderDate})` : ""}` : "No statement yet"}</dd>
          </div>
        </dl>
        <p role="status" className={cn("flex items-center gap-1.5 font-medium", state.tone === "problem" ? "text-destructive" : state.tone === "attention" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}>
          <Icon aria-hidden="true" className="size-4" />
          {state.text}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" disabled={refresh.phase === "refreshing"} onClick={onRefresh}>
            {refresh.phase === "refreshing" ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
            {refresh.phase === "refreshing" ? "Refreshing…" : refresh.phase === "failed" ? "Try again" : "Refresh from Actual"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={onStatements}>Check against lender statement</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {asPaidNote(status, digits) ? <span>{asPaidNote(status, digits)}</span> : null}
        {state.hint ? <span>{state.hint}</span> : null}
        {status && refresh.phase !== "refreshing" ? <span className="ml-auto">Updated {age(status.at)}{refresh.statusFromCache ? " (saved in this browser)" : ""}</span> : null}
      </div>
      {refresh.phase === "failed" ? (
        <p role="alert" className="text-xs text-destructive">Could not refresh: {refresh.error}. {status ? `Showing data from ${age(status.at)}.` : ""} Rows may be out of date; Apply still re-checks Actual.</p>
      ) : null}
      {matching && matching.cells.length ? (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold">Repayments in Actual</span>
            <span className="text-muted-foreground">
              {matching.facts.done} of {matching.facts.due} due so far applied{matching.facts.notApplied ? ` · ${matching.facts.notApplied} found, not applied` : ""}{matching.facts.missing ? ` · ${matching.facts.missing} not found` : ""} · {matching.facts.upcoming} upcoming
            </span>
          </div>
          <Timeline cells={matching.cells} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="Next expected" sub={matching.accountName ? `from ${matching.accountName}${matching.window ? `, ${matching.window.before} days early to ${matching.window.after} late` : ""}` : undefined}>
              {matching.facts.next ? <><span className="font-semibold tabular-nums">{formatAmount(matching.facts.next.amountMinor, digits)}</span> on {shortDay(matching.facts.next.date)}</> : "No more repayments"}
            </Fact>
            <Fact label="Last matched" sub={matching.facts.averageEarlyDays !== null ? (matching.facts.averageEarlyDays >= 0 ? `paid ${matching.facts.averageEarlyDays} day${matching.facts.averageEarlyDays === 1 ? "" : "s"} early on average` : `paid ${-matching.facts.averageEarlyDays} days late on average`) : undefined}>
              {matching.facts.lastMatched ? <>{shortDay(matching.facts.lastMatched.paidDate)} <span className="text-muted-foreground">for {shortDay(matching.facts.lastMatched.dueDate)}</span></> : "Nothing matched yet"}
            </Fact>
            <Fact label="Where the gap comes from" sub={gapCause(matching.facts, status?.drift, matching.unrecordedExtra, matching.changedExtra).sub}>{gapCause(matching.facts, status?.drift, matching.unrecordedExtra, matching.changedExtra).text}</Fact>
            <Fact label="Matching" sub={matching.lastCheck ?? undefined}>{matching.ruleOn === null ? "Loading…" : matching.ruleOn ? "Repayment rule on" : <span className="text-amber-700 dark:text-amber-300">No repayment rule on: set it up in Link to Actual</span>}</Fact>
          </div>
        </div>
      ) : null}
    </section>
  );
}
