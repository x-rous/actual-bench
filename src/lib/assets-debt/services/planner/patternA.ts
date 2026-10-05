import type { PostingReason } from "@/lib/app-db/types";
import { paymentChildCategory, transferLegCategory } from "../../actual/representation";
import { existingStructureReason, REASONS } from "../../classification/policy";
import { classifyExistingStructure } from "../../classification/existingStructure";
import { createObservedRepaymentAllocator, interestAllocationOf, type InterestAllocation, type ObservedRepaymentAllocator } from "@/lib/financial-models/loan/statementAllocation";
import {
  allocateRepaymentSplit,
  calculatePeriod,
  POSTING_OUTPUT_FORMAT,
  POSTING_OUTPUT_FORMAT_VERSION,
  type ChildSpec,
  type ComponentLine,
  type EconomicKind,
  type PostingInputSnapshot,
  type PostingOutputSnapshot,
  type RowSnapshot,
  type SplitOverride,
} from "../snapshot";
import {
  addIsoDays,
  baseBlockers,
  budgetStatusOf,
  compareIso,
  eventsOn,
  finalize,
  generationFor,
  inputSnapshot,
  livePosting,
  matchPeriod,
  usableAccount,
  type ComponentConfig,
  type PlanResult,
  type PlanningContext,
} from "./common";
import { eventsInWindow, planLink } from "./patternB";

/**
 * Pattern A: interest embedded in the repayment (RD-084 P1.6 T119; FR-013,
 * FR-013a, FR-069, FR-073, SC-007a).
 *
 * The matched bank repayment is restructured into split children: interest
 * and cash-paid fee children by category, and a principal child that is the
 * exact residual, so the children always sum to the parent.
 *
 * - Without a lender feed, the principal child uses the liability's transfer
 *   payee, so Actual itself creates the one liability-side row.
 * - With a lender feed (an enabled `lender-repayment-row` rule), the
 *   principal child has no transfer payee; once the split is applied, Bench
 *   proposes linking that child and the lender's row as the transfer pair. No
 *   counterpart is ever created, so the principal has exactly one
 *   representation in the liability account.
 *
 * A reconciled payment, an existing split or an ambiguous structure is never
 * restructured; a reconciled lender row is never the counterpart; an amount
 * mismatch Blocks the link because Actual would overwrite the lender amount.
 */
