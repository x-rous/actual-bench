import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import type { ChangeRowModel } from "./changeRows";

/**
 * What the Transactions status strip says about repayment matching (rev 4, T305). Pure: the
 * loan's scheduled due dates from its projection, joined with the change rows Bench already has
 * (the same rows as the list below) and the last refresh's notices. Nothing here reads Actual.
 */

export type DueState = "applied" | "edited" | "found" | "blocked" | "missing" | "not-checked" | "next" | "upcoming";
export type DueCell = { date: string; state: DueState };

export const DUE_LABEL: Record<DueState, string> = {
  applied: "Applied",
  edited: "Applied with your edit",
  found: "Found, not applied",
  blocked: "Found, cannot be applied yet",
  missing: "Not found",
  "not-checked": "Outside the period shown",
  next: "Next",
  upcoming: "Upcoming",
};

const REPAYMENT_KINDS = new Set(["repayment-split", "repayment-link"]);
const SCHEDULED = new Set(["repayment", "final-payment"]);
const MISSING = new Set(["repayment-missing"]);

const repaymentRow = (r: ChangeRowModel) => !!r.posting && REPAYMENT_KINDS.has(String(r.posting.postingKind)) && r.group !== "undone";
const edited = (r: ChangeRowModel) => {
  const o = r.posting?.output;
  if (o?.kind === "restructure") return !!o.override;
  if (o?.kind === "adjust-split") return !!o.edit;
  return o?.kind === "claim" && !!o.recordedSplit && Math.abs(o.recordedSplit.interestMinor - o.recordedSplit.calculatedInterestMinor) > 1;
};
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** One cell per scheduled repayment, oldest first. */
export function repaymentTimeline(events: readonly DebtProjectionEvent[], rows: readonly ChangeRowModel[], today: string): DueCell[] {
  const byDate = new Map<string, ChangeRowModel[]>();
  for (const r of rows) {
    if (!repaymentRow(r) && !(r.notice && MISSING.has(r.notice.code))) continue;
    byDate.set(r.dueDate, [...(byDate.get(r.dueDate) ?? []), r]);
  }
  let nextGiven = false;
  return events.filter((e) => SCHEDULED.has(e.eventType)).map((e): DueCell => {
    const here = byDate.get(e.date) ?? [];
    const applied = here.find((r) => repaymentRow(r) && (r.state === "applied" || r.state === "undo-pending"));
    if (applied) return { date: e.date, state: edited(applied) ? "edited" : "applied" };
    const proposed = here.find((r) => repaymentRow(r) && (r.state === "review" || r.state === "recommended" || r.state === "applying" || r.state === "interrupted" || r.state === "failed"));
    if (proposed) return { date: e.date, state: "found" };
    if (here.some((r) => repaymentRow(r) && r.state === "blocked")) return { date: e.date, state: "blocked" };
    if (here.some((r) => r.notice && MISSING.has(r.notice.code))) return { date: e.date, state: "missing" };
    if (e.date > today) {
      if (!nextGiven) {
        nextGiven = true;
        return { date: e.date, state: "next" };
      }
      return { date: e.date, state: "upcoming" };
    }
    return { date: e.date, state: "not-checked" };
  });
}

export type MatchingFacts = {
  due: number;
  done: number;
  upcoming: number;
  edited: number;
  missing: number;
  notApplied: number;
  next: { date: string; amountMinor: number } | null;
  lastMatched: { paidDate: string; dueDate: string } | null;
  /** Average days paid before the due date over applied repayments; negative means late. */
  averageEarlyDays: number | null;
};

export function matchingFacts(events: readonly DebtProjectionEvent[], rows: readonly ChangeRowModel[], cells: readonly DueCell[], today: string): MatchingFacts {
  const nextEvent = events.find((e) => SCHEDULED.has(e.eventType) && e.date > today) ?? null;
  const matched = rows.filter((r) => repaymentRow(r) && r.paidDate && r.state !== "blocked").sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const appliedPaid = rows.filter((r) => repaymentRow(r) && r.paidDate && (r.state === "applied" || r.state === "undo-pending"));
  const early = appliedPaid.map((r) => days(r.paidDate!, r.dueDate));
  return {
    due: cells.filter((c) => c.date <= today).length,
    done: cells.filter((c) => c.state === "applied" || c.state === "edited").length,
    upcoming: cells.filter((c) => c.date > today).length,
    edited: cells.filter((c) => c.state === "edited").length,
    missing: cells.filter((c) => c.state === "missing").length,
    notApplied: cells.filter((c) => c.state === "found" || c.state === "blocked").length,
    next: nextEvent ? { date: nextEvent.date, amountMinor: -nextEvent.cashMovementMinor } : null,
    lastMatched: matched[0] ? { paidDate: matched[0].paidDate!, dueDate: matched[0].dueDate } : null,
    averageEarlyDays: early.length ? Math.round(early.reduce((s, d) => s + d, 0) / early.length) : null,
  };
}
