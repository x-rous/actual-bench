import { addDays, addMonths } from "@/lib/financial-models/calendar/dates";
import type { ActivityRow, ActivitySnapshot } from "./activity";
import type { Card, Membership, Statement, Workspace } from "./models";
import { minorAmountSchema } from "./models";
import { formatCardDate } from "./displayDates";
import { cycleDates, minimumEstimate, recentClosings, type StatementDraft } from "./cycles";

export function sumMinor(values: readonly number[]) {
  const result = Number(values.reduce((sum, value) => sum + BigInt(minorAmountSchema.parse(value)), BigInt(0)));
  return minorAmountSchema.parse(result);
}

export function statementDrafts(card: Card, today: string, count: number, snapshot: ActivitySnapshot, signedCurrentMinor: number, bankStatements: Statement[] = []): StatementDraft[] {
  const firstEvidence = [...snapshot.rows.map((row) => row.date), ...bankStatements.filter((entry) => entry.cardId === card.id).map((entry) => entry.periodStart)].sort()[0];
  const firstTracked = card.firstTrackedStatementDate ?? bankStatements.find((entry) => entry.cardId === card.id && entry.openingAnchor)?.closingDate;
  return recentClosings(card, today, count).flatMap((closingDate) => {
    if (firstTracked && closingDate < firstTracked) return [];
    const dates = cycleDates(card, closingDate);
    const priorException = bankStatements.filter((entry) => entry.cardId === card.id && entry.bankConfirmed && entry.closingDate < closingDate && entry.closingDate >= addDays(dates.periodStart, -7) && entry.closingDate <= addDays(dates.periodStart, 7)).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
    if (priorException) dates.periodStart = addDays(priorException.closingDate, 1);
    if (dates.periodStart < snapshot.from || closingDate > snapshot.to || snapshot.issues.length) return [];
    // Reverse the current Actual balance over subsequent billing membership, in minor units.
    // A single non-transfer tag moves activity across the closing cutoff, not the live balance.
    // Conflicting tags keep the date estimate and remain unresolved in transaction review.
    const subsequent = snapshot.rows.filter((row) => {
      const tags = row.transferId ? [] : statementTags(row.notes);
      return tags.length === 1 ? tags[0] > closingDate.slice(0, 7) : row.date > closingDate;
    });
    const owed = sumMinor([-signedCurrentMinor, snapshot.futureDeltaMinor ?? 0, sumMinor(subsequent.map((row) => row.amountMinor))]);
    // Keep inferred opening debt, and genuine zero cycles inside known history,
    // without inventing empty statements before the account has any evidence.
    if (card.openedDate && closingDate < card.openedDate) return [];
    if (owed === 0 && (!firstEvidence || closingDate < firstEvidence)) return [];
    const minimum = minimumEstimate(card, owed);
    return [{ ...dates, officialBalanceMinor: owed, minimumDueMinor: minimum ?? 0, bankConfirmed: false as const, minimumKnown: minimum !== null }];
  });
}