export function planPatternA(ctx: PlanningContext): PlanResult {
  const out: PlanResult = { postings: [], notices: [] };
  const window = eventsInWindow(ctx);
  if ("error" in window) {
    out.notices.push({ code: "calculation-blocked", periodKey: ctx.window.from, text: `The loan cannot be calculated: ${window.error}` });
    return out;
  }
  const lenderFeed = ctx.rules["lender-repayment-row"] !== undefined;
  const actualDated = ctx.model.profile.accrual !== "per-period";
  const allocation = interestAllocationOf(ctx.model);
  // Every repayment from the opening, in order: the split of a matched repayment is allocated on actual dates (T284).
  const chain = repaymentChain(ctx, actualDated, allocation);

  for (const date of window.repaymentDates) {
    const calc = eventsOn(ctx, date);
    if ("error" in calc) continue;
    const repayment = calc.events.find((e) => e.eventType === "repayment" || e.eventType === "final-payment");
    if (!repayment) continue;
    const period = { key: date, from: date, to: date, chargeDates: [date] };
    const assumedEntry = (): ChainEntry => ({ dueDate: date, paidDate: date, amountMinor: Math.abs(repayment.cashMovementMinor), feesMinor: Math.abs(repayment.feesMinor), assumed: true });

    const split = livePosting(ctx, "repayment-split", date);
    if (split) {
      chain.add(split.outputSnapshot.kind === "restructure" ? entryFromSplit(split.outputSnapshot, date) : assumedEntry());
      // Second step with a lender feed: link the applied principal child and the lender row.
      if (lenderFeed && split.status === "applied" && !livePosting(ctx, "repayment-link", date)) planLenderLink(ctx, out, split, date, calc);
      continue;
    }
    if (!ctx.rules.repayment) {
      chain.add(assumedEntry());
      out.notices.push({ code: "no-repayment-rule", periodKey: date, text: "Set up and enable repayment matching in this loan's Repayment matching tab (the recommended setup comes from Tracking setup) so Bench can find this payment." });
      continue;
    }
    const expectedPayment = Math.abs(repayment.cashMovementMinor);
    const match = matchPeriod(ctx, "repayment", { periodKey: date, date, paymentMinor: expectedPayment, interestMinor: Math.abs(repayment.interestMinor), principalMinor: Math.abs(repayment.principalMovementMinor), feesMinor: Math.abs(repayment.feesMinor) });
    if (!match || match.status === "missing") {
      chain.add(assumedEntry());
      out.notices.push({ code: "repayment-missing", periodKey: date, text: "The repayment has not been found in Actual yet. If it was paid earlier or later than the matching rule allows, adjust the days in the Repayment matching tab." });
      continue;
    }
    if (match.status === "multiple") {
      chain.add(assumedEntry());
      out.notices.push({ code: "repayment-ambiguous", periodKey: date, text: REASONS.multipleCandidates.text });
      continue;
    }
    const evaluation = match.candidates[0];
    const row = ctx.rows.get(evaluation.candidate.id);
    if (!row) {
      chain.add(assumedEntry());
      continue;
    }
    // The matched payment happened on its own date, whatever Bench does with it below.
    const parts = nonPrincipalParts(ctx, { interest: 0, fees: Math.abs(repayment.feesMinor) });
    const edit = overrideFor(ctx, date, row);
    const observedEntry: ChainEntry = { dueDate: date, paidDate: row.date, amountMinor: Math.abs(row.amountMinor), feesMinor: parts.parts.reduce((sum, p) => sum + p.amount, 0), ...(edit ? { appliedInterestMinor: edit.interestMinor } : {}) };
    const earlier = chain.entries.slice();
    const allocated = chain.add(observedEntry);
    const decision = classifyExistingStructure({ candidate: evaluation.candidate, lenderPattern: "embedded-interest", rowRole: "payment" });
    if (decision.disposition !== "restructure" && decision.classification !== "blocked") {
      out.notices.push({ code: decision.reasons[0] ?? "manual-review", periodKey: date, text: existingStructureReason(decision.reasons[0] ?? "").text });
      continue;
    }
    if (decision.classification === "blocked" && !row.reconciled) {
      out.notices.push({ code: decision.reasons[0] ?? "blocked", periodKey: date, text: existingStructureReason(decision.reasons[0] ?? "").text });
      continue;
    }

    const blockers: PostingReason[] = [...baseBlockers(ctx)];
    const reviews: PostingReason[] = decision.reasons.filter((code) => code !== "reconciled-row-read-only").map(existingStructureReason);
    if (row.reconciled) blockers.push(REASONS.reconciledRow);
    // T279: a payment that is already a transfer is split only when its loan-side row is exactly as
    // Actual made it; Actual deletes that row on the split and Undo re-creates it (with a new id).
    let replacesCounterpart: RowSnapshot | null = null;
    if (row.transferId) {
      const verdict = transferCounterpartVerdict(ctx, row);
      if (verdict.ok) {
        replacesCounterpart = verdict.counterpart;
        reviews.push(REASONS.replacesCounterpart);
      } else {
        blockers.push(verdict.reason);
      }
    }
    if (match.status === "unsafe") blockers.push(...evaluation.unsafeReasons.map((code) => ({ code, text: `The matched row is unsafe to change (${code}). Resolve it in Actual, then re-run.` })));
    if (!ctx.canRestructure) blockers.push({ code: "restructure-unavailable", text: "This connection cannot restructure transactions. Use a supported Actual Bench connection." });

    // The split from the actual date (T284); the scheduled calculation only when the loan is not daily.
    let interestMinor = Math.abs(repayment.interestMinor);
    let closing = calc.closing;
    let versions = calc.versions;
    let observedRepayments: PostingInputSnapshot["observedRepayments"];
    let override: SplitOverride | null = null;
    if (actualDated) {
      const observed = { allocation, repayments: [...earlier, observedEntry] };
      if (allocated.ok) {
        interestMinor = allocated.row.interestMinor;
        if (edit) {
          // Keep the user's value; record it against the current calculation.
          const calculated = allocateRepaymentSplitCalculated(ctx, allocation, earlier, observedEntry);
          override = { ...edit, calculatedInterestMinor: calculated ?? edit.calculatedInterestMinor };
          reviews.push(editedReason(override, ctx.model.currency.minorDigits));
        }
        closing = { date: row.date, principalMinor: allocated.row.balanceAfterMinor, accruedInterestMinor: 0, carriedRemainder: null };
        versions = { ...calc.versions, ...chain.engineVersions };
        observedRepayments = observed;
        const assumed = earlier.filter((e) => e.assumed).map((e) => e.dueDate);
        if (assumed.length) reviews.push(assumedRepaymentsReason(assumed));
      } else {
        reviews.push({ code: "actual-date-split-unavailable", text: `Bench could not split this payment by its actual date (${allocated.message}). The split uses the scheduled calculation; review it before applying.` });
      }
    }

    const payment = usableAccount(ctx, row.accountId);
    const liability = usableAccount(ctx, ctx.debt.liabilityAccountId);
    if (!payment || !liability) blockers.push(REASONS.missingAccount);
    const plan = payment && liability ? splitChildren(ctx, row, { interest: interestMinor, fees: Math.abs(repayment.feesMinor) }, lenderFeed) : null;
    if (plan && !plan.ok) blockers.push(...plan.blockers);
    const children = plan?.ok ? plan.children : [];
    const components: ComponentLine[] = children.map((c) => ({ kind: c.economicKind, amountMinor: Math.abs(c.amountMinor) }));

    out.postings.push(finalize(ctx, {
      postingKind: "repayment-split", periodKey: date, shape: "restructure", generation: generationFor(ctx, "repayment-split", date), marker: null,
      inputSnapshot: {
        ...inputSnapshot(ctx, period, replacesCounterpart ? [row, replacesCounterpart] : [row], { lenderFeed, ...(override ? { overrideInterestMinor: override.interestMinor, calculatedInterestMinor: override.calculatedInterestMinor, overrideReason: override.reason } : {}) }),
        ...(observedRepayments ? { observedRepayments } : {}),
      },
      outputSnapshot: {
        format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "restructure",
        before: row,
        operations: children,
        expectedPostState: { parentId: row.id, parentAmountMinor: row.amountMinor, children },
        accountBudgetStatus: budgetStatusOf(ctx, [row.accountId, ctx.debt.liabilityAccountId]),
        components,
        closing,
        ...(replacesCounterpart ? { replacesCounterpart } : {}),
        ...(override ? { override } : {}),
      },
      engineVersions: versions,
      // FR-170c: one payment matched under the enabled rule; the policy decides from the notes.
      policy: { blockers, reviews, routineSplit: match.status === "unique" },
    }));
  }
  return out;
}

