import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import { createObservedRepaymentAllocator, interestAllocationOf } from "@/lib/financial-models/loan/statementAllocation";
import { modelFromDetail } from "../model/buildModel";
import { getDebtDetail } from "./debtConfigService";
import { openingFor } from "./opening";
import type { PostingOutputSnapshot } from "./snapshot";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { getDebt } from "@/lib/app-db/debtRepository";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { DebtMatchPurpose } from "@/lib/app-db/types";
import type { SyncSourceSplitLine, SyncSourceTransaction } from "@/lib/actual/transport";
import { readMatchingHistory, type MatchingHistorySnapshot, type MatchingReadTransport } from "../actual/ledgerPort";
import { projectStoredDebt } from "./projectionService";
import { alignRepayments, settledPaymentOf } from "./repaymentAlignment";
import {
  backtestMatchingRule,
  DEBT_BACKTEST_FORMAT,
  DEBT_BACKTEST_VERSION,
  enabledRuleSafetyIssues,
  matchRuleStrength,
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
  const candidates = snapshots.flatMap(({ transactions }) => transactions.flatMap((row) => {
    // A repayment already split in Actual is matched as one payment; its parts are not candidates.
    const loanSplit = row.isParent && row.splitLines.length >= 2 && row.splitLines.every((l) => l.id !== null)
      && row.splitLines.filter((l) => l.transferId).length === 1;
    if (loanSplit) {
      const principal = row.splitLines.find((l) => l.transferId)!;
      return [{ ...parentCandidate(row, linkedTransactionIds.has(row.id) || linkedTransactionIds.has(principal.id!)),
        loanSplit: true, loanSplitTransfer: { childId: principal.id!, counterpartId: principal.transferId! } }];
    }
    return [
      parentCandidate(row, linkedTransactionIds.has(row.id)),
      ...row.splitLines.map((child, index) => childCandidate(row, child, index, child.id !== null && linkedTransactionIds.has(child.id))),
    ];
  }));
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
  const periods = expectedPeriods(db, debtId, rule.purpose ?? "repayment", request.from, request.to);
  const candidates = matchingCandidates(request.snapshots, existingLinks);
  const result = (rule.purpose ?? "repayment") === "repayment"
    ? alignedBacktest(db, debtId, parsed.conditions, periods, candidates, request, generatedAt)
    : backtestMatchingRule({ ...parsed, expectedPeriods: periods, candidates, accountsRead: request.snapshots.length, from: request.from, to: request.to, generatedAt });
  const marked = markHandledPeriods(db, debtId, rule.purpose ?? "repayment", result);
  return (rule.purpose ?? "repayment") === "repayment" ? withActualDatedAllocation(db, debtId, marked) : marked;
}

/**
 * The matching check for repayments, the same way Sync Repayments matches them (owner decision
 * 2026-10-07): the loan's payments lined up against every due date in the range in one pass, with
 * no day window. A period reads as found, missing or unsafe; why a pairing needs a look (late,
 * early, amount, another candidate) is in its review reasons.
 */
function alignedBacktest(
  db: SqliteDatabase,
  debtId: string,
  conditions: ReturnType<typeof parseStoredMatchRule>["conditions"],
  periods: ExpectedMatchPeriod[],
  candidates: MatchCandidate[],
  request: DebtBacktestRequest,
  generatedAt?: string,
): DebtBacktestResult {
  const debt = getDebt(db, debtId)!;
  const settled = new Map<string, { paymentId: string; date: string }>();
  for (const p of listSubjectPostings(db, "debt", debtId)) {
    if (!["applying", "applied", "indeterminate"].includes(String(p.status)) || !["repayment-split", "repayment-link"].includes(String(p.postingKind))) continue;
    const paid = settledPaymentOf(JSON.parse(p.outputSnapshotJson) as PostingOutputSnapshot);
    if (paid) settled.set(p.periodKey, paid);
  }
  const alignment = alignRepayments({
    candidates,
    liabilityAccountId: debt.liabilityAccountId,
    signConvention: debt.signConvention === "positive-is-debt" ? "positive-is-debt" : "negative-is-debt",
    rule: conditions,
    dues: periods.map((p) => ({ key: p.periodKey, date: p.date, expectedMinor: p.paymentMinor, settled: settled.get(p.periodKey) ?? null, ...(p.fromOffsetMinor ? { offsetFundedMinor: p.fromOffsetMinor } : {}) })),
    pins: repaymentChoices(db, debtId),
    toleranceMinor: debt.driftToleranceMinor,
    minorDigits: debt.currencyMinorDigits,
  });
  const rows = periods.map((expected) => {
    const evaluation = alignment.evaluation(expected.periodKey) ?? { expected, status: "missing" as const, candidates: [], strength: "strong" as const, reviewReasons: [] };
    const flags = [...new Set(evaluation.candidates.flatMap(({ candidate }) => [
      ...(candidate.reconciled ? ["reconciled"] : []),
      ...(candidate.isParent || candidate.isChild ? ["split"] : []),
      ...(candidate.transferId ? ["transferred"] : []),
      ...(candidate.categoryId ? ["categorized"] : []),
    ]))];
    return { ...evaluation, expected, projectedBalanceVarianceMinor: null, flags };
  });
  const count = (status: string) => rows.filter((period) => period.status === status).length;
  const strength = matchRuleStrength(conditions);
  return {
    format: DEBT_BACKTEST_FORMAT,
    version: DEBT_BACKTEST_VERSION,
    from: request.from,
    to: request.to,
    generatedAt: generatedAt ?? new Date().toISOString(),
    read: { accounts: request.snapshots.length, transactions: candidates.filter((c) => !c.isChild).length },
    strength,
    warnings: strength.reasons,
    summary: { expectedPeriods: rows.length, unique: count("unique"), missing: count("missing"), multiple: 0, unsafe: count("unsafe") },
    periods: rows,
  };
}

