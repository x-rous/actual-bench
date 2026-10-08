import { approveAndRecordClaim, rowsToCheck } from "./postingWorkflowService";
import { closeSettledFailures, releaseChangedInActual, type ChangedInActual } from "./actualBinding";
import { repaymentAlignment } from "./planner/common";
import { canonicalHash } from "@/lib/app-db/canonicalJson";
import { openingFor } from "./opening";
import { listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { listSubjectPostings, pruneSupersededProposals, supersedeStaleProposals, upsertProposal } from "@/lib/app-db/financialPostingRepository";
import { getLatestModelRevision } from "@/lib/app-db/modelRevisionRepository";
import type { DebtRecord, FinancialPostingRecord, SqliteDatabase } from "@/lib/app-db/types";
import { hasPostingLease, recoverAbandonedPostings } from "@/lib/app-db/debtPostingLeaseRepository";
import { parseStoredMatchRule, type MatchConditionsV1 } from "@/lib/financial-models/matching";
import type { AccountDirectory, MatchingHistorySnapshot } from "../actual/ledgerPort";
import { modelFromDetail } from "../model/buildModel";
import { matchingCandidates, repaymentChoices } from "./backtestService";
import { getDebt } from "@/lib/app-db/debtRepository";
import { getDebtDetail, type DebtDetail } from "./debtConfigService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";
import { planAdjustments } from "./planner/adjustments";
import type { ExistingPostingSummary, PlanningContext, PlanningNotice, ComponentConfig } from "./planner/common";
import { planPatternA } from "./planner/patternA";
import { planPatternB } from "./planner/patternB";
import { followRecordedExtraPayments, splitRepaymentCounterparts, unscheduledPayments, type FollowedExtraPayment, type UnscheduledPayment } from "./extraPaymentService";
import { liabilityEffectMinor } from "./pendingEffect";
import { reconcileDebt } from "./reconciliationService";
import { indexReadRows, POSTING_INPUT_FORMAT_VERSION, type PostingInputSnapshot, type PostingOutputSnapshot, type RowSnapshot } from "./snapshot";

/**
 * Proposals (RD-084 P1.6; FR-170a–FR-179, A-3).
 *
 * Builds the planning context from the stored configuration, the effective
 * anchor and the browser's bounded read of Actual, runs the planners, and
 * records each proposal (an unchanged undecided proposal is reused by input
 * hash). It writes app-DB proposals only: nothing here can reach Actual, and
 * nothing is approved or applied here (SC-018).
 */

export type PreviewRequest = {
  from: string;
  to: string;
  today?: string;
  snapshots: MatchingHistorySnapshot[];
  accountDirectory: AccountDirectory;
  transferPayees: Record<string, string>;
  capabilities: { canRestructure: boolean; canVerifyTransferLinks: boolean };
  offsetHistories?: OffsetHistorySnapshot[];
  /**
   * Every top-level row of the loan account, over its whole history. When given, a linked extra
   * payment follows its transaction's date and amount wherever it now is, and is removed when the
   * transaction no longer exists. Without it, only rows in `snapshots` are followed and none removed.
   */
  loanAccountRows?: Array<{ id: string; date: string; amountMinor: number }>;
  /**
   * False while Terms & Schedule has unsaved edits in the browser: a linked extra payment is then
   * not moved or removed (that would save a revision under the edits and reload over them); the
   * panel shows the change and the next refresh after saving follows it.
   */
  followExtraPayments?: boolean;
  /** The account dates the snapshots cover; by default each snapshot's account over the window give or take 31 days. */
  verifiedMissingIds?: string[];
  readRanges?: Array<{ accountId: string; from: string; to: string }>;
  /** As in P1.5 lender reconciliation: the Actual liability balance as a debt magnitude at the comparison date. */
  comparison?: { comparisonDate: string; actualBalanceMinor: number } | null;
  parameters?: {
    openingAdjustmentCategoryId?: string | null;
    adjustmentCategoryId?: string | null;
    /** The Actual liability balance at the onboarding date, as a debt magnitude. */
    actualBalanceAtOnboardingMinor?: number | null;
  };
};

/** What the user needs to know about how a posting was worked out, from its input snapshot. */
export type PostingBasis = {
  /** Actual-dated repayment splits: the lender statement allocation and the dates used. */
  allocation: "as-calculated" | "accrued-to-due-date" | null;
  dueDate: string | null;
  paidDate: string | null;
  /** Earlier repayments taken as on schedule because they were not found in Actual. */
  assumedEarlier: number;
};

export type PostingView = Omit<FinancialPostingRecord, "inputSnapshotJson" | "outputSnapshotJson"> & {
  executionActive?: boolean;
  output: PostingOutputSnapshot;
  basis: PostingBasis;
  reused?: boolean;
};

function basisOf(inputJson: string): PostingBasis {
  const input = JSON.parse(inputJson) as PostingInputSnapshot;
  const observed = input.observedRepayments;
  const last = observed?.repayments.at(-1) ?? null;
  return {
    allocation: observed?.allocation ?? null,
    dueDate: last?.dueDate ?? null,
    paidDate: last?.paidDate ?? null,
    assumedEarlier: observed ? observed.repayments.slice(0, -1).filter((r) => r.assumed).length : 0,
  };
}

export type PreviewResult =
  | { ok: true; postings: PostingView[]; notices: PlanningNotice[]; driftMaterial: boolean; /** The pending changes close the gap (FR-170c). */ driftExplained: boolean; /** Payments into the loan account no repayment accounts for (extra payments). */ unscheduled: UnscheduledPayment[]; /** The loan's payments a due date can be given ("this is the payment"). */ paymentOptions: PaymentOption[]; /** Due dates the user chose a payment for. */ repaymentChoices: Array<{ key: string; paymentId: string }>; /** Applied changes Actual no longer holds, released on this read. */ changedInActual: ChangedInActual[]; /** The status figures (the reconciliation), when a comparison was given. */ reconciliation: Extract<ReturnType<typeof reconcileDebt>, { ok: true }> | null; /** Recorded extra payments moved to match their changed Actual transaction on this refresh. */ followedExtraPayments: FollowedExtraPayment[]; /** Payments into the loan counted as extra payments on this refresh. */ recordedExtraPayments?: string[] }
  | { ok: false; notFound: true }
  | { ok: false; blocked: { code: string; message: string } };

export function postingView(record: FinancialPostingRecord, reused?: boolean): PostingView {
  const { inputSnapshotJson, outputSnapshotJson, ...rest } = record;
  return { ...rest, output: JSON.parse(outputSnapshotJson) as PostingOutputSnapshot, basis: basisOf(inputSnapshotJson), ...(reused === undefined ? {} : { reused }) };
}

const known = (value: unknown): value is string => typeof value === "string";

export function summarize(record: FinancialPostingRecord): ExistingPostingSummary {
  return {
    id: record.id,
    postingKind: known(record.postingKind) ? record.postingKind : record.postingKind.unknown,
    periodKey: record.periodKey,
    status: known(record.status) ? record.status : record.status.unknown,
    generation: record.generation,
    outputSnapshot: JSON.parse(record.outputSnapshotJson) as PostingOutputSnapshot,
    actualIds: record.actualIds,
    ...(record.error?.cause === "changed-in-actual" ? { changedInActual: String(record.error.detail ?? "it was changed in Actual") } : {}),
  };
}

export { openingFor } from "./opening";

/** The offset steps the projection consumes: the last point at or before the opening, then every later point to the window end. */
export function offsetSteps(histories: readonly OffsetHistorySnapshot[] | undefined, openingDate: string, to: string): PlanningContext["offsets"] {
  return (histories ?? []).map((h) => {
    const sorted = [...h.points].sort((a, b) => a.date.localeCompare(b.date)).filter((p) => p.date <= to);
    const before = sorted.filter((p) => p.date <= openingDate).at(-1);
    const after = sorted.filter((p) => p.date > openingDate);
    return { accountId: h.accountId, asOfDate: h.asOfDate <= to ? h.asOfDate : to, steps: [...(before ? [before] : []), ...after] };
  });
}

function enabledRules(db: SqliteDatabase, debtId: string): PlanningContext["rules"] {
  const rules: PlanningContext["rules"] = {};
  for (const record of listDebtMatchRules(db, debtId)) {
    if (!record.enabled || !known(record.purpose)) continue;
    if (rules[record.purpose]) continue;
    try {
      rules[record.purpose] = parseStoredMatchRule(record).conditions as MatchConditionsV1;
    } catch {
      // An unreadable rule is not used; the loan's Repayment matching tab already shows it as Blocked.
    }
  }
  return rules;
}

function planningDebt(debt: DebtRecord): PlanningContext["debt"] {
  return {
    id: debt.id,
    budgetSyncId: debt.budgetSyncId,
    name: debt.name,
    liabilityAccountId: debt.liabilityAccountId,
    paymentAccountId: debt.paymentAccountId,
    signConvention: debt.signConvention === "positive-is-debt" ? "positive-is-debt" : "negative-is-debt",
    lenderPattern: debt.lenderPattern === "embedded-interest" || debt.lenderPattern === "separate-interest" ? debt.lenderPattern : null,
    executionStrategy: known(debt.executionStrategy) ? debt.executionStrategy : "unknown",
    loanPaymentCategoryId: debt.loanPaymentCategoryId,
    lenderChargeGraceDays: debt.lenderChargeGraceDays,
    driftToleranceMinor: debt.driftToleranceMinor,
    currentRevision: debt.currentRevision,
    onboardingDate: debt.onboardingDate,
  };
}

/** Build the planning context; also used for reversal proposals. */
export function buildPlanningContext(
  db: SqliteDatabase,
  debtId: string,
  request: Pick<PreviewRequest, "from" | "to" | "today" | "accountDirectory" | "transferPayees" | "capabilities" | "offsetHistories"> & Partial<PreviewRequest>,
  loadedDetail?: DebtDetail,
  reconcile: typeof reconcileDebt = reconcileDebt
): { ok: true; ctx: PlanningContext } | { ok: false; notFound: true } | { ok: false; blocked: { code: string; message: string } } {
  const detail = loadedDetail ?? getDebtDetail(db, debtId);
  if (!detail) return { ok: false, notFound: true };
  const built = modelFromDetail(detail);
  if (!built.ok) return { ok: false, blocked: built.blocked };
  const { debt } = detail;
  if (built.model.offsets.filter((offset) => offset.useActualBalance).some((offset) => !request.offsetHistories?.some((history) => history.accountId === offset.accountId))) {
    return { ok: false, blocked: { code: "invalid-config", message: "Actual-linked offset history is required for this preview; the manual starting balance was not used as a fallback." } };
  }
  if (request.accountDirectory.budgetSyncId !== debt.budgetSyncId) {
    throw new AppDbValidationError("The Actual read belongs to a different budget than this debt");
  }
  const revision = getLatestModelRevision(db, "debt", debtId);
  const config = detail.config.ok ? detail.config.config : null;
  const opening = openingFor(db, debtId, built.model);
  const snapshots = request.snapshots ?? [];
  const postingLinked = new Set(
    // Rows a posting wrote or claimed, and payments the user recorded as extra payments, are never matched again.
    listDebtTransactionLinks(db, debtId).filter((l) => l.linkSource === "posting" || l.role === "extra-repayment").map((l) => l.actualTransactionId)
  );
  let driftMaterial = false;
  let reconciliation: PlanningContext["parameters"]["reconciliation"] = null;
  if (request.comparison) {
    const rec = reconcile(db, { debtId, comparisonDate: request.comparison.comparisonDate, actualBalanceMinor: request.comparison.actualBalanceMinor, offsetHistories: request.offsetHistories, loanAccountRows: request.loanAccountRows });
    if (rec.ok) {
      driftMaterial = rec.drift === "material";
      const obs = rec.lenderObservation;
      if (obs && rec.comparison.actualVsLenderMinor !== null && rec.comparison.actualVsLenderMinor !== 0) {
        reconciliation = {
          comparisonDate: obs.observedOn,
          // Actual on the statement's date, not today (what was paid since is not in the statement).
          actualMagnitudeMinor: rec.comparison.lenderAsOf?.actualMinor ?? request.comparison.actualBalanceMinor,
          observation: {
            id: obs.id, principalMinor: obs.principalMinor, accruedInterestMinor: obs.accruedInterestMinor,
            canonicalHash: canonicalHash({ id: obs.id, observedOn: obs.observedOn, principalMinor: obs.principalMinor, accruedInterestMinor: obs.accruedInterestMinor, source: obs.source, supersedesObservationId: obs.supersedesObservationId }),
          },
        };
      }
    }
  }
  return {
    ok: true,
    ctx: {
      debt: planningDebt(debt),
      configHash: revision?.configHash ?? "",
      model: built.model,
      components: (config?.components ?? []) as ComponentConfig[],
      accounts: request.accountDirectory.accounts,
      transferPayeeByAccount: request.transferPayees,
      opening,
      offsets: offsetSteps(request.offsetHistories, opening.date, request.to),
      window: { from: request.from, to: request.to },
      today: request.today ?? new Date().toISOString().slice(0, 10),
      driftMaterial,
      candidates: matchingCandidates(snapshots, postingLinked),
      rows: indexReadRows(snapshots.flatMap((s) => s.transactions)),
      rules: enabledRules(db, debtId),
      repaymentChoices: repaymentChoices(db, debtId),
      postings: listSubjectPostings(db, "debt", debtId).map(summarize),
      canVerifyTransferLinks: request.capabilities.canVerifyTransferLinks,
      canRestructure: request.capabilities.canRestructure,
      parameters: { ...(request.parameters ?? {}), reconciliation },
    },
  };
}

/** Preview: plan, record proposals, return them. Writes app-DB proposals only. */
export function previewDebtPostings(db: SqliteDatabase, debtId: string, request: PreviewRequest, now = new Date().toISOString(), pass = 1): PreviewResult {
  if (request.from > request.to) throw new AppDbValidationError("The preview start date must not be after its end date");
  for (const snapshot of request.snapshots) {
    if (snapshot.transactions.length > 5_000) throw new AppDbValidationError("A preview read exceeds the 5,000 transaction per-account limit");
  }
  const debt = getDebt(db, debtId);
  if (!debt) return { ok: false, notFound: true };
  if (debt.budgetSyncId !== request.accountDirectory.budgetSyncId) throw new AppDbValidationError("Connect to this loan’s budget before refreshing.");
  if (debt.status === "archived") throw new AppDbValidationError("Archived loans are read-only.");
  const initialDetail = getDebtDetail(db, debtId)!;
  if (initialDetail.blocked) return { ok: false, blocked: initialDetail.blocked };
  if (initialDetail.offsets.filter((offset) => offset.useActualBalance).some((offset) => !request.offsetHistories?.some((history) => history.accountId === offset.actualAccountId))) return { ok: false, blocked: { code: "invalid-config", message: "Read all Actual-linked offset histories before refreshing this loan." } };
  if (listSubjectPostings(db, "debt", debtId).some((posting) => hasPostingLease(db, posting.id, now))) throw new AppDbValidationError("Wait for the running loan operation to finish before refreshing.");
  // Applied changes follow Actual first (owner decision 2026-10-07): any that Actual no longer holds
  // stop counting, so the periods are planned again from what Actual has now.
  const readRows = indexReadRows(request.snapshots.flatMap((s) => s.transactions));
  const missing = new Set(request.verifiedMissingIds ?? []);
  const changedInActual = releaseChangedInActual(db, debtId, readRows, (_accountId, _date, id) => !!id && missing.has(id), now, request.transferPayees);
  // A stale applied repayment must not retire a failure before its Actual binding is checked.
  closeSettledFailures(db, debtId, now);
  // Linked extra payments follow their Actual transaction first, so planning sees the loan as it now is.
  const followedExtraPayments = request.followExtraPayments === false ? [] : followRecordedExtraPayments(db, debtId, readRows, request.loanAccountRows ?? null);
  const loadedDetail = followedExtraPayments.length || changedInActual.length ? getDebtDetail(db, debtId) ?? undefined : initialDetail;
  // A refresh-local cache, discarded after this planning pass. Mutations above precede its creation.
  const comparisons = new Map<string, ReturnType<typeof reconcileDebt>>();
  const reconcile: typeof reconcileDebt = (database, input) => {
    // Optional service inputs may be undefined; canonical JSON requires explicit absence. Normalize
    // only the cache key, preserving the service's distinction between missing and supplied history.
    const key = canonicalHash({
      ...input,
      offsetHistories: input.offsetHistories ?? null,
      observed: input.observed ?? null,
      loanAccountRows: input.loanAccountRows ?? null,
    });
    const existing = comparisons.get(key);
    if (existing) return existing;
    const result = reconcileDebt(database, input, loadedDetail);
    comparisons.set(key, result);
    return result;
  };
  const built = buildPlanningContext(db, debtId, request, loadedDetail, reconcile);
  if (!built.ok) return built;
  let { ctx } = built;
  const planAll = (c: PlanningContext) => [c.debt.lenderPattern === "separate-interest" ? planPatternB(c) : c.debt.lenderPattern === "embedded-interest" ? planPatternA(c) : { postings: [], notices: [{ code: "no-lender-pattern", periodKey: c.window.from, text: "Choose how your lender shows interest in Link to Actual so Bench knows how this loan is recorded." }] }, planAdjustments(c)];
  let plans = planAll(ctx);
  // FR-170c: a gap that the pending changes themselves close is not unexplained drift. Compare
  // again as if every non-blocked change were applied; only if that is within tolerance is the
  // drift treated as explained, and the changes are classified without it.
  let driftExplained = false;
  if (ctx.driftMaterial && request.comparison && ctx.debt.liabilityAccountId) {
    const liability = ctx.debt.liabilityAccountId;
    const effect = plans.flatMap((p) => p.postings).filter((p) => p.classification !== "blocked" && !p.reversalOf && p.postingKind !== "reversal").reduce((sum, p) => sum + liabilityEffectMinor(p.outputSnapshot, liability), 0);
    if (effect !== 0) {
      const adjusted = request.comparison.actualBalanceMinor + (ctx.debt.signConvention === "negative-is-debt" ? -effect : effect);
      const again = reconcile(db, { debtId, comparisonDate: request.comparison.comparisonDate, actualBalanceMinor: adjusted, offsetHistories: request.offsetHistories, loanAccountRows: request.loanAccountRows });
      if (again.ok && again.drift !== "material") {
        driftExplained = true;
        ctx = { ...ctx, driftMaterial: false };
        plans = planAll(ctx);
      }
    }
  }
  pruneSupersededProposals(db, new Date(now));
  const postings: PostingView[] = [];
  for (const plan of plans) {
    for (const planned of plan.postings) {
      const result = upsertProposal(db, {
        budgetSyncId: ctx.debt.budgetSyncId,
        subjectKind: "debt",
        subjectId: ctx.debt.id,
        postingKind: planned.postingKind,
        periodKey: planned.periodKey,
        generation: planned.generation,
        configRevision: ctx.debt.currentRevision,
        inputFormatVersion: POSTING_INPUT_FORMAT_VERSION,
        inputSnapshot: planned.inputSnapshot,
        engineVersions: planned.engineVersions,
        outputSnapshot: planned.outputSnapshot,
        classification: planned.classification,
        reasons: planned.reasons,
        idempotencyMarker: planned.marker,
        reversalOf: planned.reversalOf ?? null,
      }, now);
      postings.push(postingView(result.posting, result.reused));
    }
  }
  supersedeStaleProposals(db, { subjectKind: "debt", subjectId: ctx.debt.id, keepIds: postings.map((p) => p.id), configRevision: ctx.debt.currentRevision, window: ctx.window }, now);
  const detail = loadedDetail;
  const unscheduled = detail ? unscheduledPayments(db, detail, ctx.rows, ctx.window, { lenderFeed: !!ctx.rules["lender-repayment-row"], offsetParts: new Set(repaymentAlignment(ctx).offsetParts.map((p) => p.id)) }) : [];
  const splitCounterparts = detail ? splitRepaymentCounterparts(detail, ctx.rows) : new Set<string>();
  const pendingExtraCorrections: PlanningNotice[] = listDebtTransactionLinks(db, debtId)
    .filter((link) => link.role === "extra-repayment" && splitCounterparts.has(link.actualTransactionId))
    .map((link) => ({ code: "split-extra-correction-pending", periodKey: link.periodKey ?? ctx.window.from,
      text: request.followExtraPayments === false
        ? "A principal transfer is part of a repayment split but still has an extra-payment entry. Save or discard your Terms & Schedule edits, then refresh to correct it."
        : "A principal transfer is part of a repayment split but its extra-payment entry could not be corrected safely. Review the recorded extra-payment events in Terms & Schedule before refreshing." }));
  const extraLinks = listDebtTransactionLinks(db, debtId).filter((link) => link.role === "extra-repayment");
  for (const link of extraLinks) {
    if (splitCounterparts.has(link.actualTransactionId)) continue;
    const generated = loadedDetail?.assumptions.filter((a) => a.assumptionKind === "extra-repayment" && a.effectiveFrom === link.periodKey && a.note === "Extra payment recorded from Actual" && a.recurrence === null) ?? [];
    if (generated.length > 1 || (generated.length && extraLinks.filter((other) => other.periodKey === link.periodKey).length > 1)) {
      pendingExtraCorrections.push({ code: "extra-follow-review", periodKey: link.periodKey ?? ctx.window.from, text: "Several recorded extra payments share this date. Bench retained the saved assumptions because their ownership is ambiguous. Review the events in Terms & Schedule." });
    }
  }
  // What Actual already shows is recorded on its own (owner decision 2026-10-07): a split already in
  // Actual that matches the calculation, or a repayment already a full transfer to the loan, is a
  // claim that writes nothing to Actual; recording it is bookkeeping, so it shows as done at once.
  // Anything needing a look (Review) still waits for the user.
  if (pass === 1) {
    let claimed = 0;
    for (const posting of postings) {
      const output = posting.output;
      if (String(posting.status) !== "proposed" || posting.classification !== "safe" || output.kind !== "claim" || output.release || !["repayment-split", "repayment-link"].includes(String(posting.postingKind))) continue;
      const fresh = rowsToCheck(output).map((r) => readRows.get(r.id)).filter((r): r is RowSnapshot => !!r);
      try {
        approveAndRecordClaim(db, posting.id, { fresh, now });
        claimed++;
      } catch {
        // Left for the user: the row shows why when they apply it.
      }
    }
    if (claimed) {
      const again = previewDebtPostings(db, debtId, request, now, 2);
      return again.ok ? { ...again, changedInActual: [...changedInActual, ...again.changedInActual], followedExtraPayments: [...followedExtraPayments, ...again.followedExtraPayments] } : again;
    }
  }
  // Newly discovered extras remain suggestions until the user confirms them.
  const alignment = repaymentAlignment(ctx);
  const paymentOptions: PaymentOption[] = alignment.payments.map((p) => {
    const row = ctx.rows.get(p.id);
    return { id: p.id, date: p.date, amountMinor: p.amountMinor, payeeName: row?.payeeName ?? null, notes: row?.notes ?? null, pairedTo: alignment.pairedTo(p.id) };
  });
  // The status figures come back with the plan: one call per refresh.
  const observed = plans.map((p) => p.observed).find((o) => !!o) ?? null;
  const reconciled = request.comparison ? reconcile(db, { debtId, comparisonDate: request.comparison.comparisonDate, actualBalanceMinor: request.comparison.actualBalanceMinor, offsetHistories: request.offsetHistories, observed, loanAccountRows: request.loanAccountRows }) : null;
  return {
    ok: true, postings, notices: [...plans.flatMap((p) => p.notices), ...pendingExtraCorrections], driftMaterial: built.ctx.driftMaterial, driftExplained, unscheduled, followedExtraPayments, paymentOptions,
    repaymentChoices: ctx.repaymentChoices ?? [], changedInActual, reconciliation: reconciled && reconciled.ok ? reconciled : null,
  };
}

/** A payment the user can name as a due date's repayment, and the due date it is paired with now. */
export type PaymentOption = { id: string; date: string; amountMinor: number; payeeName: string | null; notes: string | null; pairedTo: string | null };

export function listDebtPostings(db: SqliteDatabase, debtId: string): PostingView[] {
  recoverAbandonedPostings(db, debtId);
  return listSubjectPostings(db, "debt", debtId).map((record) => ({ ...postingView(record), executionActive: hasPostingLease(db, record.id) }));
}
