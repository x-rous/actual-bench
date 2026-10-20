import { evidenceHash } from "./evidence";
import { addDays, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import type { ActivityRow, ActivitySnapshot } from "./activity";
import type { Card, Decision, Statement, Workspace } from "./models";
import { minorAmountSchema } from "./models";
import { safeIntegerSum } from "./minor";
import { formatCardDate } from "./displayDates";
import { cycleDates, isOpeningStatement, minimumEstimate, recentClosings, trackingStart, type StatementDraft } from "./cycles";
import { decisionsFor } from "./derive/indexes";
import { planBalanceAt } from "./derive/planAccounts";

/** Exact sum of minor amounts. The BigInt path (with its validation errors) runs only when the fast path can't. */
export function sumMinor(values: readonly number[]) {
  const fast = safeIntegerSum(values);
  if (fast !== null) return fast;
  const result = Number(values.reduce((sum, value) => sum + BigInt(minorAmountSchema.parse(value)), BigInt(0)));
  return minorAmountSchema.parse(result);
}

/** Tags identify the closing month, independently of the Actual transaction date. */
export function statementTags(notes: string | null) {
  const matches = (notes ?? "").matchAll(/(?:^|[^\w#])#(\d{4}-(?:0[1-9]|1[0-2]))(?![\w-])/g);
  return [...new Set(Array.from(matches, (match) => match[1]))];
}

const tagCache = new WeakMap<ActivityRow, string[]>();
function tagsOf(row: ActivityRow) {
  let tags = tagCache.get(row);
  if (!tags) {
    tags = row.transferId ? [] : statementTags(row.notes);
    tagCache.set(row, tags);
  }
  return tags;
}

/**
 * Estimated statements for closed cycles with no saved statement (§7.1 #20):
 * `−balance today + Σ rows after close` (tag-aware). Never stored unless the user saves one.
 */
export function statementDrafts(
  card: Card, today: string, count: number | undefined, snapshot: ActivitySnapshot, signedCurrentMinor: number, saved: readonly Statement[] = [],
): StatementDraft[] {
  const cardStatements = saved.filter((entry) => entry.cardId === card.id && !entry.estimate);
  const firstEvidence = [...snapshot.rows.map((row) => row.date), ...cardStatements.map((entry) => entry.periodStart)].sort()[0];
  const firstTracked = trackingStart(card, cardStatements);
  const start = firstTracked ? parseIsoDate(firstTracked) : null;
  const end = parseIsoDate(today);
  const cycleCount = count ?? (start ? Math.max(1, (end.year - start.year) * 12 + end.month - start.month + 1) : 6);
  const closings = recentClosings(card, today, cycleCount);
  // An explicitly selected opening cycle stays actionable, including bank closing-date exceptions.
  if (firstTracked && firstTracked <= today && !closings.includes(firstTracked)) closings.push(firstTracked);
  return closings.sort().reverse().flatMap((closingDate) => {
    if (firstTracked && closingDate < firstTracked) return [];
    const dates = cycleDates(card, closingDate);
    const priorException = cardStatements
      .filter((entry) => entry.closingDate < closingDate
        && entry.closingDate >= addDays(dates.periodStart, -7) && entry.closingDate <= addDays(dates.periodStart, 7))
      .sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
    if (priorException) dates.periodStart = addDays(priorException.closingDate, 1);
    if (dates.periodStart < snapshot.from || closingDate > snapshot.to || snapshot.issues.length) return [];
    // A single non-transfer tag moves activity across the cutoff; conflicting tags keep the date.
    const subsequent = snapshot.rows.filter((row) => {
      const tags = tagsOf(row);
      return tags.length === 1 ? tags[0] > closingDate.slice(0, 7) : row.date > closingDate;
    });
    const owed = sumMinor([-signedCurrentMinor, snapshot.futureDeltaMinor ?? 0, sumMinor(subsequent.map((row) => row.amountMinor))]);
    if (card.openedDate && closingDate < card.openedDate) return [];
    // Keep genuine zero cycles inside known history without inventing empty ones before it.
    if (closingDate !== firstTracked && owed === 0 && (!firstEvidence || closingDate < firstEvidence)) return [];
    const minimum = minimumEstimate(card, owed);
    return [{
      ...dates,
      balanceMinor: owed,
      minimumDueMinor: Math.min(minimum ?? 0, Math.max(0, owed)),
      amountDueMinor: null,
      previousBalanceMinor: null,
      minimumKnown: minimum !== null,
    }];
  });
}

/** Read-only previews let history work before bank figures exist, without saving anything. */
export function previewStatements(cardId: string, drafts: readonly StatementDraft[]): Statement[] {
  return drafts.map((draft) => ({
    id: `preview:${cardId}:${draft.closingDate}`,
    cardId,
    revision: 1,
    periodStart: draft.periodStart,
    closingDate: draft.closingDate,
    dueDate: draft.dueDate,
    balanceMinor: draft.balanceMinor,
    minimumDueMinor: draft.minimumDueMinor,
    amountDueMinor: null,
    previousBalanceMinor: null,
    reviewState: "not_reviewed",
    reviewHash: null,
    reviewedAt: null,
    scopeAcceptedDifferenceMinor: null,
    estimate: true,
  }));
}

/** A row's state on one statement in review: a saved answer, a suggestion, or undecided. */
export type Membership = {
  transactionId: string;
  decision: "included" | "excluded" | "review";
  /** `user` and `verification` are saved answers; `suggested` is computed. */
  origin: Decision["origin"] | "suggested";
  bankPostingDate: string | null;
  note: string | null;
  /** Why the row has this state. */
  reason: string;
  /** The saved answer before the row's date or amount changed (shown pre-filled). */
  previous: "included" | "excluded" | null;
  /** Saved on another statement for this card: excluded here and locked. */
  ownerId: string | null;
};

/** The effective decision for one row on one statement (§7.4). */
export function effectiveMembership(statement: Statement, row: ActivityRow, saved: Decision | undefined): Membership {
  const base = {
    transactionId: row.id,
    bankPostingDate: null,
    note: saved?.note ?? null,
    previous: null,
    ownerId: null,
  } as const;
  if (saved && saved.sourceHash === row.fingerprint) {
    return {
      ...base,
      decision: saved.decision,
      origin: saved.origin,
      bankPostingDate: saved.bankPostingDate,
      reason: saved.origin === "verification" ? "Matched to the bank statement" : "Your decision",
    };
  }
  // A changed date or amount reopens the row, pre-filled with the previous answer.
  if (saved) {
    return { ...base, decision: "review", origin: "suggested", previous: saved.decision, reason: "Changed in Actual since you decided" };
  }
  const tags = tagsOf(row);
  const close = statement.closingDate;
  const nearClose = row.date >= addDays(close, -1) && row.date <= addDays(close, 2);
  const inside = row.date >= statement.periodStart && row.date <= close;
  const suggest = (decision: Membership["decision"], reason: string): Membership => ({ ...base, decision, origin: "suggested", reason });
  if (tags.length > 1) return suggest("review", "Conflicting statement tags");
  if (tags.length === 1) {
    return tags[0] === close.slice(0, 7)
      ? suggest("included", `Tagged #${tags[0]}`)
      : suggest("excluded", `Tagged #${tags[0]}`);
  }
  if (statement.reviewState === "verified" && nearClose) return suggest("excluded", "Not on the verified statement");
  if (nearClose) return suggest("review", "Near the closing date");
  return inside ? suggest("included", "Dated in this period") : suggest("excluded", "Dated outside this period");
}

/** Immutable arrays scope this index to exactly the reviewed workspace and decision draft. */
const ownershipIndexes = new WeakMap<readonly Decision[], WeakMap<readonly Statement[], Map<string, Statement[]>>>();
function ownershipIndex(statements: readonly Statement[], decisions: readonly Decision[]) {
  let byStatements = ownershipIndexes.get(decisions);
  if (!byStatements) {
    byStatements = new WeakMap();
    ownershipIndexes.set(decisions, byStatements);
  }
  let index = byStatements.get(statements);
  if (!index) {
    index = new Map();
    const byId = new Map(statements.map((entry) => [entry.id, entry]));
    for (const decision of decisions) {
      if (decision.decision !== "included") continue;
      const owner = byId.get(decision.statementId);
      if (!owner || owner.cardId !== decision.cardId) continue;
      const key = `${owner.cardId}\u0000${decision.transactionId}`;
      const owners = index.get(key) ?? [];
      if (!owners.some((entry) => entry.id === owner.id)) owners.push(owner);
      index.set(key, owners);
    }
    for (const owners of index.values()) owners.sort((a, b) => a.closingDate.localeCompare(b.closingDate));
    byStatements.set(statements, index);
  }
  return index;
}

/** A saved inclusion on another statement reserves the transaction (a row is on one bill only). */
export function membershipOwner(statement: Statement, transactionId: string, workspace: Workspace, decisions: readonly Decision[] = workspace.decisions) {
  return ownershipIndex(workspace.statements, decisions).get(`${statement.cardId}\u0000${transactionId}`)
    ?.find((owner) => owner.id !== statement.id);
}

/** Rows sorted by date for range lookups (one index per snapshot). */
const dateIndexes = new WeakMap<readonly ActivityRow[], { dates: string[]; rows: ActivityRow[] }>();
function rowsBetween(rows: readonly ActivityRow[], from: string, to: string) {
  let index = dateIndexes.get(rows);
  if (!index) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    index = { dates: sorted.map((row) => row.date), rows: sorted };
    dateIndexes.set(rows, index);
  }
  const lower = (target: string, inclusive: boolean) => {
    let low = 0;
    let high = index!.dates.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (inclusive ? index!.dates[middle] < target : index!.dates[middle] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  return index.rows.slice(lower(from, true), lower(to, false));
}

export type StatementReview = ReturnType<typeof calculateStatementReview>;
const reviewCache = new WeakMap<Workspace, WeakMap<ActivitySnapshot, WeakMap<readonly Decision[], WeakMap<Statement, StatementReview>>>>();

/** The statement's candidate rows, their effective decisions and the reconciliation. Cached. */
export function statementReview(statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot, decisions: readonly Decision[] = workspace.decisions) {
  let snapshots = reviewCache.get(workspace);
  if (!snapshots) {
    snapshots = new WeakMap();
    reviewCache.set(workspace, snapshots);
  }
  let choices = snapshots.get(snapshot);
  if (!choices) {
    choices = new WeakMap();
    snapshots.set(snapshot, choices);
  }
  let statements = choices.get(decisions);
  if (!statements) {
    statements = new WeakMap();
    choices.set(decisions, statements);
  }
  let result = statements.get(statement);
  if (!result) {
    result = calculateStatementReview(statement, workspace, snapshot, decisions);
    statements.set(statement, result);
  }
  return result;
}

function calculateStatementReview(statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot, decisions: readonly Decision[]) {
  const card = workspace.cards.find((entry) => entry.id === statement.cardId);
  const saved = workspace.statements.filter((entry) => entry.cardId === statement.cardId && !entry.estimate);
  const prior = saved
    .filter((entry) => entry.closingDate < statement.closingDate)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  const continuity = Boolean(prior && addDays(prior.closingDate, 1) === statement.periodStart);
  const own = new Map(decisions.filter((entry) => entry.statementId === statement.id).map((entry) => [entry.transactionId, entry]));
  // Bounds and the tag are computed once per statement, not per row (first review §6.4).
  const from = addDays(statement.periodStart, -2);
  const to = addDays(statement.closingDate, 2);
  const tag = statement.closingDate.slice(0, 7);
  const candidates = new Map(rowsBetween(snapshot.rows, from, to).map((row) => [row.id, row]));
  for (const row of snapshot.rows) {
    if (candidates.has(row.id)) continue;
    const decision = own.get(row.id);
    const posting = decision?.sourceHash === row.fingerprint ? decision.bankPostingDate : null;
    const postedInside = posting !== null && posting >= from && posting <= to;
    if (decision?.decision === "included" || postedInside || tagsOf(row).includes(tag)) candidates.set(row.id, row);
  }
  const rows = [...candidates.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const memberships = rows.map((row): Membership => {
    const membership = effectiveMembership(statement, row, own.get(row.id));
    const owner = membershipOwner(statement, row.id, workspace, decisions);
    if (owner) return { ...membership, decision: "excluded", ownerId: owner.id, reason: `On statement ${formatCardDate(owner.closingDate)}` };
    const carried = prior && !own.has(row.id) && row.date >= from && row.date < statement.periodStart
      && decisionsFor(decisions, statement.cardId, row.id)
        .some((entry) => entry.statementId === prior.id && entry.decision === "excluded" && entry.sourceHash === row.fingerprint);
    return carried ? { ...membership, decision: "included", reason: "Not billed on the previous statement" } : membership;
  });
  const included = rows.filter((_, index) => memberships[index].decision === "included");
  const coverage = snapshot.from <= statement.periodStart && snapshot.to >= statement.closingDate && !snapshot.issues.length;
  const unresolved = memberships.filter((entry) => entry.decision === "review").length;
  const opening = card ? isOpeningStatement(card, statement, saved) : false;
  // Start: the previous bank statement when continuous, else the entered previous balance (D3).
  const startingBalanceMinor = continuity ? prior!.balanceMinor : statement.previousBalanceMinor;
  // D15: the bank's balance includes plan principal, so add its change over the period.
  const planChangeMinor = card?.statementsIncludePlanBalances ? planChange(card, statement, workspace, snapshot) : 0;
  const calculatedMinor = startingBalanceMinor === null || planChangeMinor === null
    ? null
    : sumMinor([startingBalanceMinor, -sumMinor(included.map((row) => row.amountMinor)), planChangeMinor]);
  const varianceMinor = calculatedMinor === null ? null : sumMinor([statement.balanceMinor, -calculatedMinor]);
  const duplicate = rows.some((row) => {
    const decision = own.get(row.id);
    return decision?.decision === "included" && decision.sourceHash === row.fingerprint
      && Boolean(membershipOwner(statement, row.id, workspace, decisions));
  });
  // D20: financial facts only (never clearing, category or notes).
  const signature = evidenceHash([
    rows.flatMap((row, index) => {
      const membership = memberships[index];
      if (membership.decision === "excluded") return [];
      return [[row.fingerprint, membership.decision, membership.bankPostingDate, membership.ownerId]];
    }),
    startingBalanceMinor,
    statement.balanceMinor,
    coverage,
    // With plan balances on the statement, the plan change is a financial fact of the match. Only added
    // when the card includes them, so other cards keep the reviews they already have.
    ...(card?.statementsIncludePlanBalances ? [["plan-balances", planChangeMinor]] : []),
  ]);
  return {
    signature,
    rows,
    memberships,
    startingBalanceMinor,
    planChangeMinor,
    calculatedMinor,
    varianceMinor,
    unresolved,
    coverage,
    continuity,
    duplicate,
    opening,
    /** Complete, decided and reconciled: saving marks it verified (D26). */
    complete: coverage && unresolved === 0 && !duplicate,
    stale: statement.reviewHash !== null && statement.reviewHash !== signature,
  };
}

/** Change in plan-account principal from the previous close to this close, or null if unknown. */
function planChange(card: Card, statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot) {
  const before = planBalanceAt(card, workspace, snapshot, addDays(statement.periodStart, -1));
  const after = planBalanceAt(card, workspace, snapshot, statement.closingDate);
  return before === null || after === null ? null : sumMinor([after, -before]);
}

export type StatementMove = { transactionId: string; targetStatementId: string; expectedTargetRevision: number };

/** Draft-only preview of saving: this statement's answers replaced, moves applied to both sides. */
export function draftDecisions(
  statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot, answers: readonly Decision[], moves: readonly StatementMove[],
) {
  let decisions = [...workspace.decisions.filter((entry) => entry.statementId !== statement.id), ...answers];
  for (const move of moves) {
    const row = snapshot.rows.find((entry) => entry.id === move.transactionId);
    const target = workspace.statements.find((entry) => entry.id === move.targetStatementId);
    if (!row || !target) continue;
    const posting = answers.find((entry) => entry.transactionId === row.id)?.bankPostingDate ?? null;
    const base = {
      cardId: statement.cardId, transactionId: row.id, origin: "user" as const, bankPostingDate: posting, sourceHash: row.fingerprint, note: null,
    };
    decisions = decisions.filter((entry) => !(entry.transactionId === row.id && (entry.statementId === statement.id || entry.statementId === target.id)));
    decisions.push({ ...base, statementId: statement.id, decision: "excluded" }, { ...base, statementId: target.id, decision: "included" });
  }
  return decisions;
}

const rowStatementCache = new WeakMap<Workspace, WeakMap<ActivitySnapshot, Map<string, Map<string, Statement>>>>();

/** The saved statement each card transaction is on (latest wins when a row was moved), cached per data state. */
export function statementsByRow(cardId: string, workspace: Workspace, snapshot: ActivitySnapshot): ReadonlyMap<string, Statement> {
  let bySnapshot = rowStatementCache.get(workspace);
  if (!bySnapshot) rowStatementCache.set(workspace, bySnapshot = new WeakMap());
  let byCard = bySnapshot.get(snapshot);
  if (!byCard) bySnapshot.set(snapshot, byCard = new Map());
  let result = byCard.get(cardId);
  if (!result) {
    result = new Map();
    const statements = workspace.statements
      .filter((item) => item.cardId === cardId && !item.estimate)
      .sort((a, b) => b.closingDate.localeCompare(a.closingDate));
    for (const statement of statements) {
      const review = statementReview(statement, workspace, snapshot);
      review.rows.forEach((row, index) => {
        if (review.memberships[index].decision === "included" && !result!.has(row.id)) result!.set(row.id, statement);
      });
    }
    byCard.set(cardId, result);
  }
  return result;
}
