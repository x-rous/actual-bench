import type { PostingReason } from "@/lib/app-db/types";
import { chargeCategory, openingAdjustmentCategory } from "../../actual/representation";
import { REASONS } from "../../classification/policy";
import { buildPostingMarker } from "../../markers";
import { POSTING_OUTPUT_FORMAT, POSTING_OUTPUT_FORMAT_VERSION, type CreateOperation, type PostingOutputSnapshot, type RowSnapshot } from "../snapshot";
import {
  baseBlockers,
  budgetStatusOf,
  component,
  eventsOn,
  finalize,
  generationFor,
  inputSnapshot,
  ledgerIncrease,
  livePosting,
  markerFor,
  usableAccount,
  type ExistingPostingSummary,
  type PlannedPosting,
  type PlanResult,
  type PlanningContext,
} from "./common";
import { eventsInWindow } from "./patternB";

/**
 * Adjustments, capitalized fees and compensating reversals (RD-084 P1.6
 * T120/T132; FR-064, FR-057, FR-092, FR-184).
 *
 * - The opening adjustment brings the Actual liability to the onboarding
 *   anchor: liability account only, uncategorized off-budget, and on-budget
 *   only with a category the user chose (Blocked without one). Always Review.
 * - A reconciliation adjustment brings it to the latest lender observation.
 *   Always Review, never Safe (owner decision D1).
 * - A capitalized fee is a charge in the liability, like interest.
 * - A reversal negates an applied posting's rows under its own marker. Undo
 *   only creates the proposal; the user applies it like any other.
 */

export function planAdjustments(ctx: PlanningContext): PlanResult {
  const out: PlanResult = { postings: [], notices: [] };
  const opening = planOpeningAdjustment(ctx);
  if (opening) out.postings.push(opening);
  const reconciliation = planReconciliationAdjustment(ctx);
  if (reconciliation) out.postings.push(reconciliation);
  out.postings.push(...planFeeCharges(ctx));
  return out;
}

function adjustmentPosting(
  ctx: PlanningContext,
  input: {
    postingKind: "opening-adjustment" | "reconciliation-adjustment";
    date: string;
    differenceMagnitude: number;
    category: ReturnType<typeof chargeCategory>;
    notes: string;
    parameters: Record<string, string | number | boolean | null>;
    observation?: { kind: "debt"; id: string; canonicalHash: string };
  }
): PlannedPosting | null {
  if (input.differenceMagnitude === 0 || livePosting(ctx, input.postingKind, input.date)) return null;
  const generation = generationFor(ctx, input.postingKind, input.date);
  const marker = markerFor(ctx, input.postingKind, input.date, generation);
  const blockers: PostingReason[] = [...baseBlockers(ctx), ...(input.category.ok ? [] : [{ code: input.category.code, text: input.category.text }])];
  const operation: CreateOperation = {
    accountId: ctx.debt.liabilityAccountId ?? "", date: input.date, amountMinor: ledgerIncrease(ctx, input.differenceMagnitude),
    payeeId: null, transferAccountId: null, categoryId: input.category.ok ? input.category.categoryId : null,
    notes: input.notes, cleared: false, importedId: marker, economicKind: "adjustment",
  };
  return finalize(ctx, {
    postingKind: input.postingKind, periodKey: input.date, shape: "create", generation, marker,
    inputSnapshot: inputSnapshot(ctx, { key: input.date, from: input.date, to: input.date, chargeDates: [] }, [], input.parameters, input.observation),
    outputSnapshot: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "create",
      operations: [operation],
      accountBudgetStatus: budgetStatusOf(ctx, [ctx.debt.liabilityAccountId]),
      components: [{ kind: "adjustment", amountMinor: input.differenceMagnitude }],
      closing: null,
    },
    engineVersions: {},
    policy: { blockers },
  });
}