/**
 * Whether an existing transfer's loan-side row may be replaced (T279). The
 * same rule the write layer enforces (`untouchedCounterpartProblems`): Actual
 * made it and nobody touched it, so the counterpart Undo re-creates is the
 * same row in everything but its id. An imported row (the lender's) is never
 * replaced: splitting would delete it and Undo could not bring it back.
 */
function transferCounterpartVerdict(ctx: PlanningContext, payment: RowSnapshot): { ok: true; counterpart: RowSnapshot } | { ok: false; reason: PostingReason } {
  const counterpart = payment.transferId ? ctx.rows.get(payment.transferId) : undefined;
  if (!counterpart) return { ok: false, reason: { code: "counterpart-not-visible", text: "The payment is already a transfer, but Bench cannot see its loan-side row. Widen the preview window, or check the transfer in Actual." } };
  if (counterpart.accountId !== ctx.debt.liabilityAccountId) return { ok: false, reason: { code: "transfer-elsewhere", text: "The payment is a transfer to a different account than this loan. Fix it in Actual, then re-run." } };
  if (counterpart.importedId || counterpart.importedPayee) return { ok: false, reason: REASONS.lenderCounterpartProtected };
  if (ctx.candidates.some((c) => c.id === counterpart.id && c.postingLinked)) return { ok: false, reason: REASONS.alreadyLinked };
  const problems: string[] = [];
  if (counterpart.reconciled) problems.push("it is reconciled");
  if (counterpart.cleared) problems.push("it is cleared");
  if (counterpart.categoryId) problems.push("it has a category");
  if (counterpart.isParent || counterpart.isChild) problems.push("it is split");
  if (counterpart.amountMinor !== -payment.amountMinor || counterpart.date !== payment.date) problems.push("its amount or date differs");
  if ((counterpart.notes ?? null) !== (payment.notes ?? null)) problems.push("its notes were edited");
  if (counterpart.payeeId !== ctx.transferPayeeByAccount[payment.accountId]) problems.push("its payee was changed");
  if (problems.length) {
    return { ok: false, reason: { code: "counterpart-edited", text: `The payment is already a transfer whose loan-side row was changed in Actual (${problems.join("; ")}). Splitting would delete that row and Undo could not bring the changes back. Undo those edits or remove the transfer in Actual, then re-run.` } };
  }
  return { ok: true, counterpart };
}

