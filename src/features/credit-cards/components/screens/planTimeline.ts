import type { ActivityRow, ActivitySnapshot } from "../../lib/activity";
import type { Card, RepaymentPlan, Workspace } from "../../lib/models";
import type { Tone } from "../../lib/derive/status";
import { peerOf, planLedger } from "../../lib/derive/planAccounts";
import { planProgress, roleLabels, suggestPlanLink, type PlanSuggestion } from "../../lib/plans";
import { planOf } from "../planLink";

/**
 * One plan's timeline (§9.10): the schedule and the transactions in one date-ordered list. Each
 * expected instalment carries what posted against it; every other plan transaction (booking, original
 * purchase, settlement, fees, refunds) is its own row. Works for every way a plan is recorded: in a plan
 * account (own or shared by tag), billed on the card, or kept in the card balance, with or without a schedule.
 */
export type TimelineRow = {
  key: string;
  /** Sort key: the posted date, or the due date of an instalment that has not posted. */
  date: string;
  /** The transaction's date in Actual; null until something posts. */
  postedDate: string | null;
  event: string;
  /** Positive minor units; null for rows that are not scheduled. */
  expectedMinor: number | null;
  /** The plan transaction (card side when there is one). */
  actual: ActivityRow | null;
  /** The card side's notes, else the plan-account side's (where the plan tag usually is). */
  notes: string | null;
  /** Principal still owed after this row; projected forward for expected instalments. Null when unknown. */
  remainingMinor: number | null;
  /** Posted minus expected, when both exist and differ. */
  differenceMinor: number | null;
  status: { label: string; tone: Tone; line?: string };
  /** An instalment's due date (it may post on another day). */
  dueDate?: string;
  /** Linked by you (can change or unlink), owned by the plan account or tag, a suggestion to link, or expected only. */
  source: "linked" | "owned" | "suggested" | "expected";
  /** How the transaction belongs (tooltip), e.g. "via tag #EMI_60K". */
  via?: string;
  /** A suggested transaction for this row, to Link. */
  suggestion?: { row: ActivityRow; suggestion: PlanSuggestion };
};

type PlanTransaction = {
  row: ActivityRow; source: "linked" | "owned"; role: string; via: string; roleKey?: string;
  notes: string | null;
  /** Change in principal owed (owned plan-account transfers only; positive = more owed). */
  principalMinor: number;
  /** One side of a plan-account transfer is cleared and the other is not. */
  unclearedSide: boolean;
};

/** The plan's transactions: linked by you, and owned through its plan account (D4). */
function planTransactions(plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot): PlanTransaction[] {
  const entries = workspace.planEntries.filter((item) => item.planId === plan.id);
  const linkedIds = new Set(entries.map((item) => item.transactionId));
  const shown = new Set<string>();
  const out: PlanTransaction[] = [];
  for (const row of snapshot.rows) {
    if (!linkedIds.has(row.id)) continue;
    const link = planOf(row, card, workspace, snapshot);
    const roleKey = entries.find((entry) => entry.transactionId === row.id)?.role;
    // On card-billed plans the bank's settlement and extra instalments reduce what the plan holds.
    const reduces = plan.recordedAs !== "plan-account" && (roleKey === "settlement" || (roleKey === "instalment" && row.amountMinor < 0));
    out.push({
      row, source: "linked", role: link.role, via: link.via || "linked by you", roleKey,
      notes: row.notes, principalMinor: reduces ? row.amountMinor : 0, unclearedSide: false,
    });
    shown.add(row.id);
  }
  if (plan.recordedAs === "plan-account") {
    for (const planRow of planLedger(card, workspace, snapshot).rowsByPlan.get(plan.id) ?? []) {
      const peer = peerOf(planRow, snapshot);
      const row = peer?.accountId === card.accountId ? peer : planRow;
      if (shown.has(row.id)) continue;
      shown.add(row.id);
      const link = row === peer ? planOf(row, card, workspace, snapshot) : null;
      out.push({
        row,
        source: "owned",
        role: link?.role || (planRow.amountMinor < 0 ? "Conversion" : "Instalment"),
        via: link?.via || (plan.planAccountTag ? `via tag ${plan.planAccountTag}` : "own plan account"),
        notes: row.notes || (row === peer ? planRow.notes : null),
        // A booking (negative in the plan account) adds principal; money back to the card removes it.
        principalMinor: -planRow.amountMinor,
        unclearedSide: row === peer && (row.cleared === true) !== (planRow.cleared === true),
      });
    }
  }
  return out.sort((a, b) => a.row.date.localeCompare(b.row.date) || a.row.id.localeCompare(b.row.id));
}