/** FR-064: Actual liability → onboarding anchor, on the onboarding date. */
export function planOpeningAdjustment(ctx: PlanningContext): PlannedPosting | null {
  const actual = ctx.parameters.actualBalanceAtOnboardingMinor;
  if (!ctx.debt.onboardingDate || actual === undefined || actual === null || ctx.opening.source.kind !== "anchor") return null;
  if (ctx.opening.date !== ctx.debt.onboardingDate) return null;
  const liability = usableAccount(ctx, ctx.debt.liabilityAccountId);
  const actualMagnitude = actual;
  const anchorMagnitude = ctx.opening.principalMinor + ctx.opening.accruedInterestMinor;
  const categoryId = ctx.parameters.openingAdjustmentCategoryId ?? null;
  return adjustmentPosting(ctx, {
    postingKind: "opening-adjustment",
    date: ctx.debt.onboardingDate,
    differenceMagnitude: anchorMagnitude - actualMagnitude,
    category: liability ? openingAdjustmentCategory(liability, categoryId) : { ok: true, categoryId: null },
    notes: "Opening adjustment",
    parameters: { actualMagnitudeMinor: actual, openingAdjustmentCategoryId: categoryId },
  });
}

/** FR-092: Actual liability → the lender observation at its date. Always Review (D1). */
export function planReconciliationAdjustment(ctx: PlanningContext): PlannedPosting | null {
  const rec = ctx.parameters.reconciliation;
  if (!rec) return null;
  const liability = usableAccount(ctx, ctx.debt.liabilityAccountId);
  const actualMagnitude = rec.actualMagnitudeMinor;
  const lenderMagnitude = rec.observation.principalMinor + (rec.observation.accruedInterestMinor ?? 0);
  const categoryId = ctx.parameters.adjustmentCategoryId ?? null;
  // "Not now" sticks (owner decision 2026-10-07): the same difference against the same statement is
  // not proposed again; a new statement or a different amount is.
  const difference = lenderMagnitude - actualMagnitude;
  const declined = ctx.postings.some((p) => p.postingKind === "reconciliation-adjustment" && p.periodKey === rec.comparisonDate && p.status === "declined"
    && p.outputSnapshot.kind === "create" && p.outputSnapshot.components[0]?.amountMinor === difference);
  if (declined) return null;
  return adjustmentPosting(ctx, {
    postingKind: "reconciliation-adjustment",
    date: rec.comparisonDate,
    differenceMagnitude: lenderMagnitude - actualMagnitude,
    category: liability ? chargeCategory(liability, categoryId, "reconciliation adjustment") : { ok: true, categoryId: null },
    notes: "Reconciliation adjustment",
    parameters: { actualMagnitudeMinor: rec.actualMagnitudeMinor, adjustmentCategoryId: categoryId },
    observation: { kind: "debt", id: rec.observation.id, canonicalHash: rec.observation.canonicalHash },
  });
}

/** FR-057: a capitalized fee is charged to the liability like interest. */
export function planFeeCharges(ctx: PlanningContext): PlannedPosting[] {
  const window = eventsInWindow(ctx);
  if ("error" in window) return [];
  const out: PlannedPosting[] = [];
  const liability = usableAccount(ctx, ctx.debt.liabilityAccountId);
  for (const date of window.feeDates) {
    const calc = eventsOn(ctx, date);
    if ("error" in calc) continue;
    const fee = calc.events.find((e) => e.eventType === "fee" && e.principalMovementMinor > 0 && e.cashMovementMinor === 0);
    if (!fee || livePosting(ctx, "fee-charge", date)) continue;
    const amount = Math.abs(fee.feesMinor) || fee.principalMovementMinor;
    const generation = generationFor(ctx, "fee-charge", date);
    const marker = markerFor(ctx, "fee-charge", date, generation);
    const feeComponent = [...ctx.components].find((c) => c.economicKind === "fee" && c.treatment === "capitalized") ?? component(ctx, "fee");
    const category = liability ? chargeCategory(liability, feeComponent?.categoryId ?? null, "fee") : { ok: true as const, categoryId: null };
    out.push(finalize(ctx, {
      postingKind: "fee-charge", periodKey: date, shape: "create", generation, marker,
      inputSnapshot: inputSnapshot(ctx, { key: date, from: date, to: date, chargeDates: [date] }, []),
      outputSnapshot: {
        format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "create",
        operations: [{
          accountId: ctx.debt.liabilityAccountId ?? "", date, amountMinor: ledgerIncrease(ctx, amount), payeeId: null, transferAccountId: null,
          categoryId: category.ok ? category.categoryId : null, notes: feeComponent?.label ?? "Fee", cleared: false, importedId: marker, economicKind: "fee",
        }],
        accountBudgetStatus: budgetStatusOf(ctx, [ctx.debt.liabilityAccountId]),
        components: [{ kind: "fee", amountMinor: amount }],
        closing: calc.closing,
      },
      engineVersions: calc.versions,
      policy: { blockers: [...baseBlockers(ctx), ...(category.ok ? [] : [{ code: category.code, text: category.text }])] },
    }));
  }
  return out;
}

