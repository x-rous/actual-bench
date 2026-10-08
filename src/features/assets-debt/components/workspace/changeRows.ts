import type { PlanningNotice } from "@/lib/assets-debt/services/planner/common";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";

/**
 * The Activity list model (RD-084 P1.6b T289/T290; `ux-loan-workspace.md`
 * §3.4–§3.5, §3.8). Pure: one row per change, never one per stored record.
 * An Undo belongs to the row it reverses; superseded and declined versions are
 * that row's "earlier versions"; notices from the last refresh are Waiting
 * rows unless a change for the same period already has a row.
 */

export type ChangeFilter = "action" | "waiting" | "applied" | "undone" | "all";
export type RowState = "recommended" | "review" | "blocked" | "waiting" | "applying" | "applied" | "undo-pending" | "undone" | "failed" | "interrupted";

export type ChangeRowModel = {
  key: string;
  dueDate: string;
  paidDate: string | null;
  paymentMinor: number | null;
  posting: PostingView | null;
  /** A pending or applied Undo of `posting`. */
  undo: PostingView | null;
  notice: PlanningNotice | null;
  earlier: PostingView[];
  /** The expanded-row key: stable across recalculations of the same proposal. */
  openKey: string;
  state: RowState;
  group: Exclude<ChangeFilter, "all">;
  /** What a checkbox on this row would do; null when the row cannot be selected. */
  selectable: "apply" | "undo" | "reverse" | null;
  /** Shown as one row: consecutive due dates with no payment found, oldest first. */
  missedDates?: string[];
};

const LIVE_UNDO = new Set(["proposed", "approved", "applying", "indeterminate", "failed"]);

function paidAndPayment(posting: PostingView): { paidDate: string | null; paymentMinor: number | null } {
  const o = posting.output;
  switch (o.kind) {
    case "restructure": return { paidDate: posting.basis.paidDate ?? o.before.date, paymentMinor: o.before.amountMinor };
    case "convert": return { paidDate: o.before.date, paymentMinor: o.before.amountMinor };
    case "link": return { paidDate: o.sourceBefore.date, paymentMinor: o.sourceBefore.amountMinor };
    case "claim": return o.recordedSplit ? { paidDate: o.recordedSplit.parent.date, paymentMinor: o.recordedSplit.parent.amountMinor } : { paidDate: o.rows[0]?.date ?? null, paymentMinor: o.rows[0]?.amountMinor ?? null };
    case "adjust-split": return { paidDate: o.parent.date, paymentMinor: o.parent.amountMinor };
    case "create": return { paidDate: o.operations[0]?.date ?? null, paymentMinor: o.operations.reduce((sum, op) => sum + op.amountMinor, 0) };
    default: return { paidDate: null, paymentMinor: null };
  }
}

function stateOf(posting: PostingView, undo: PostingView | null): RowState {
  const status = String(posting.status);
  if (status === "proposed") return posting.classification === "blocked" ? "blocked" : posting.classification === "safe" ? "recommended" : "review";
  if (status === "applying" || status === "approved") return "applying";
  if (status === "indeterminate") return "interrupted";
  if (status === "failed") return "failed";
  if (status === "reversed") return "undone";
  if (status === "applied") return undo && LIVE_UNDO.has(String(undo.status)) ? "undo-pending" : "applied";
  return "review";
}

const GROUP: Record<RowState, ChangeRowModel["group"]> = {
  recommended: "action", review: "action", blocked: "action", applying: "action", interrupted: "action", failed: "action", "undo-pending": "action",
  applied: "applied", undone: "undone", waiting: "waiting",
};

/** Released because Actual no longer holds it (owner decision 2026-10-07): history, not something the user undid. */
const changedInActual = (p: PostingView) => String(p.status) === "reversed" && (p.error as { cause?: unknown } | null)?.cause === "changed-in-actual";