/** The event name for a plan transaction that is not matched to a scheduled instalment. */
function eventOf(item: PlanTransaction) {
  if (item.roleKey === "original" || item.role === roleLabels.original) return "Original purchase";
  if (item.roleKey === "settlement" || item.role === roleLabels.settlement) return "Early settlement";
  if (item.roleKey === "cost" || item.role === roleLabels.cost) return "Plan fee or interest";
  if (item.roleKey === "refund" || item.role === roleLabels.refund) return "Refund";
  if (item.roleKey === "adjustment" || item.role === roleLabels.adjustment) return "Adjustment";
  if (/conversion/i.test(item.role)) return "Booked";
  return /^Instalment \d/.test(item.role) ? item.role.replace("/", " of ") : "Instalment";
}

const isInstalment = (item: PlanTransaction, card: Card) => item.row.accountId === card.accountId && item.row.amountMinor < 0
  && (item.roleKey === "instalment" || /^Instalment/.test(item.role));

export function planTimeline(plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot | undefined, today: string, principalLeft: number | null) {
  const transactions = snapshot ? planTransactions(plan, card, workspace, snapshot) : [];
  const progress = planProgress(plan, card, workspace, undefined);
  const tracked = new Set(progress.tracked.map((row) => row.index));
  const entries = workspace.planEntries.filter((item) => item.planId === plan.id);

  // Expected against posted: numbered links first, then billed postings in date order fill the tracked rows.
  const billed = plan.scheduleKind === null ? [] : transactions.filter((item) => isInstalment(item, card));
  const posted = new Map<number, PlanTransaction>();
  for (const item of billed) {
    const number = entries.find((entry) => entry.transactionId === item.row.id)?.instalmentNumber;
    if (number && !posted.has(number)) posted.set(number, item);
  }
  const used = new Set([...posted.values()].map((item) => item.row.id));
  const rest = billed.filter((item) => !used.has(item.row.id));
  for (const row of progress.rows) {
    if (!tracked.has(row.index) || posted.has(row.index) || !rest.length) continue;
    const next = rest.shift()!;
    posted.set(row.index, next);
    used.add(next.row.id);
  }

  // Suggestions (active plans): one that names an instalment sits in that row; the others get their own rows.
  const suggestions = !snapshot || plan.status !== "active" ? [] : snapshot.rows.flatMap((row) => {
    if (transactions.some((item) => item.row.id === row.id)) return [];
    const suggestion = suggestPlanLink(row, plan, card, workspace, snapshot);
    return suggestion ? [{ row, suggestion }] : [];
  });
  const byInstalment = new Map<number, (typeof suggestions)[number]>();
  for (const entry of suggestions) {
    const number = entry.suggestion.instalmentNumber;
    if (number !== null && !posted.has(number) && !byInstalment.has(number)) byInstalment.set(number, entry);
  }

  // A plan with nothing left before its schedule ends closed early: the rest of the schedule is not needed.
  const finished = plan.status !== "active" || principalLeft === 0;
  const lastPosted = Math.max(0, ...posted.keys());
  const closedEarly = finished && progress.rows.some((row) => row.index > lastPosted && tracked.has(row.index));
  const settled = transactions.some((item) => !used.has(item.row.id) && eventOf(item) === "Early settlement");
  const count = progress.rows.length;
  let nextSeen = false;

  const rows: (TimelineRow & { principalMinor: number })[] = progress.rows.map((row) => {
    const match = posted.get(row.index) ?? null;
    const suggestion = byInstalment.get(row.index);
    const label = `Instalment ${row.index} of ${count}`;
    let status: TimelineRow["status"];
    if (!tracked.has(row.index)) status = { label: "Before tracking", tone: "muted" };
    else if (match) {
      // Without a separate settlement transaction, the last posting is the one that closed the plan early.
      status = closedEarly && row.index === lastPosted && !settled
        ? { label: "Closed early", tone: "success" }
        : { label: "Billed", tone: "success" };
    } else if (finished) status = { label: closedEarly ? "Not needed" : "Not seen", tone: "muted" };
    else if (row.date < today) status = { label: "Not seen", tone: "attention" };
    else if (!nextSeen) {
      nextSeen = true;
      status = { label: "Next", tone: "info" };
    } else status = { label: "Upcoming", tone: "neutral" };
    if (match?.unclearedSide) status = { ...status, line: "Plan account side not cleared" };
    const actualMinor = match ? -match.row.amountMinor : null;
    // Principal: what actually moved for plan-account transfers, the schedule's share otherwise; nothing for missed rows.
    const projected = ["Before tracking", "Next", "Upcoming"].includes(status.label);
    const principalMinor = match ? (match.source === "owned" ? match.principalMinor : -row.principalMinor) : projected ? -row.principalMinor : 0;
    return {
      key: `instalment-${row.index}`,
      date: match?.row.date ?? row.date,
      postedDate: match?.row.date ?? null,
      event: label,
      expectedMinor: row.amountMinor,
      actual: match?.row ?? null,
      notes: match?.notes ?? null,
      remainingMinor: null,
      principalMinor,
      differenceMinor: actualMinor !== null && actualMinor !== row.amountMinor ? actualMinor - row.amountMinor : null,
      status,
      dueDate: row.date,
      source: match ? match.source : "expected",
      via: match?.via,
      suggestion,
    };
  });
  for (const item of transactions) {
    if (used.has(item.row.id)) continue;
    rows.push({
      key: item.row.id,
      date: item.row.date,
      postedDate: item.row.date,
      event: eventOf(item),
      expectedMinor: null,
      actual: item.row,
      notes: item.notes,
      remainingMinor: null,
      principalMinor: item.principalMinor,
      differenceMinor: null,
      status: { label: "Recorded", tone: "neutral", line: item.unclearedSide ? "Plan account side not cleared" : undefined },
      source: item.source,
      via: item.via,
    });
  }
  for (const entry of suggestions) {
    if ([...byInstalment.values()].includes(entry)) continue;
    rows.push({
      key: `suggested-${entry.row.id}`,
      date: entry.row.date,
      postedDate: entry.row.date,
      event: `${roleLabels[entry.suggestion.role]} (suggested)`,
      expectedMinor: null,
      actual: null,
      notes: entry.row.notes,
      remainingMinor: null,
      principalMinor: 0,
      differenceMinor: null,
      status: { label: "Suggested", tone: "info", line: entry.suggestion.reason },
      source: "suggested",
      suggestion: entry,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  // Running principal: from the opening, else from the original amount on the card, else from zero until
  // the plan account's booking. Rows on or before an opening are before the plan's tracked principal.
  const start = plan.opening?.principalMinor ?? (plan.recordedAs === "plan-account" ? 0 : plan.originalAmountMinor);
  let running = start;
  let booked = plan.recordedAs !== "plan-account" || Boolean(plan.opening);
  const out: TimelineRow[] = rows.map(({ principalMinor, ...row }) => {
    if (running === null || (plan.opening && row.date <= plan.opening.date)) return row;
    running = Math.max(0, running + principalMinor);
    booked ||= principalMinor !== 0;
    return booked ? { ...row, remainingMinor: running } : row;
  });
  return { rows: out, suggestedCount: suggestions.length, closedEarly, lastPostedDate: lastPosted ? posted.get(lastPosted)!.row.date : null };
}