/**
 * "Unsplit" a repayment already split in Actual that Bench recorded (owner decision 2026-10-07): the
 * split lines are deleted and the payment becomes one transfer to the loan, so Actual makes the
 * loan-side row for the whole amount; Bench then proposes the split again. Works from the split as
 * Actual holds it now; a Review proposal the user applies.
 */
export function planUnsplit(ctx: PlanningContext, original: ExistingPostingSummary): PlannedPosting {
  const output = original.outputSnapshot;
  if (output.kind !== "claim" || !output.recordedSplit) throw new Error("Only a split already in Actual can be unsplit here");
  const head = { format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION } as const;
  const liabilityId = ctx.debt.liabilityAccountId ?? "";
  const { parent: before, children } = output.recordedSplit;
  const parent: RowSnapshot = { ...before, isParent: true, childCount: children.length };
  const toLoan = ctx.transferPayeeByAccount[liabilityId] ?? null;
  const back = ctx.transferPayeeByAccount[before.accountId] ?? null;
  const blockers: PostingReason[] = [];
  if (!ctx.canRestructure) blockers.push({ code: "restore-unavailable", text: "This connection cannot change existing transactions. Use a supported Actual Bench connection." });
  if (!toLoan || !back) blockers.push(REASONS.missingAccount);
  if (before.reconciled) blockers.push(REASONS.reconciledRow);
  const sameStatus = budgetStatus(ctx, before.accountId) === budgetStatus(ctx, liabilityId);
  const restoreTo: RowSnapshot = { ...before, isParent: false, childCount: 0, payeeId: toLoan, categoryId: sameStatus ? null : ctx.debt.loanPaymentCategoryId, transferId: null };
  const recreated: RowSnapshot = {
    id: "", accountId: liabilityId, date: before.date, amountMinor: -before.amountMinor, payeeId: back, payeeName: null, categoryId: null, notes: before.notes,
    cleared: false, reconciled: false, importedId: null, importedPayee: null, transferId: before.id, isParent: false, isChild: false, parentId: null, childCount: 0,
  };
  const period = { key: original.id, from: ctx.today, to: ctx.today, chargeDates: [] as string[] };
  return finalize(ctx, {
    postingKind: "reversal", periodKey: original.id, generation: 1, reversalOf: original.id, engineVersions: {}, shape: "restructure", marker: null,
    inputSnapshot: inputSnapshot(ctx, period, [parent, ...children], { reversalOf: original.id }),
    outputSnapshot: { ...head, kind: "restore-split", parent, children, counterpartAccountIds: [liabilityId], restoreTo, recreatedCounterpart: recreated, closing: null },
    policy: { blockers, reviews: [{ code: "unsplit", text: "Puts the payment back as one transfer to the loan for the whole amount; Bench then proposes the split again." }] },
  });
}

/**
 * A compensating reversal proposal for an applied posting (FR-184, T132, T276,
 * T277). Creates: the same rows negated, under the reversal's own marker
 * (`…:reversal:<postingId>:g1`). Claims: release the Bench link (no Actual
 * write). Restructures, counterpart links and conversions restore the original
 * rows exactly, by the sequences proven on a live server (see
 * `src/lib/actual/transactionStructure.ts`). Every reversal is a Review
 * proposal the user applies explicitly.
 */