type SplitPlan = { ok: true; children: ChildSpec[] } | { ok: false; blockers: PostingReason[] };

/** Interest and cash-paid fee children by category; principal is the exact residual (FR-069). */
export function splitChildren(ctx: PlanningContext, row: RowSnapshot, amounts: { interest: number; fees: number }, lenderFeed: boolean): SplitPlan {
  const payment = usableAccount(ctx, row.accountId)!;
  const liability = usableAccount(ctx, ctx.debt.liabilityAccountId)!;
  const sign = row.amountMinor < 0 ? -1 : 1;
  const sorted = [...ctx.components].sort((a, b) => a.order - b.order);
  const children: ChildSpec[] = [];
  const { parts: nonPrincipal, blockers } = nonPrincipalParts(ctx, amounts);
  // A payment that is already a transfer (T279) has the loan's transfer payee; no other line may
  // inherit it, or Actual would make it a transfer too.
  const linePayee = Object.values(ctx.transferPayeeByAccount).includes(row.payeeId ?? "") ? null : row.payeeId;
  for (const part of nonPrincipal) {
    const category = paymentChildCategory(payment, part.component?.categoryId ?? null, part.component?.label.toLowerCase() ?? part.kind);
    if (!category.ok) blockers.push({ code: category.code, text: category.text });
    children.push({ economicKind: part.kind, amountMinor: sign * part.amount, categoryId: category.ok ? category.categoryId : null, payeeId: linePayee, transferAccountId: null, notes: part.component?.label ?? labelFor(part.kind) });
  }
  const principal = row.amountMinor - children.reduce((sum, c) => sum + c.amountMinor, 0);
  if (Math.sign(principal) !== sign || principal === 0) blockers.push(REASONS.invalidPrincipal);
  const principalCategory = transferLegCategory(payment, liability, ctx.debt.loanPaymentCategoryId, "loan payment");
  if (!principalCategory.ok) blockers.push(REASONS.missingLoanPaymentCategory);
  const principalComponent = sorted.find((c) => c.economicKind === "principal");
  const transferPayee = ctx.transferPayeeByAccount[liability.id];
  if (!lenderFeed && !transferPayee) blockers.push(REASONS.missingAccount);
  children.unshift({
    economicKind: "principal",
    amountMinor: principal,
    categoryId: principalCategory.ok ? principalCategory.categoryId : null,
    // With a lender feed the principal child is linked to the lender row in a second, reviewed step.
    payeeId: lenderFeed ? linePayee : transferPayee ?? null,
    transferAccountId: lenderFeed ? null : liability.id,
    notes: principalComponent?.label ?? "Principal",
  });
  return blockers.length ? { ok: false, blockers } : { ok: true, children };
}

type NonPrincipalPart = { component: ComponentConfig | null; kind: EconomicKind; amount: number };