/** Tags identify the closing month, independently of the Actual transaction date. */
export function statementTags(notes: string | null) {
  return [...new Set(Array.from((notes ?? "").matchAll(/(?:^|[^\w#])#(\d{4}-(?:0[1-9]|1[0-2]))(?![\w-])/g), (match) => match[1]))];
}

export function effectiveMembership(statement: Statement, row: ActivityRow, saved: Membership[]) {
  const found = saved.find((entry) => entry.statementId === statement.id && entry.transactionId === row.id);
  const override = row.transferId && found?.provenance === "suggested" ? undefined : found;
  if (override && override.fingerprint === row.fingerprint) return override;
  const date = override?.fingerprint === row.fingerprint ? override.bankPostingDate ?? row.date : row.date;
  const tags = row.transferId ? [] : statementTags(row.notes);
  const tagged = tags.length === 1;
  const matches = tags[0] === statement.closingDate.slice(0, 7);
  const nearClose = date >= addDays(statement.closingDate, -1) && date <= addDays(statement.closingDate, 2);
  const inside = date >= statement.periodStart && date <= statement.closingDate;
  return {
    statementId: statement.id, cardId: statement.cardId, transactionId: row.id,
    decision: override || tags.length > 1 ? "review" as const : tagged ? matches ? "included" as const : "excluded" as const : nearClose ? "review" as const : inside ? "included" as const : "excluded" as const,
    provenance: "suggested" as const, bankPostingDate: null, fingerprint: row.fingerprint,
    reason: override ? "Actual transaction changed; review your previous decision" : tags.length > 1 ? "Conflicting statement tags need a decision" : tagged ? `Statement tag #${tags[0]}` : nearClose ? "Bank posting cutoff needs a decision" : "Actual date suggestion",
  };
}

/** Saved inclusion reserves a transaction until it is excluded from its owning statement. */
export function membershipOwner(statement: Statement, transactionId: string, workspace: Workspace, decisions = workspace.memberships) {
  return workspace.statements.filter((entry) => entry.cardId === statement.cardId && entry.id !== statement.id)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.id.localeCompare(b.id))
    .find((owner) => decisions.some((entry) => entry.cardId === statement.cardId && entry.statementId === owner.id && entry.transactionId === transactionId && entry.decision === "included"));
}

export function statementReview(statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot, decisions = workspace.memberships) {
  const prior = workspace.statements.filter((entry) => entry.cardId === statement.cardId && entry.bankConfirmed && entry.closingDate < statement.closingDate).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  const continuity = Boolean(prior && addDays(prior.closingDate, 1) === statement.periodStart);
  const decisionsByTransaction = new Map(decisions.filter((entry) => entry.statementId === statement.id).map((entry) => [entry.transactionId, entry]));
  const rows = snapshot.rows.filter((row) => {
    const saved = decisionsByTransaction.get(row.id);
    const decision = saved?.fingerprint === row.fingerprint ? saved : undefined;
    const date = decision?.bankPostingDate ?? row.date;
    return (date >= addDays(statement.periodStart, -2) && date <= addDays(statement.closingDate, 2)) || decision?.decision === "included" || (!(row.transferId) && statementTags(row.notes).includes(statement.closingDate.slice(0, 7)));
  });
  const scopedDecisions = [...decisionsByTransaction.values()];
  const memberships = rows.map((row) => {
    const membership = effectiveMembership(statement, row, scopedDecisions);
    const owner = membershipOwner(statement, row.id, workspace, decisions);
    return owner ? { ...membership, decision: "excluded" as const, reason: `Included in statement ${formatCardDate(owner.closingDate)}` } : membership;
  });
  const included = rows.filter((_, index) => memberships[index].decision === "included");
  const coverage = snapshot.from <= statement.periodStart && snapshot.to >= addDays(statement.closingDate, 2) && !snapshot.issues.length;
  const unresolved = memberships.filter((entry) => entry.decision === "review").length;
  const calculatedMinor = continuity ? sumMinor([prior.officialBalanceMinor, -sumMinor(included.map((row) => row.amountMinor))]) : null;
  const varianceMinor = calculatedMinor === null ? null : sumMinor([statement.officialBalanceMinor, -calculatedMinor]);
  // Adjacent overrides cannot claim the same activity twice.
  const duplicate = rows.some((row) => scopedDecisions.some((entry) => entry.transactionId === row.id && entry.decision === "included" && entry.fingerprint === row.fingerprint) && Boolean(membershipOwner(statement, row.id, workspace, decisions)));
  // Ownership changes on already-excluded candidates cannot change this statement.
  // Keep owners for included/undecided candidates so genuine conflicts still invalidate evidence.
  const signature = JSON.stringify([rows.map((row) => [row.fingerprint, effectiveMembership(statement, row, scopedDecisions).decision === "excluded" ? null : membershipOwner(statement, row.id, workspace, decisions)?.id ?? null]), prior ? [prior.id, prior.officialBalanceMinor, prior.closingDate] : null, coverage, snapshot.issues]);
  return { signature, rows, memberships, calculatedMinor, varianceMinor, unresolved, coverage, continuity, duplicate,
    canVerify: statement.bankConfirmed && continuity && coverage && unresolved === 0 && !duplicate && varianceMinor === 0,
    stale: statement.reviewedSnapshot !== null && statement.reviewedSnapshot !== signature,
  };
}

export function activityWindow(today: string, months: number) {
  return { from: addMonths(today, -Math.min(36, Math.max(6, months))), to: today };
}

/** Read-only previews let history work before bank confirmation, without silently saving facts. */
export function previewStatements(cardId: string, drafts: StatementDraft[]): Statement[] {
  return drafts.map((draft) => ({
    periodStart: draft.periodStart, closingDate: draft.closingDate, dueDate: draft.dueDate, officialBalanceMinor: draft.officialBalanceMinor, minimumDueMinor: draft.minimumDueMinor, bankConfirmed: false, id: `preview:${cardId}:${draft.closingDate}`, cardId, revision: 1,
    lifecycle: "recorded", verification: "recorded", coverage: "bounded", openingAnchor: false, reviewedSnapshot: null,
  }));
}


export type StatementMove = { transactionId: string; targetStatementId: string; expectedTargetRevision: number };

/** Draft-only preview; the store validates every target revision and source fingerprint before one atomic save. */
export function movedMemberships(statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot, input: Membership[], moves: StatementMove[]) {
  let memberships = [...workspace.memberships.filter((entry) => entry.statementId !== statement.id), ...input];
  for (const move of moves) {
    const row = snapshot.rows.find((entry) => entry.id === move.transactionId);
    const target = workspace.statements.find((entry) => entry.id === move.targetStatementId);
    if (!row || !target) continue;
    const reason = `Moved from statement ${formatCardDate(statement.closingDate)} to ${formatCardDate(target.closingDate)}`;
    memberships = memberships.filter((entry) => !(entry.transactionId === row.id && (entry.statementId === statement.id || entry.statementId === target.id)));
    memberships.push({ statementId: statement.id, cardId: statement.cardId, transactionId: row.id, decision: "excluded", provenance: "manual", bankPostingDate: input.find((entry) => entry.transactionId === row.id)?.bankPostingDate ?? null, fingerprint: row.fingerprint, reason }, { statementId: target.id, cardId: statement.cardId, transactionId: row.id, decision: "included", provenance: "manual", bankPostingDate: input.find((entry) => entry.transactionId === row.id)?.bankPostingDate ?? null, fingerprint: row.fingerprint, reason });
  }
  return memberships;
}
