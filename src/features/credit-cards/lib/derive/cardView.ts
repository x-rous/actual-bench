import type { ActivityRow, ActivitySnapshot } from "../activity";
import { isOpeningStatement, type StatementDraft } from "../cycles";
import { latestStatement } from "../insights";
import type { Card, Statement, Workspace } from "../models";
import { previewStatements, statementDrafts, statementReview } from "../statements";
import { paymentAssignments, paymentRows, statementPayments, type StatementPayment } from "./payments";
import { bankMatch, hasLaterStatement, needsAttention, paymentStatus, type BankMatch, type PaymentStatus } from "./status";

/** One statement as every screen shows it. */
export type StatementRow = {
  statement: Statement;
  payment: StatementPayment | undefined;
  status: PaymentStatus;
  match: BankMatch;
  attention: boolean;
  startingPoint: boolean;
};

/** Everything a card's screens derive from one data state, computed once and shared (§10.2). */
export type CardView = {
  /** Unsaved estimates for cycles with no saved statement. */
  drafts: StatementDraft[];
  /** The workspace plus read-only estimate statements; the workspace itself when there are none. */
  statementWorkspace: Workspace;
  /** This card's saved statements followed by its estimates. */
  statements: Statement[];
  /** Rule P allocation per statement; empty without activity. */
  payments: StatementPayment[];
  /** Per-statement status, in `statements` order. */
  rows: StatementRow[];
  /** Latest saved bank statement. */
  bank: Statement | undefined;
  nextPayment: StatementPayment | undefined;
  /** Oldest estimate still waiting for its bank figures. */
  awaitingStatement: Statement | undefined;
  /** Payment and reversal rows with the statement each one pays first. */
  paymentList: { row: ActivityRow; date: string; statement: Statement | undefined }[];
  attentionCount: number;
};

type ViewInput = {
  card: Card;
  workspace: Workspace;
  snapshot: ActivitySnapshot | undefined;
  /** Signed integer minor units: the card's raw Actual balance used to estimate statements. */
  rawSignedBalanceMinor: number | undefined;
  today: string;
};

const NO_SNAPSHOT = {};
const views = new WeakMap<Workspace, WeakMap<Card, WeakMap<object, Map<string, CardView>>>>();

/**
 * Memoised on immutable inputs (workspace, card, snapshot) plus the scalar balance and date.
 * A refresh keeps the last snapshot, so screens never blank while data refetches (UI-2).
 */
export function deriveCardView(input: ViewInput): CardView {
  const { card, workspace, snapshot, rawSignedBalanceMinor, today } = input;
  let byCard = views.get(workspace);
  if (!byCard) {
    byCard = new WeakMap();
    views.set(workspace, byCard);
  }
  let bySnapshot = byCard.get(card);
  if (!bySnapshot) {
    bySnapshot = new WeakMap();
    byCard.set(card, bySnapshot);
  }
  const snapshotKey = snapshot ?? NO_SNAPSHOT;
  let byScalars = bySnapshot.get(snapshotKey);
  if (!byScalars) {
    byScalars = new Map();
    bySnapshot.set(snapshotKey, byScalars);
  }
  const key = `${today}|${rawSignedBalanceMinor ?? "none"}`;
  let view = byScalars.get(key);
  if (!view) {
    view = calculate(input);
    byScalars.set(key, view);
  }
  return view;
}

function overlaps(statement: Statement, draft: StatementDraft) {
  return !(statement.closingDate < draft.periodStart || statement.periodStart > draft.closingDate);
}

/** A zero opening statement with nothing on it is where tracking starts, not a bill. */
function startingPoint(card: Card, statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot | undefined) {
  if (!isOpeningStatement(card, statement, workspace.statements) || statement.balanceMinor !== 0 || statement.minimumDueMinor !== 0) return false;
  if (!snapshot) return false;
  const review = statementReview(statement, workspace, snapshot);
  return review.complete && !review.memberships.some((entry) => entry.decision === "included");
}

function calculate({ card, workspace, snapshot, rawSignedBalanceMinor, today }: ViewInput): CardView {
  const saved = workspace.statements.filter((entry) => entry.cardId === card.id);
  const drafts = snapshot && rawSignedBalanceMinor !== undefined
    ? statementDrafts(card, today, undefined, snapshot, rawSignedBalanceMinor, workspace.statements)
      .filter((draft) => !saved.some((entry) => overlaps(entry, draft)))
    : [];
  const previews = previewStatements(card.id, drafts);
  const statementWorkspace = previews.length ? { ...workspace, statements: [...workspace.statements, ...previews] } : workspace;
  const statements = [...saved, ...previews];
  const payments = snapshot ? statementPayments(card, statementWorkspace, snapshot, today) : [];
  // Only the oldest estimate asks to be entered; later ones wait their turn.
  const awaitingStatement = [...previews].sort((a, b) => a.closingDate.localeCompare(b.closingDate))[0];
  const rows = statements.map((statement): StatementRow => {
    const payment = payments.find((entry) => entry.statementId === statement.id);
    const starting = startingPoint(card, statement, workspace, snapshot);
    const status = paymentStatus(statement, payment, today, starting, hasLaterStatement(statements.filter((entry) => entry.closingDate <= today), statement));
    const match = bankMatch(statement, statementWorkspace, snapshot);
    const attention = statement.estimate ? statement === awaitingStatement : needsAttention(match, status);
    return { statement, payment, status, match, attention, startingPoint: starting };
  });
  const bank = latestStatement(saved, card.id);
  const assignments = snapshot ? paymentAssignments(card, statementWorkspace, snapshot, today) : new Map<string, { statementId: string }>();
  const paymentList = snapshot
    ? paymentRows(card, statementWorkspace, snapshot).map(({ row, date }) => ({
      row,
      date,
      statement: statements.find((entry) => entry.id === assignments.get(row.id)?.statementId),
    }))
    : [];
  return {
    drafts,
    statementWorkspace,
    statements,
    payments,
    rows,
    bank,
    nextPayment: bank ? payments.find((entry) => entry.statementId === bank.id) : undefined,
    awaitingStatement,
    paymentList,
    attentionCount: rows.filter((row) => row.attention).length,
  };
}
