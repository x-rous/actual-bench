import { canonicalHash } from "@/lib/app-db/canonicalJson";
import { openingFor } from "./opening";
import { listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { listSubjectPostings, pruneSupersededProposals, supersedeStaleProposals, upsertProposal } from "@/lib/app-db/financialPostingRepository";
import { getLatestModelRevision } from "@/lib/app-db/modelRevisionRepository";
import type { DebtRecord, FinancialPostingRecord, SqliteDatabase } from "@/lib/app-db/types";
import { parseStoredMatchRule, type MatchConditionsV1 } from "@/lib/financial-models/matching";
import type { AccountDirectory, MatchingHistorySnapshot } from "../actual/ledgerPort";
import { modelFromDetail } from "../model/buildModel";
import { matchingCandidates } from "./backtestService";
import { getDebtDetail } from "./debtConfigService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";
import { planAdjustments } from "./planner/adjustments";
import type { ExistingPostingSummary, PlanningContext, PlanningNotice, ComponentConfig } from "./planner/common";
import { planPatternA } from "./planner/patternA";
import { planPatternB } from "./planner/patternB";
import { followRecordedExtraPayments, unscheduledPayments, type FollowedExtraPayment, type UnscheduledPayment } from "./extraPaymentService";
import { liabilityEffectMinor } from "./pendingEffect";
import { reconcileDebt } from "./reconciliationService";
import { indexReadRows, POSTING_INPUT_FORMAT_VERSION, type PostingInputSnapshot, type PostingOutputSnapshot } from "./snapshot";

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
  | { ok: true; postings: PostingView[]; notices: PlanningNotice[]; driftMaterial: boolean; /** The pending changes close the gap (FR-170c). */ driftExplained: boolean; /** Payments into the loan account no repayment accounts for (extra payments). */ unscheduled: UnscheduledPayment[]; /** Recorded extra payments moved to match their changed Actual transaction on this refresh. */ followedExtraPayments: FollowedExtraPayment[] }
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
    currentRevision: debt.currentRevision,
    onboardingDate: debt.onboardingDate,
  };
}

/** Build the planning context; also used for reversal proposals. */
export function buildPlanningContext(
  db: SqliteDatabase,
  debtId: string,
  request: Pick<PreviewRequest, "from" | "to" | "today" | "accountDirectory" | "transferPayees" | "capabilities" | "offsetHistories"> & Partial<PreviewRequest>
): { ok: true; ctx: PlanningContext } | { ok: false; notFound: true } | { ok: false; blocked: { code: string; message: string } } {
  const detail = getDebtDetail(db, debtId);
  if (!detail) return { ok: false, notFound: true };
  const built = modelFromDetail(detail);
  if (!built.ok) return { ok: false, blocked: built.blocked };
  const { debt } = detail;
  if (built.model.offsets.some((offset) => offset.useActualBalance === true) && request.offsetHistories === undefined) {
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
    const rec = reconcileDebt(db, { debtId, comparisonDate: request.comparison.comparisonDate, actualBalanceMinor: request.comparison.actualBalanceMinor, offsetHistories: request.offsetHistories });
    if (rec.ok) {
      driftMaterial = rec.drift === "material";
      const obs = rec.lenderObservation;
      if (obs && rec.comparison.actualVsLenderMinor !== null && rec.comparison.actualVsLenderMinor !== 0) {
        reconciliation = {
          comparisonDate: obs.observedOn,
          actualMagnitudeMinor: request.comparison.actualBalanceMinor,
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
      postings: listSubjectPostings(db, "debt", debtId).map(summarize),
      canVerifyTransferLinks: request.capabilities.canVerifyTransferLinks,
      canRestructure: request.capabilities.canRestructure,
      parameters: { ...(request.parameters ?? {}), reconciliation },
    },
  };
}

/** Preview: plan, record proposals, return them. Writes app-DB proposals only. */
export function previewDebtPostings(db: SqliteDatabase, debtId: string, request: PreviewRequest, now = new Date().toISOString()): PreviewResult {
  if (request.from > request.to) throw new AppDbValidationError("The preview start date must not be after its end date");
  for (const snapshot of request.snapshots) {
    if (snapshot.transactions.length > 5_000) throw new AppDbValidationError("A preview read exceeds the 5,000 transaction per-account limit");
  }
  // Linked extra payments follow their Actual transaction first, so planning sees the loan as it now is.
  const followedExtraPayments = followRecordedExtraPayments(db, debtId, indexReadRows(request.snapshots.flatMap((s) => s.transactions)), request.loanAccountRows ?? null);
  const built = buildPlanningContext(db, debtId, request);
  if (!built.ok) return built;
  let { ctx } = built;
  const planAll = (c: PlanningContext) => [c.debt.lenderPattern === "separate-interest" ? planPatternB(c) : c.debt.lenderPattern === "embedded-interest" ? planPatternA(c) : { postings: [], notices: [{ code: "no-lender-pattern", periodKey: c.window.from, text: "Choose the lender pattern in Tracking setup so Bench knows how this loan is recorded." }] }, planAdjustments(c)];
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
      const again = reconcileDebt(db, { debtId, comparisonDate: request.comparison.comparisonDate, actualBalanceMinor: adjusted, offsetHistories: request.offsetHistories });
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
  const detail = getDebtDetail(db, debtId);
  const unscheduled = detail ? unscheduledPayments(db, detail, ctx.rows, ctx.window, { lenderFeed: !!ctx.rules["lender-repayment-row"] }) : [];
  return { ok: true, postings, notices: plans.flatMap((p) => p.notices), driftMaterial: built.ctx.driftMaterial, driftExplained, unscheduled, followedExtraPayments };
}

export function listDebtPostings(db: SqliteDatabase, debtId: string): PostingView[] {
  return listSubjectPostings(db, "debt", debtId).map((record) => postingView(record));
}
