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
  /** Amounts taken out of the loan account that nothing explains (they add to what is owed). */
  takenOut?: number;
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
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-[13px]">{children}</span>
      {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function gapCause(facts: MatchingFacts, drift: string | undefined, unrecordedExtra = 0, changedExtra = 0, takenOut = 0): { text: string; sub: string } {
  if (takenOut) return { text: `${takenOut} amount${takenOut === 1 ? " was" : "s were"} taken out of the loan account`, sub: "They add to what you owe; check them below (often a transfer entered the wrong way round)." };
  if (changedExtra) return { text: `${changedExtra} extra payment${changedExtra === 1 ? " was" : "s were"} changed in Actual`, sub: "Terms & Schedule follows on the next refresh, or once you save your changes there." };
  if (drift !== "material") return { text: "Nothing to explain", sub: "Actual and the calculation agree within your allowed difference." };
  if (unrecordedExtra) return { text: `${unrecordedExtra} payment${unrecordedExtra === 1 ? "" : "s"} into the loan ${unrecordedExtra === 1 ? "is" : "are"} not in the schedule`, sub: "They count as extra payments on the next refresh, unless you mark them otherwise below." };
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

/** One of the three balances, in its own box with a short caption. */
function Balance({ label, value, caption, info, muted }: { label: string; value: string; caption?: string | null; info?: string | null; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border px-3 py-2">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {info ? <span title={info} aria-label={info} className="inline-grid size-3.5 cursor-help place-items-center rounded-full border border-border text-[9px] font-bold">i</span> : null}
      </dt>
      <dd className={cn("text-lg font-semibold tabular-nums", muted && "text-muted-foreground")}>{value}</dd>
      {caption ? <span className="truncate text-[11px] text-muted-foreground">{caption}</span> : null}
    </div>
  );
}

export function LoanStatusStrip({ refresh, counts, digits, onRefresh, onStatements, matching, paidOffOn }: { refresh: RefreshState; counts: { review: number; notApplied: number }; digits: number; onRefresh: () => void; onStatements: () => void; /** Repayment matching at a glance (rev 4); absent until the schedule is known. */ matching?: StripMatching | null; /** The day an applied payoff cleared the loan (owner decision 2026-10-07). */ paidOffOn?: string | null }) {
  const { status } = refresh;
  const state = stripState(status, counts, digits, refresh.driftExplained);
  const Icon = state.tone === "ok" ? CheckCircle2 : AlertTriangle;
  const show = (minor: number | null) => (minor === null ? "Not available" : formatAmount(minor, digits));
  const chip = state.tone === "problem" ? "bg-red-50 text-destructive dark:bg-red-950/40" : state.tone === "attention" ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  const lender = status?.lenderMinor !== null && status?.lenderMinor !== undefined;
  const gap = matching ? gapCause(matching.facts, status?.drift, matching.unrecordedExtra, matching.changedExtra, matching.takenOut) : null;
  const quiet = gap?.text === "Nothing to explain";
  return (
    <>
      <section aria-label="Loan status" className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-sm font-semibold">Balances</h2>
          <p role="status" className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", chip)}>
            <Icon aria-hidden="true" className="size-3.5" />
            {state.text}
          </p>
          {paidOffOn ? <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 aria-hidden="true" className="size-3.5" />Paid off on {shortDay(paidOffOn)}</span> : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {status && refresh.phase !== "refreshing" ? <span className="text-[11px] text-muted-foreground">Updated {age(status.at)}{refresh.statusFromCache ? " (saved in this browser)" : ""}</span> : null}
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" disabled={refresh.phase === "refreshing"} onClick={onRefresh}>
              {refresh.phase === "refreshing" ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
              {refresh.phase === "refreshing" ? "Refreshing…" : refresh.phase === "failed" ? "Try again" : "Refresh from Actual"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={onStatements}>Check against lender statement</Button>
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Balance label="Actual" value={show(status?.actualMinor ?? null)} caption="loan account today" />
          <Balance label="Calculated" value={show(status?.modelMinor ?? null)} caption={status?.asPaidFrom ? "as paid" : "on schedule"} info={asPaidNote(status, digits)} />
          <Balance
            label="Lender"
            value={lender ? show(status!.lenderMinor) : "No statement yet"}
            muted={!lender}
            caption={lender && status?.lenderDate ? `statement of ${shortDay(status.lenderDate)}` : null}
          />
        </dl>
        {state.hint ? <p className="text-xs">{state.hint}</p> : null}
        {refresh.phase === "failed" ? (
          <p role="alert" className="text-xs text-destructive">Could not refresh: {refresh.error}. {status ? `Showing data from ${age(status.at)}.` : ""} Rows may be out of date; Apply still re-checks Actual.</p>
        ) : null}
      </section>
      {matching && matching.cells.length ? (
        <section aria-label="Repayments in Actual" className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Repayments in Actual</h2>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{matching.facts.done} of {matching.facts.due} applied</span>
            {matching.facts.notApplied ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{matching.facts.notApplied} found, not applied</span> : null}
            {matching.facts.missing ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{matching.facts.missing} not found</span> : null}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{matching.facts.upcoming} upcoming</span>
          </div>
          <Timeline cells={matching.cells} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="Next expected" sub={matching.facts.next && matching.accountName ? `from ${matching.accountName}` : undefined}>
              {matching.facts.next ? <><span className="font-semibold tabular-nums">{formatAmount(matching.facts.next.amountMinor, digits)}</span> · {shortDay(matching.facts.next.date)}</> : paidOffOn ? "None: paid off" : "No more repayments"}
            </Fact>
            <Fact label="Last paid" sub={matching.facts.averageEarlyDays !== null ? (matching.facts.averageEarlyDays >= 0 ? `${matching.facts.averageEarlyDays} day${matching.facts.averageEarlyDays === 1 ? "" : "s"} early on average` : `${-matching.facts.averageEarlyDays} days late on average`) : undefined}>
              {matching.facts.lastMatched ? <><span className="font-semibold">{shortDay(matching.facts.lastMatched.paidDate)}</span> <span className="text-muted-foreground">for {shortDay(matching.facts.lastMatched.dueDate)}</span></> : "Nothing matched yet"}
            </Fact>
            <Fact label="Gap" sub={quiet ? undefined : gap?.sub}>{quiet ? <span className="font-semibold">None</span> : <span className="font-semibold">{gap?.text}</span>}</Fact>
            <Fact label="Matching" sub={matching.ruleOn ? `${matching.facts.done + matching.facts.notApplied} found · ${matching.facts.missing} not found` : undefined}>
              {matching.ruleOn === null ? "Loading…" : matching.ruleOn ? (
                <span className="font-semibold">Rule on{matching.window ? <span title={`Payments${matching.accountName ? ` from ${matching.accountName}` : ""}, ${matching.window.before} days early to ${matching.window.after} late`} className="ml-1 inline-grid size-3.5 cursor-help place-items-center rounded-full border border-border text-[9px] font-bold text-muted-foreground">i</span> : null}</span>
              ) : <span className="text-amber-700 dark:text-amber-300">No repayment rule on: set it up in Link to Actual</span>}
            </Fact>
          </div>
        </section>
      ) : null}
    </>
  );
}