export function planReversal(ctx: PlanningContext, original: ExistingPostingSummary, extraReasons: PostingReason[] = []): PlannedPosting {
  const periodKey = original.id;
  const generation = 1;
  const output = original.outputSnapshot;
  const period = { key: periodKey, from: ctx.today, to: ctx.today, chargeDates: [] as string[] };
  const common = { postingKind: "reversal" as const, periodKey, generation, reversalOf: original.id, engineVersions: {} };
  if (output.kind === "create") {
    const marker = buildPostingMarker({ budgetSyncId: ctx.debt.budgetSyncId, subjectId: ctx.debt.id, postingKind: "reversal", periodKey, generation });
    const operations = output.operations.map((op, index) => ({
      ...op,
      amountMinor: -op.amountMinor,
      notes: `Reversal: ${op.notes}`,
      importedId: output.operations.length > 1 ? `${marker}:${index}` : marker,
    }));
    return finalize(ctx, {
      ...common, shape: "create", marker,
      inputSnapshot: inputSnapshot(ctx, period, [], { reversalOf: original.id }),
      outputSnapshot: { ...output, operations, components: output.components.map((c) => ({ ...c })) },
      policy: { reviews: extraReasons },
    });
  }
  if (output.kind === "claim") {
    return finalize(ctx, {
      ...common, shape: "claim", marker: null,
      inputSnapshot: inputSnapshot(ctx, period, output.rows, { reversalOf: original.id }),
      outputSnapshot: { ...output, release: { postingId: original.id } },
      policy: { reviews: extraReasons },
    });
  }
  const ids = original.actualIds ?? [];
  const blockers: PostingReason[] = [];
  if (!ctx.canRestructure) blockers.push({ code: "restore-unavailable", text: "This connection cannot change existing transactions. Use a supported Actual Bench connection." });
  const head = { format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION } as const;
  if (output.kind === "restructure") {
    const children = appliedChildren(ctx, output, ids);
    // Pattern A with a lender feed: the principal line is linked to the lender's row; that link goes first.
    const linked = ctx.postings.some((p) => p.status === "applied" && p.outputSnapshot.kind === "link" && children.some((c) => c.id === (p.outputSnapshot as { sourceBefore: RowSnapshot }).sourceBefore.id));
    if (linked) blockers.push(REASONS.undoLinkFirst);
    if (ids.length === 0) blockers.push({ code: "applied-ids-missing", text: "Bench has no record of the rows this split wrote. Restore the transaction in Actual using the before state shown here." });
    const parent: RowSnapshot = { ...output.before, categoryId: null, transferId: null, isParent: true, childCount: children.length };
    const restoreOutput: PostingOutputSnapshot = {
      ...head, kind: "restore-split", parent, children,
      counterpartAccountIds: [...new Set(output.expectedPostState.children.map((c) => c.transferAccountId).filter((id): id is string => id !== null))],
      restoreTo: output.before,
      recreatedCounterpart: output.replacesCounterpart ?? null,
      closing: null,
    };
    return finalize(ctx, {
      ...common, shape: "restructure", marker: null,
      inputSnapshot: inputSnapshot(ctx, period, [parent, ...children], { reversalOf: original.id }),
      outputSnapshot: restoreOutput,
      policy: { blockers, reviews: [...extraReasons, ...(output.replacesCounterpart ? [{ code: "recreates-counterpart", text: "Undoing the split makes the payment a full transfer again; Actual re-creates the loan-side row with a new id." }] : [])] },
    });
  }
  if (output.kind === "link") {
    const { sourceBefore, counterpartBefore } = output;
    const sameStatus = budgetStatus(ctx, sourceBefore.accountId) === budgetStatus(ctx, counterpartBefore.accountId);
    const source: RowSnapshot = { ...sourceBefore, payeeId: output.transferPayeeId, notes: counterpartBefore.notes, transferId: counterpartBefore.id, categoryId: sameStatus ? null : sourceBefore.categoryId };
    const counterpart: RowSnapshot = {
      ...counterpartBefore, payeeId: ctx.transferPayeeByAccount[sourceBefore.accountId] ?? null, notes: counterpartBefore.notes,
      amountMinor: output.expectedPairState.counterpartAmountMinor, transferId: sourceBefore.id, categoryId: sameStatus ? null : counterpartBefore.categoryId,
    };
    return finalize(ctx, {
      ...common, shape: "link", marker: null,
      inputSnapshot: inputSnapshot(ctx, period, [source, counterpart], { reversalOf: original.id }),
      outputSnapshot: { ...head, kind: "unlink", source, counterpart, sourceRestore: sourceBefore, counterpartRestore: counterpartBefore, closing: null },
      policy: { blockers, reviews: extraReasons },
    });
  }
  if (output.kind === "convert") {
    const payment = output.before;
    const counterpartId = ids[1] ?? null;
    if (!counterpartId) blockers.push({ code: "applied-ids-missing", text: "Bench has no record of the loan-side row Actual made. Change the payment's payee back in Actual." });
    const sameStatus = budgetStatus(ctx, payment.accountId) === budgetStatus(ctx, output.transferAccountId);
    const converted: RowSnapshot = { ...payment, payeeId: output.transferPayeeId, transferId: counterpartId, categoryId: sameStatus ? null : payment.categoryId };
    const counterpart: RowSnapshot = {
      id: counterpartId ?? "", accountId: output.transferAccountId, date: payment.date, amountMinor: -payment.amountMinor,
      payeeId: ctx.transferPayeeByAccount[payment.accountId] ?? null, payeeName: null, categoryId: null, notes: payment.notes,
      cleared: false, reconciled: false, importedId: null, importedPayee: null, transferId: payment.id,
      isParent: false, isChild: false, parentId: null, childCount: 0,
    };
    return finalize(ctx, {
      ...common, shape: "convert", marker: null,
      inputSnapshot: inputSnapshot(ctx, period, [converted, counterpart], { reversalOf: original.id }),
      outputSnapshot: { ...head, kind: "revert-convert", converted, counterpart, restoreTo: payment, closing: null },
      policy: { blockers, reviews: extraReasons },
    });
  }
  if (output.kind === "adjust-split") {
    // T314: the same change back. The split as Bench left it, then every line's earlier amount.
    const amount = new Map(output.amounts.map((a) => [a.id, a.amountMinor]));
    const children = output.children.map((c) => ({ ...c, amountMinor: amount.get(c.id) ?? c.amountMinor }));
    const transferChild = output.counterpart ? children.find((c) => c.transferId === output.counterpart!.id) : undefined;
    const counterpart = output.counterpart && transferChild ? { ...output.counterpart, amountMinor: -transferChild.amountMinor } : output.counterpart;
    const before = output.children;
    const principalMinor = transferChild ? Math.abs(before.find((c) => c.id === transferChild.id)!.amountMinor) : 0;
    return finalize(ctx, {
      ...common, shape: "adjust", marker: null,
      inputSnapshot: inputSnapshot(ctx, period, [output.parent, ...children, ...(counterpart ? [counterpart] : [])], { reversalOf: original.id }),
      outputSnapshot: {
        ...head, kind: "adjust-split", parent: output.parent, children, counterpart,
        amounts: before.map((c) => ({ id: c.id, amountMinor: c.amountMinor })),
        recordedSplit: { ...output.recordedSplit, children: before, principalMinor, interestMinor: Math.abs(output.parent.amountMinor) - principalMinor },
        edit: null,
        closing: null,
      },
      policy: { blockers, reviews: extraReasons },
    });
  }
  // An Undo is never reversed again; a new correction is planned instead.
  return finalize(ctx, {
    ...common, shape: "restructure", marker: null,
    inputSnapshot: inputSnapshot(ctx, period, [], { reversalOf: original.id }),
    outputSnapshot: output,
    policy: { blockers: [{ code: "undo-not-reversible", text: "An undo is not undone again. Preview the period again to propose a new change." }] },
  });
}

