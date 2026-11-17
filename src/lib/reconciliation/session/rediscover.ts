/**
 * Relate transactions that appeared in Actual after a session was matched to
 * the statement rows the user has not yet settled.
 *
 * The common way in: start a reconciliation, let bank sync import the missing
 * rows overnight, come back and press Create. Without this the new rows sit on
 * screen as "Actual only" next to their own statement row reading "not in
 * Actual", and the user creates duplicates. Apply already ran this check for
 * rows marked Create; resume now runs it too, and both share this one function.
 *
 * Pure: no I/O. It never decides anything — a statement row that gains a
 * candidate goes back to undecided with the evidence attached, so the person
 * sees what changed and makes the call.
 */

import { match } from "../match/matcher";
import type {
  ActualTransactionSnapshot,
  MatchConfig,
  ReconciliationDisposition,
  ReconciliationItem,
  StatementRow,
} from "../types";
import { buildReconciliationItems, isStatementOnly, REASON } from "./build";

export type RediscoverInput = {
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  /** Transactions not represented by any item. */
  newTransactions: ActualTransactionSnapshot[];
  config: MatchConfig;
  transfersReported: boolean;
  statementPeriod: { start: string; end: string } | null;
  /** Which statement-only rows may be reconsidered. */
  reconsider: ReadonlySet<ReconciliationDisposition>;
  /** Items that must not change (already applied). */
  frozenItemIds?: ReadonlySet<string>;
  makeId: () => string;
};

export type RediscoverResult = {
  items: ReconciliationItem[];
  /** Statement rows that gained a candidate and went back to undecided. */
  reopened: number;
  /** New transactions that became rows of their own. */
  added: number;
};

export function rediscoverStatementMatches(input: RediscoverInput): RediscoverResult {
  const open = input.items.filter((item) =>
    isStatementOnly(item) &&
    input.reconsider.has(item.disposition) &&
    !input.frozenItemIds?.has(item.id)
  );
  const rows = open
    .map((item) => input.statementRows.get(item.statementRowIds[0]))
    .filter((row): row is StatementRow => Boolean(row));

  if (input.newTransactions.length === 0) return { items: input.items, reopened: 0, added: 0 };

  const graph = rows.length
    ? match({
        statementRows: rows,
        actualTransactions: input.newTransactions,
        config: input.config,
      })
    : {
        matched: [],
        ambiguous: [],
        unmatchedStatementRowIds: [],
        unmatchedActualTransactionIds: input.newTransactions.map((row) => row.id),
        likelyDuplicates: [],
      };

  const discovered = buildReconciliationItems({
    statementRows: rows,
    actualTransactions: input.newTransactions,
    graph,
    transfersReported: input.transfersReported,
    statementPeriod: input.statementPeriod,
    makeId: input.makeId,
  });

  const byStatementRow = new Map(
    discovered
      .filter((item) => item.statementRowIds.length && item.actualTransactionIds.length)
      .map((item) => [item.statementRowIds[0], item])
  );

  let reopened = 0;
  const next = input.items.map((item): ReconciliationItem => {
    if (!open.includes(item)) return item;
    const candidate = byStatementRow.get(item.statementRowIds[0]);
    if (!candidate) return item;
    reopened += 1;
    return {
      ...item,
      actualTransactionIds: candidate.actualTransactionIds,
      guards: candidate.guards,
      match: candidate.match,
      // Never matched on the user's behalf: the account changed under a decision
      // they had made (or not yet made), so they look again.
      reasonCode: candidate.disposition === "matched" ? REASON.newInActual : candidate.reasonCode,
      disposition: "unresolved",
    };
  });

  const ownRows = discovered.filter((item) => item.statementRowIds.length === 0);
  return { items: next.concat(ownRows), reopened, added: ownRows.length };
}
