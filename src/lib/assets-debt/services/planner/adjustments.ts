import type { PostingReason } from "@/lib/app-db/types";
import { chargeCategory, openingAdjustmentCategory } from "../../actual/representation";
import { REASONS } from "../../classification/policy";
import { buildPostingMarker } from "../../markers";
import { POSTING_OUTPUT_FORMAT, POSTING_OUTPUT_FORMAT_VERSION, type CreateOperation } from "../snapshot";
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
 * A compensating reversal proposal for an applied posting (FR-184, T132).
 * Creates: the same rows negated, under the reversal's own marker
 * (`…:reversal:<postingId>:g1`). Claims: release the Bench link (no Actual
 * write). Restructures and counterpart links cannot be undone automatically:
 * restoring a split is not verified against a live server, so the proposal is
 * Blocked with the next action instead of guessing.
 */
export function planReversal(ctx: PlanningContext, original: ExistingPostingSummary, extraReasons: PostingReason[] = []): PlannedPosting {
  const periodKey = original.id;
  const generation = 1;
  const output = original.outputSnapshot;
  const period = { key: periodKey, from: ctx.today, to: ctx.today, chargeDates: [] as string[] };
  if (output.kind === "create") {
    const marker = buildPostingMarker({ budgetSyncId: ctx.debt.budgetSyncId, subjectId: ctx.debt.id, postingKind: "reversal", periodKey, generation });
    const operations = output.operations.map((op, index) => ({
      ...op,
      amountMinor: -op.amountMinor,
      notes: `Reversal: ${op.notes}`,
      importedId: output.operations.length > 1 ? `${marker}:${index}` : marker,
    }));
    return finalize(ctx, {
      postingKind: "reversal", periodKey, shape: "create", generation, marker, reversalOf: original.id,
      inputSnapshot: inputSnapshot(ctx, period, [], { reversalOf: original.id }),
      outputSnapshot: { ...output, operations, components: output.components.map((c) => ({ ...c })) },
      engineVersions: {},
      policy: { reviews: extraReasons },
    });
  }
  if (output.kind === "claim") {
    return finalize(ctx, {
      postingKind: "reversal", periodKey, shape: "claim", generation, marker: null, reversalOf: original.id,
      inputSnapshot: inputSnapshot(ctx, period, output.rows, { reversalOf: original.id }),
      outputSnapshot: { ...output, release: { postingId: original.id } },
      engineVersions: {},
      policy: { reviews: extraReasons },
    });
  }
  return finalize(ctx, {
    postingKind: "reversal", periodKey, shape: output.kind === "link" ? "link" : "restructure", generation, marker: null, reversalOf: original.id,
    inputSnapshot: inputSnapshot(ctx, period, [], { reversalOf: original.id }),
    outputSnapshot: output,
    engineVersions: {},
    policy: {
      blockers: [{
        code: "manual-restore-required",
        text: output.kind === "link"
          ? "Bench cannot unlink a transfer pair automatically. Remove the link in Actual, then re-run."
          : "Bench cannot restore a split automatically yet. Restore the original transaction in Actual using the before state shown here, then re-run.",
      }],
    },
  });
}

export const ADJUSTMENT_REASONS = { opening: REASONS.openingAdjustment, reconciliation: REASONS.reconciliationAdjustment };