function budgetStatus(ctx: PlanningContext, accountId: string): "on-budget" | "off-budget" | null {
  const found = ctx.accounts.find((a) => a.id === accountId);
  return found ? (found.offBudget ? "off-budget" : "on-budget") : null;
}

/**
 * The split lines exactly as the applied restructure left them (verified at
 * apply): ids from `actualIds` (parent, children, then the counterparts of
 * transfer children, in order).
 */
function appliedChildren(ctx: PlanningContext, output: Extract<PostingOutputSnapshot, { kind: "restructure" }>, ids: string[]): RowSnapshot[] {
  const spec = output.expectedPostState.children;
  const counterpartIds = ids.slice(1 + spec.length);
  let nextCounterpart = 0;
  return spec.map((child, index) => ({
    id: ids[index + 1] ?? "",
    accountId: output.before.accountId,
    date: output.before.date,
    amountMinor: child.amountMinor,
    payeeId: child.transferAccountId ? ctx.transferPayeeByAccount[child.transferAccountId] ?? child.payeeId : child.payeeId,
    payeeName: null,
    categoryId: child.categoryId,
    notes: child.notes,
    cleared: output.before.cleared,
    reconciled: false,
    importedId: null,
    importedPayee: null,
    transferId: child.transferAccountId ? counterpartIds[nextCounterpart++] ?? null : null,
    isParent: false,
    isChild: true,
    parentId: output.before.id,
    childCount: 0,
  }));
}

export const ADJUSTMENT_REASONS = { opening: REASONS.openingAdjustment, reconciliation: REASONS.reconciliationAdjustment };