/** Interest, the cash-paid fee and fixed other components, in split order; principal is the residual. */
function nonPrincipalParts(ctx: PlanningContext, amounts: { interest: number; fees: number }): { parts: NonPrincipalPart[]; blockers: PostingReason[] } {
  const blockers: PostingReason[] = [];
  const sorted = [...ctx.components].sort((a, b) => a.order - b.order);
  const parts: NonPrincipalPart[] = [];
  if (amounts.interest > 0) parts.push({ component: sorted.find((c) => c.economicKind === "interest") ?? null, kind: "interest", amount: amounts.interest });
  const fee = sorted.find((c) => c.economicKind === "fee" && c.treatment !== "capitalized");
  const feeAmount = amounts.fees > 0 ? amounts.fees : fee?.amountRule === "fixed" ? fee.fixedAmountMinor ?? 0 : 0;
  if (feeAmount > 0) parts.push({ component: fee ?? null, kind: "fee", amount: feeAmount });
  for (const c of sorted) {
    if (["principal", "interest", "fee", "draw"].includes(c.economicKind)) continue;
    if (c.destination === "tracking-only") continue;
    if (c.destination === "transfer") {
      blockers.push({ code: "unsupported-component-destination", text: `The "${c.label}" component is a transfer; Bench only splits principal as a transfer. Change it in Tracking setup.` });
      continue;
    }
    if (c.amountRule === "fixed" && (c.fixedAmountMinor ?? 0) > 0) parts.push({ component: c, kind: c.economicKind as EconomicKind, amount: c.fixedAmountMinor ?? 0 });
    else if (c.amountRule !== "fixed") blockers.push({ code: "lender-provided-component", text: `The "${c.label}" amount comes from the lender; record it before Bench splits this payment.` });
  }
  return { parts, blockers };
}

type ChainEntry = NonNullable<PostingInputSnapshot["observedRepayments"]>["repayments"][number];

/** An applied split: its actual date, amount and non-interest, non-principal children. */
function entryFromSplit(output: Extract<PostingOutputSnapshot, { kind: "restructure" }>, dueDate: string): ChainEntry {
  const feesMinor = output.operations.filter((c) => c.economicKind !== "principal" && c.economicKind !== "interest").reduce((sum, c) => sum + Math.abs(c.amountMinor), 0);
  // An edited split carries what was applied, so later months build on that principal (T291).
  return { dueDate, paidDate: output.before.date, amountMinor: Math.abs(output.before.amountMinor), feesMinor, ...(output.override ? { appliedInterestMinor: output.override.interestMinor } : {}) };
}

/** The interest Bench calculates for this repayment, ignoring the user's edit (for the "calculated" figure). */
function allocateRepaymentSplitCalculated(ctx: PlanningContext, allocation: InterestAllocation, earlier: ChainEntry[], entry: ChainEntry): number | null {
  const { appliedInterestMinor: _edit, ...plain } = entry;
  void _edit;
  const result = allocateRepaymentSplit({ model: ctx.model, opening: ctx.opening, observed: { allocation, repayments: [...earlier, plain] } });
  return result.ok ? result.row.interestMinor : null;
}

/** The user's edit of this period's split, if an undecided proposal for it carries one (T291). */
function overrideFor(ctx: PlanningContext, date: string, row: RowSnapshot): SplitOverride | null {
  for (const p of ctx.postings) {
    if (p.postingKind !== "repayment-split" || p.periodKey !== date || p.status !== "proposed") continue;
    const output = p.outputSnapshot;
    if (output.kind === "restructure" && output.override && output.before.id === row.id && output.before.amountMinor === row.amountMinor) return output.override;
  }
  return null;
}

function editedReason(override: SplitOverride, digits: number): PostingReason {
  const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  return { code: "edited-split", text: `Edited: calculated interest ${fmt(override.calculatedInterestMinor)}, your value ${fmt(override.interestMinor)}${override.reason ? ` (${override.reason})` : ""}.` };
}

/**
 * The repayments from the opening, in order, with one incremental allocator:
 * each repayment is allocated once, however many periods the preview plans.
 * The posting still records the whole chain, so reproduction recomputes it
 * from scratch (`allocateRepaymentSplit`) and must agree.
 */