export function buildChangeRows(postings: readonly PostingView[], notices: readonly PlanningNotice[] = []): ChangeRowModel[] {
  const released = postings.filter((p) => !p.reversalOf && changedInActual(p));
  const changes = postings.filter((p) => !p.reversalOf && !["superseded", "declined"].includes(String(p.status)) && !changedInActual(p));
  const undoOf = new Map<string, PostingView>();
  for (const p of postings) {
    if (!p.reversalOf || ["superseded", "declined"].includes(String(p.status))) continue;
    const current = undoOf.get(p.reversalOf);
    if (!current || p.createdAt > current.createdAt) undoOf.set(p.reversalOf, p);
  }
  const rows: ChangeRowModel[] = changes.map((posting) => {
    const undo = undoOf.get(posting.id) ?? null;
    const state = stateOf(posting, undo);
    const earlier = postings
      .filter((p) => p.id !== posting.id && !p.reversalOf && p.postingKind === posting.postingKind && p.periodKey === posting.periodKey && ["superseded", "declined"].includes(String(p.status)))
      // A recalculation that produced the same change (for example after an earlier month was
      // applied) is not a different version for the user.
      .filter((p) => JSON.stringify(p.output) !== JSON.stringify(posting.output) || p.classification !== posting.classification || String(p.status) === "declined")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const selectable = state === "recommended" || state === "review"
      ? "apply"
      : state === "undo-pending" && undo && String(undo.status) === "proposed" && undo.classification !== "blocked" ? "undo"
        : state === "applied" || (state === "undo-pending" && undo?.status === "failed" && (undo.error as { written?: unknown } | null)?.written === false) ? "reverse" : null;
    // Stays the same while a proposal is recalculated, so an open row stays open after a refresh.
    const openKey = String(posting.status) === "proposed" ? `proposed:${posting.postingKind}:${posting.periodKey}` : posting.id;
    return { key: posting.id, openKey, dueDate: posting.periodKey, ...paidAndPayment(posting), posting, undo, notice: null, earlier, state, group: GROUP[state], selectable };
  });
  for (const notice of notices) {
    const row = rows.find((r) => r.dueDate === notice.periodKey && r.posting && r.group !== "undone");
    if (row) {
      row.notice = row.notice ?? notice;
      continue;
    }
    rows.push({ key: `notice:${notice.code}:${notice.periodKey}`, openKey: `notice:${notice.code}:${notice.periodKey}`, dueDate: notice.periodKey, paidDate: null, paymentMinor: null, posting: null, undo: null, notice, earlier: [], state: "waiting", group: "waiting", selectable: null });
  }
  // A change Actual no longer holds goes into the history of that due date's row; only when the due
  // date has no other row does it stand on its own (so the reason is still seen).
  for (const posting of released) {
    const row = rows.find((r) => r.dueDate === posting.periodKey && r.posting);
    if (row) {
      row.earlier = [...row.earlier, posting].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      continue;
    }
    rows.push({ key: posting.id, openKey: posting.id, dueDate: posting.periodKey, ...paidAndPayment(posting), posting, undo: null, notice: null, earlier: [], state: "undone", group: "undone", selectable: null });
  }
  // Newest due date first.
  return rows.sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.key.localeCompare(b.key));
}

const MISSED = new Set(["repayment-missing", "no-repayment-rule"]);
export const isMissedRow = (row: ChangeRowModel) => !row.posting && !!row.notice && MISSED.has(row.notice.code);

/**
 * For display only: consecutive due dates with no payment found read as one row ("24 repayments
 * not found, Jan 2023 to Dec 2024"), not 24 identical ones. The model keeps one row per due date
 * (the timeline needs them).
 */
export function groupMissedRows(rows: readonly ChangeRowModel[]): ChangeRowModel[] {
  const out: ChangeRowModel[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last && isMissedRow(last) && isMissedRow(row) && last.notice!.code === row.notice!.code) {
      const dates = [row.dueDate, ...(last.missedDates ?? [last.dueDate])];
      out[out.length - 1] = { ...last, key: `${last.key}+${row.dueDate}`, missedDates: dates };
      continue;
    }
    out.push(row);
  }
  return out;
}

export function rowsFor(rows: readonly ChangeRowModel[], filter: ChangeFilter): ChangeRowModel[] {
  return filter === "all" ? [...rows] : rows.filter((r) => r.group === filter);
}

export function countByFilter(rows: readonly ChangeRowModel[]): Record<ChangeFilter, number> {
  const count = (group: ChangeRowModel["group"]) => rows.filter((r) => r.group === group).length;
  return { action: count("action"), waiting: count("waiting"), applied: count("applied"), undone: count("undone"), all: rows.length };
}

/**
 * Bulk order (owner refinement 1): changes oldest first, since each month builds on the one
 * before; undos newest first, the reverse of how the changes were built.
 */
export function bulkOrder(rows: readonly ChangeRowModel[]): ChangeRowModel[] {
  const applies = rows.filter((r) => r.selectable === "apply").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const undos = rows.filter((r) => r.selectable === "undo").sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  return [...undos, ...applies];
}