/** The user's "this is the payment" choices for a loan, by due date (owner decision 2026-10-07). */
export function repaymentChoices(db: SqliteDatabase, debtId: string): Array<{ key: string; paymentId: string }> {
  return listDebtTransactionLinks(db, debtId).filter((l) => l.role === "repayment-choice").map((l) => ({ key: l.periodKey, paymentId: l.actualTransactionId }));
}

/**
 * The backtest's expected split, the same way Activity splits a repayment (T292; FR-069a): on
 * actual payment dates from the loan's opening, applied splits as applied. Only when the history
 * starts at the opening (the default); a later start keeps the scheduled figures rather than
 * guessing the months before it.
 */
function withActualDatedAllocation(db: SqliteDatabase, debtId: string, result: DebtBacktestResult): DebtBacktestResult {
  const detail = getDebtDetail(db, debtId);
  const built = detail ? modelFromDetail(detail) : null;
  if (!built || !built.ok || built.model.profile.accrual === "per-period") return result;
  const opening = openingFor(db, debtId, built.model);
  const firstDue = [...result.periods].map((p) => p.expected.date).sort()[0];
  if (!firstDue || result.periods.length === 0 || result.from > opening.date || firstDue <= opening.date) return result;
  const created = createObservedRepaymentAllocator({ model: built.model, opening, allocation: interestAllocationOf(built.model) });
  if (!created.ok) return result;
  const applied = new Map<string, Extract<PostingOutputSnapshot, { kind: "restructure" }>>();
  for (const p of listSubjectPostings(db, "debt", debtId)) {
    if (p.postingKind !== "repayment-split" || !["applying", "applied", "indeterminate"].includes(String(p.status))) continue;
    const output = JSON.parse(p.outputSnapshotJson) as PostingOutputSnapshot;
    if (output.kind === "restructure") applied.set(p.periodKey, output);
  }
  const allocated = new Map<string, { principalMinor: number; interestMinor: number; feesMinor: number }>();
  for (const period of [...result.periods].sort((a, b) => a.expected.date.localeCompare(b.expected.date))) {
    const split = applied.get(period.expected.date);
    const unique = period.status === "unique" ? period.candidates[0]?.candidate : null;
    const entry = split
      ? {
          dueDate: period.expected.date, paidDate: split.before.date, amountMinor: Math.abs(split.before.amountMinor),
          feesMinor: split.operations.filter((c) => c.economicKind !== "principal" && c.economicKind !== "interest").reduce((sum, c) => sum + Math.abs(c.amountMinor), 0),
          ...(split.override ? { appliedInterestMinor: split.override.interestMinor } : {}),
        }
      : unique
        ? { dueDate: period.expected.date, paidDate: unique.date, amountMinor: Math.abs(unique.amountMinor), feesMinor: period.expected.feesMinor ?? 0 }
        : { dueDate: period.expected.date, paidDate: period.expected.date, amountMinor: period.expected.paymentMinor, feesMinor: period.expected.feesMinor ?? 0 };
    const row = created.allocator.push(entry);
    if (!row.ok) return result;
    if (split || unique) allocated.set(period.expected.date, { principalMinor: row.row.principalMinor, interestMinor: row.row.interestMinor, feesMinor: row.row.feesMinor });
  }
  return {
    ...result,
    periods: result.periods.map((period) => {
      const split = allocated.get(period.expected.date);
      return split ? { ...period, expected: { ...period.expected, ...split } } : period;
    }),
  };
}

/** The posting kinds that, once applied, handle a period for each rule purpose. */
const HANDLING_KINDS: Record<string, readonly string[]> = {
  repayment: ["repayment-split", "repayment-link"],
  "interest-charge": ["interest-charge", "interest-link"],
  "lender-repayment-row": ["repayment-link"],
};

/**
 * A period Bench already handled in an applied change no longer has a claimable row: it reads as
 * missing, or as unsafe when the applied split's parent is still visible. Flag it "already handled"
 * and leave it out of the missing, multiple and unsafe counts, so the backtest says so and the
 * enable gate does not refuse a rule because its own periods were applied (T287).
 */
function markHandledPeriods(db: SqliteDatabase, debtId: string, purpose: string, result: DebtBacktestResult): DebtBacktestResult {
  const kinds = HANDLING_KINDS[purpose] ?? [];
  const handled = new Set(
    listSubjectPostings(db, "debt", debtId)
      .filter((p) => ["applying", "applied", "indeterminate"].includes(String(p.status)) && kinds.includes(String(p.postingKind)))
      .map((p) => p.periodKey)
  );
  // Any period a live change already handles is "already handled", whatever the rule found there now
  // (the split Bench made is itself matchable as a split already in Actual).
  const periods = result.periods.map((period) => (handled.has(period.expected.date) ? { ...period, flags: [...period.flags, "already-handled"] } : period));
  const counted = periods.filter((period) => !period.flags.includes("already-handled"));
  const count = (status: string) => counted.filter((period) => period.status === status).length;
  return { ...result, periods, summary: { ...result.summary, unique: count("unique"), missing: count("missing"), multiple: count("multiple"), unsafe: count("unsafe") } };
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