function repaymentChain(ctx: PlanningContext, actualDated: boolean, allocation: InterestAllocation) {
  const entries: ChainEntry[] = [];
  const created = actualDated ? createObservedRepaymentAllocator({ model: ctx.model, opening: ctx.opening, allocation }) : null;
  const unavailable = created && !created.ok ? created.message : "the loan does not accrue daily";
  const allocator = created?.ok ? created.allocator : null;
  const add = (entry: ChainEntry): ReturnType<ObservedRepaymentAllocator["push"]> => {
    entries.push(entry);
    return allocator ? allocator.push(entry) : { ok: false, message: unavailable };
  };
  if (actualDated) for (const entry of repaymentsBeforeWindow(ctx)) add(entry);
  return { entries, add, engineVersions: allocator?.engineVersions ?? {} };
}

/**
 * Repayments between the opening and the preview window: applied splits by
 * their actual dates, anything else as scheduled (assumed). Usually empty,
 * because the preview starts at the opening.
 */
function repaymentsBeforeWindow(ctx: PlanningContext): ChainEntry[] {
  const from = addIsoDays(ctx.opening.date, 1);
  if (compareIso(ctx.window.from, from) <= 0) return [];
  const run = calculatePeriod({ model: ctx.model, opening: ctx.opening, offsets: ctx.offsets, from, to: addIsoDays(ctx.window.from, -1) });
  if (!run.ok) return [];
  return run.events.filter((e) => e.eventType === "repayment" || e.eventType === "final-payment").map((e) => {
    const split = livePosting(ctx, "repayment-split", e.date);
    return split?.outputSnapshot.kind === "restructure"
      ? entryFromSplit(split.outputSnapshot, e.date)
      : { dueDate: e.date, paidDate: e.date, amountMinor: Math.abs(e.cashMovementMinor), feesMinor: Math.abs(e.feesMinor), assumed: true };
  });
}

function assumedRepaymentsReason(dates: string[]): PostingReason {
  const shown = dates.length > 3 ? `${dates.slice(0, 3).join(", ")} and ${dates.length - 3} more` : dates.join(", ");
  return { code: "earlier-repayment-assumed", text: `Earlier repayments due ${shown} were not found in Actual, so this split assumes they were paid on time for the scheduled amount. Review the interest before applying.` };
}

function labelFor(kind: EconomicKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function planLenderLink(ctx: PlanningContext, out: PlanResult, split: NonNullable<ReturnType<typeof livePosting>>, date: string, calc: { closing: import("../snapshot").ClosingState; versions: Record<string, string> }): void {
  if (split.outputSnapshot.kind !== "restructure") return;
  const childIndex = split.outputSnapshot.operations.findIndex((c) => c.economicKind === "principal");
  const parent = ctx.rows.get(split.outputSnapshot.before.id);
  const childId = split.actualIds?.[childIndex + 1] ?? null;
  const child = childId ? ctx.rows.get(childId) : undefined;
  if (!parent || !child) {
    out.notices.push({ code: "split-not-visible", periodKey: date, text: "The applied split is not in the read window; widen the preview window to link the lender row." });
    return;
  }
  const lenderMatch = matchPeriod(ctx, "lender-repayment-row", { periodKey: date, date, paymentMinor: Math.abs(child.amountMinor) });
  if (!lenderMatch || lenderMatch.status === "missing") {
    out.notices.push({ code: "waiting-for-lender", periodKey: date, text: "Nothing will be written for this period until the lender's row arrives." });
    return;
  }
  if (lenderMatch.status === "multiple") {
    out.notices.push({ code: "lender-row-ambiguous", periodKey: date, text: REASONS.multipleCandidates.text });
    return;
  }
  const lender = ctx.rows.get(lenderMatch.candidates[0].candidate.id);
  if (!lender) return;
  out.postings.push(planLink(ctx, {
    postingKind: "repayment-link", periodKey: date, generation: generationFor(ctx, "repayment-link", date),
    source: child, counterpart: lender, closing: calc.closing, versions: calc.versions, period: { key: date, from: date, to: date, chargeDates: [date] },
  }));
}
