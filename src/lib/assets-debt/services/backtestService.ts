import { AppDbValidationError } from "@/lib/app-db/errors";
import { getDebt } from "@/lib/app-db/debtRepository";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { DebtMatchPurpose } from "@/lib/app-db/types";
import type { SyncSourceSplitLine, SyncSourceTransaction } from "@/lib/actual/transport";
import { readMatchingHistory, type MatchingHistorySnapshot, type MatchingReadTransport } from "../actual/ledgerPort";
import { projectStoredDebt } from "./projectionService";
import {
  backtestMatchingRule,
  enabledRuleSafetyIssues,
  parseStoredMatchRule,
  type DebtBacktestResult,
  type ExpectedMatchPeriod,
  type MatchCandidate,
} from "@/lib/financial-models/matching";

export type DebtBacktestRequest = {
  from: string;
  to: string;
  snapshots: MatchingHistorySnapshot[];
};

export type StoredRuleDefinition = {
  purpose?: DebtMatchPurpose;
  ruleFormatVersion: number;
  conditionsJson: string;
  actionsJson: string;
};

const marker = (importedId: string | null | undefined) => typeof importedId === "string" && importedId.startsWith("abdebt:");

function childCandidate(parent: SyncSourceTransaction, child: SyncSourceSplitLine, index: number, postingLinked: boolean): MatchCandidate {
  return {
    id: child.id ?? `${parent.id}::missing-child-${index}`,
    stableId: child.id !== null,
    parentId: child.parentId ?? parent.id,
    accountId: parent.accountId,
    date: parent.date,
    amountMinor: child.amount,
    payeeId: child.payeeId,
    importedPayee: child.importedPayee ?? parent.importedPayee ?? null,
    notes: child.notes,
    categoryId: child.categoryId,
    cleared: child.cleared,
    reconciled: child.reconciled,
    transferId: child.transferId,
    isParent: false,
    isChild: child.isChild,
    benchMarked: marker(child.importedId ?? parent.importedId),
    postingLinked,
  };
}

function parentCandidate(row: SyncSourceTransaction, postingLinked: boolean): MatchCandidate {
  return {
    id: row.id,
    stableId: true,
    parentId: row.parentId,
    accountId: row.accountId,
    date: row.date,
    amountMinor: row.amount,
    payeeId: row.payeeId,
    importedPayee: row.importedPayee ?? null,
    notes: row.notes,
    categoryId: row.categoryId,
    cleared: row.cleared,
    reconciled: row.reconciled,
    transferId: row.transferId,
    isParent: row.isParent,
    isChild: row.isChild,
    benchMarked: marker(row.importedId),
    postingLinked,
  };
}

export function matchingCandidates(
  snapshots: readonly MatchingHistorySnapshot[],
  linkedTransactionIds: ReadonlySet<string> = new Set()
): MatchCandidate[] {
  const candidates = snapshots.flatMap(({ transactions }) => transactions.flatMap((row) => [
    parentCandidate(row, linkedTransactionIds.has(row.id)),
    ...row.splitLines.map((child, index) => childCandidate(row, child, index, child.id !== null && linkedTransactionIds.has(child.id))),
  ]));
  return candidates.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id) || (a.parentId ?? "").localeCompare(b.parentId ?? ""));
}

function expectedPeriods(db: SqliteDatabase, debtId: string, purpose: DebtMatchPurpose, from: string, to: string): ExpectedMatchPeriod[] {
  const projected = projectStoredDebt(db, debtId, { from, to, resolution: "events" });
  if (!projected.ok) {
    if ("notFound" in projected) throw new AppDbValidationError("Debt not found");
    throw new AppDbValidationError(`The debt cannot be projected for this backtest: ${projected.blocked.message}`);
  }
  if (!projected.projection.ok) {
    throw new AppDbValidationError(`The debt cannot be projected for this backtest: ${projected.projection.blocked.map((reason) => reason.message).join(" ")}`);
  }
  const events = projected.projection.events.filter((event) => purpose === "interest-charge"
    ? event.eventType === "interest-charge"
    : event.eventType === "repayment" || event.eventType === "final-payment");
  return events
    .map((event) => ({
      periodKey: event.date,
      date: event.date,
      paymentMinor: purpose === "interest-charge"
        ? Math.abs(event.interestMinor)
        : purpose === "lender-repayment-row"
          ? Math.abs(event.principalMovementMinor)
          : Math.abs(event.cashMovementMinor),
      balanceAfterMinor: event.balanceAfterMinor,
      principalMinor: Math.abs(event.principalMovementMinor),
      interestMinor: Math.abs(event.interestMinor),
      feesMinor: Math.abs(event.feesMinor),
      ...(purpose === "repayment" ? {
        fromOffsetMinor: typeof event.diagnostics.offsetFundedMinor === "number" ? event.diagnostics.offsetFundedMinor : 0,
        otherFundsMinor: typeof event.diagnostics.otherFundsMinor === "number" ? event.diagnostics.otherFundsMinor : Math.abs(event.cashMovementMinor),
      } : {}),
    }));
}

export function runDebtBacktest(
  db: SqliteDatabase,
  debtId: string,
  rule: StoredRuleDefinition,
  request: DebtBacktestRequest,
  generatedAt?: string
): DebtBacktestResult {
  const debt = getDebt(db, debtId);
  if (!debt) throw new AppDbValidationError("Debt not found");
  if (request.from > request.to) throw new AppDbValidationError("Backtest start date must not be after its end date");
  const parsed = parseStoredMatchRule(rule);
  const namedAccounts = new Set(parsed.conditions.items.filter((item) => item.kind === "source-account").map((item) => item.accountId));
  const suppliedAccounts = new Set(request.snapshots.map((snapshot) => snapshot.accountId));
  if ([...namedAccounts].some((accountId) => !suppliedAccounts.has(accountId))) {
    throw new AppDbValidationError("The backtest snapshot is missing a source account named by the rule");
  }
  if (request.snapshots.some((snapshot) => snapshot.transactions.length > 5_000)) {
    throw new AppDbValidationError("A backtest snapshot exceeds the 5,000 transaction per-account limit");
  }
  if (request.snapshots.some((snapshot) => snapshot.transactions.some((row) => row.accountId !== snapshot.accountId || row.date < request.from || row.date > request.to))) {
    throw new AppDbValidationError("A backtest transaction falls outside its account or requested date window");
  }
  // P1.4 has no posting-backed links. Keep match-rule/user links claimable for
  // their existing debt; only the future v44 `posting` source trips this guard.
  const existingLinks = new Set(
    listDebtTransactionLinks(db, debtId)
      .filter((link) => (typeof link.linkSource === "string" ? link.linkSource : link.linkSource.unknown) === "posting")
      .map((link) => link.actualTransactionId)
  );
  return backtestMatchingRule({
    ...parsed,
    expectedPeriods: expectedPeriods(db, debtId, rule.purpose ?? "repayment", request.from, request.to),
    candidates: matchingCandidates(request.snapshots, existingLinks),
    accountsRead: request.snapshots.length,
    from: request.from,
    to: request.to,
    generatedAt,
  });
}

/** Automation/server-side parity hook; reads through only the read-only transport slice. */
export async function runDebtBacktestWithTransport(
  db: SqliteDatabase,
  debtId: string,
  rule: StoredRuleDefinition,
  input: { from: string; to: string; accountIds: readonly string[]; maxTransactionsPerAccount?: number },
  transport: MatchingReadTransport,
  generatedAt?: string
): Promise<DebtBacktestResult> {
  const snapshots = await readMatchingHistory(transport, input);
  return runDebtBacktest(db, debtId, rule, { from: input.from, to: input.to, snapshots }, generatedAt);
}

export function ruleCanBeEnabled(rule: StoredRuleDefinition, result: DebtBacktestResult): { ok: true } | { ok: false; reasons: string[] } {
  const { conditions } = parseStoredMatchRule(rule);
  const reasons = [
    ...enabledRuleSafetyIssues(conditions),
    ...(result.strength.strength === "weak" ? result.strength.reasons : []),
    ...(result.summary.multiple > 0 ? ["The backtest has periods with multiple candidates."] : []),
    ...(result.summary.unsafe > 0 ? ["The backtest has unsafe existing transactions."] : []),
  ];
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
