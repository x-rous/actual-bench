import type { PostingReason } from "@/lib/app-db/types";
import type { MatchCandidate } from "@/lib/financial-models/matching";
import type { PayoffFigures, RecordedSplit } from "../snapshot";
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
import { OVERRIDE_NO_REASON_MINOR } from "../../overrides";
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
  // Payments into the loan account (their paying side) that could pay the loan off, oldest first.
  const payoffs = payoffCandidates(ctx);
  let settled = false;

  for (const date of window.repaymentDates) {
    const calc = eventsOn(ctx, date);
    if ("error" in calc) continue;
    const repayment = calc.events.find((e) => e.eventType === "repayment" || e.eventType === "final-payment");
    if (!repayment) continue;
    const period = { key: date, from: date, to: date, chargeDates: [date] };
    const assumedEntry = (): ChainEntry => ({ dueDate: date, paidDate: date, amountMinor: Math.abs(repayment.cashMovementMinor), feesMinor: Math.abs(repayment.feesMinor), assumed: true });

    const split = livePosting(ctx, "repayment-split", date);
    if (split) {
      chain.add(split.outputSnapshot.kind === "restructure" ? entryFromSplit(split.outputSnapshot, date) : split.outputSnapshot.kind === "claim" && split.outputSnapshot.recordedSplit ? entryFromRecorded(split.outputSnapshot.recordedSplit, date) : split.outputSnapshot.kind === "adjust-split" ? entryFromRecorded(split.outputSnapshot.recordedSplit, date) : assumedEntry());
      // Second step with a lender feed: link the applied principal child and the lender row.
      if (lenderFeed && split.status === "applied" && !livePosting(ctx, "repayment-link", date)) planLenderLink(ctx, out, split, date, calc);
      // Paid off: nothing after it is expected.
      if (split.outputSnapshot.kind === "restructure" && split.outputSnapshot.payoff) {
        settled = true;
        break;
      }
      continue;
    }
    const next = window.repaymentDates[window.repaymentDates.indexOf(date) + 1] ?? null;
    const base = { date, repayment, calc, period, chain, actualDated, allocation, lenderFeed };
    // A payment that clears the loan, made on or before this due date (owner decision 2026-10-07):
    // found whatever the matching rule says, since a payoff is rarely the scheduled amount.
    const early = payoffs.find((r) => r.date > lastPaid(chain) && r.date <= date);
    const earlyPlan = early ? payoffPlan(ctx, chain, early) : null;
    if (early && earlyPlan) {
      planSplit(ctx, out, { ...base, row: early, candidate: ctx.candidates.find((c) => c.id === early.id)!, matchStatus: "payoff", unsafeReasons: [], payoff: earlyPlan });
      settled = true;
      break;
    }
    if (!ctx.rules.repayment) {
      chain.add(assumedEntry());
      out.notices.push({ code: "no-repayment-rule", periodKey: date, text: "Set up and enable repayment matching in this loan's Repayment matching tab (the recommended setup comes from Tracking setup) so Bench can find this payment." });
      continue;
    }
    const expectedPayment = Math.abs(repayment.cashMovementMinor);
    const match = matchPeriod(ctx, "repayment", { periodKey: date, date, paymentMinor: expectedPayment, interestMinor: Math.abs(repayment.interestMinor), principalMinor: Math.abs(repayment.principalMovementMinor), feesMinor: Math.abs(repayment.feesMinor) });
    // Not found as this month's repayment, but the loan was paid off before the next one falls due.
    const late = !match || match.status === "missing" || match.status === "multiple" ? payoffs.find((r) => r.date > lastPaid(chain) && r.date > date && (next === null || r.date < next)) : undefined;
    const latePlan = late ? payoffPlan(ctx, chain, late) : null;
    if (late && latePlan) {
      planSplit(ctx, out, { ...base, row: late, candidate: ctx.candidates.find((c) => c.id === late.id)!, matchStatus: "payoff", unsafeReasons: [], payoff: latePlan });
      settled = true;
      break;
    }
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
    const side = paymentSide(ctx, evaluation.candidate);
    if (!side.ok) {
      chain.add(assumedEntry());
      out.notices.push({ code: "payment-side-not-visible", periodKey: date, text: side.text });
      continue;
    }
    const candidate = side.candidate;
    const row = ctx.rows.get(candidate.id);
    if (!row) {
      chain.add(assumedEntry());
      continue;
    }
    // A repayment already split in Actual (principal transfer + the rest): recorded as it is, like a
    // Bench split the user edited (owner decision 2026-10-06). Nothing is written to Actual.
    if (row.isParent && candidate.loanSplit) {
      planRecordedSplit(ctx, out, { date, row, repayment, chain, actualDated, allocation, period });
      continue;
    }
    // The matched payment clears the loan (a payoff, or the last repayment): planned as the payoff.
    const matchedPayoff = payoffPlan(ctx, chain, row);
    if (matchedPayoff) {
      planSplit(ctx, out, { ...base, row, candidate, matchStatus: "payoff", unsafeReasons: match.status === "unsafe" ? evaluation.unsafeReasons : [], payoff: matchedPayoff });
      settled = true;
      break;
    }
    planSplit(ctx, out, { ...base, row, candidate, matchStatus: match.status, unsafeReasons: evaluation.unsafeReasons, payoff: null, expectedPaymentMinor: expectedPayment });
  }
  // Paid off after the last due date so far (the next repayment is not due yet): the payoff takes
  // the place of the next repayment due, or stands on its own date after the loan's last one.
  if (!settled && actualDated) {
    const trailing = payoffs.find((r) => r.date > lastPaid(chain));
    const plan = trailing ? payoffPlan(ctx, chain, trailing) : null;
    if (trailing && plan) {
      const due = nextDueOnOrAfter(ctx, trailing.date) ?? trailing.date;
      const calc = eventsOn(ctx, due);
      if (!("error" in calc)) {
        const repayment = calc.events.find((e) => e.eventType === "repayment" || e.eventType === "final-payment") ?? { interestMinor: 0, feesMinor: 0, cashMovementMinor: 0 };
        planSplit(ctx, out, {
          date: due, row: trailing, candidate: ctx.candidates.find((c) => c.id === trailing.id)!, repayment, calc,
          period: { key: due, from: due, to: due, chargeDates: [due] }, chain, actualDated, allocation, lenderFeed,
          matchStatus: "payoff", unsafeReasons: [], payoff: plan,
        });
      }
    }
  }
  return out;
}

/** The first scheduled repayment on or after `date`, within a year; null after the loan's last one. */
function nextDueOnOrAfter(ctx: PlanningContext, date: string): string | null {
  const run = calculatePeriod({ model: ctx.model, opening: ctx.opening, offsets: ctx.offsets, from: date, to: addIsoDays(date, 400) });
  if (!run.ok) return null;
  return run.events.find((e) => (e.eventType === "repayment" || e.eventType === "final-payment") && e.date >= date)?.date ?? null;
}

type PayoffPlan = { entry: ChainEntry; fees: number; figures: PayoffFigures };

/** The date of the last repayment in the chain (or the opening): a payoff can only come after it. */
function lastPaid(chain: ReturnType<typeof repaymentChain>): string {
  return chain.entries.reduce((latest, e) => (e.paidDate > latest ? e.paidDate : latest), "0000-01-01");
}

/**
 * Payments into the loan account that are not already Bench's, seen from the side they were paid
 * from (that is the row a split changes), oldest first. A deposit with no paying side is left to
 * the extra-payments list.
 */
function payoffCandidates(ctx: PlanningContext): RowSnapshot[] {
  const liability = ctx.debt.liabilityAccountId;
  if (!liability) return [];
  const reduces = (amount: number) => (ctx.debt.signConvention === "positive-is-debt" ? amount < 0 : amount > 0);
  const out: RowSnapshot[] = [];
  for (const c of ctx.candidates) {
    if (c.accountId !== liability || c.isChild || c.benchMarked || c.postingLinked || !reduces(c.amountMinor) || c.date < ctx.opening.date) continue;
    const side = paymentSide(ctx, c);
    if (!side.ok || side.candidate.accountId === liability || side.candidate.isParent) continue;
    const row = ctx.rows.get(side.candidate.id);
    if (row) out.push(row);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/**
 * Whether this payment pays the loan off (owner decision 2026-10-07): it covers the principal still
 * owed plus the interest accrued up to the day it was paid, give or take the loan's tolerance.
 * Interest runs to the payment date (the payment is its own due date), never to a later due date.
 * More than that goes to a payoff fee line when the loan has a cash fee component, else into the
 * interest line with a reason; a shortfall within the tolerance comes off the interest.
 */
function payoffPlan(ctx: PlanningContext, chain: ReturnType<typeof repaymentChain>, row: RowSnapshot): PayoffPlan | null {
  const amountMinor = Math.abs(row.amountMinor);
  const tolerance = ctx.debt.driftToleranceMinor ?? 100;
  // Cheap first: a payoff covers at least the principal owed (interest only adds to it).
  const owed = chain.owed();
  if (owed === null || owed <= 0 || amountMinor + tolerance < owed) return null;
  const probe = chain.peek({ dueDate: row.date, paidDate: row.date, amountMinor, feesMinor: 0 });
  if (!probe.ok) return null;
  const owedPrincipalMinor = probe.row.balanceBeforeMinor;
  const interestMinor = probe.row.interestMinor;
  if (owedPrincipalMinor <= 0) return null;
  const excessMinor = amountMinor - owedPrincipalMinor - interestMinor;
  if (excessMinor < -tolerance) return null;
  const feeLine = ctx.components.some((c) => c.economicKind === "fee" && c.treatment !== "capitalized");
  const fees = excessMinor > tolerance && feeLine ? excessMinor : 0;
  const applied = fees ? interestMinor : Math.max(0, interestMinor + excessMinor);
  const entry: ChainEntry = { dueDate: row.date, paidDate: row.date, amountMinor, feesMinor: fees, ...(applied !== interestMinor ? { appliedInterestMinor: applied } : {}) };
  return { entry, fees, figures: { paidDate: row.date, owedPrincipalMinor, interestMinor, excessMinor } };
}

/** The split of one matched payment (a repayment or the payoff), from its actual date (T284). */
function planSplit(
  ctx: PlanningContext,
  out: PlanResult,
  input: {
    date: string;
    row: RowSnapshot;
    candidate: MatchCandidate;
    repayment: { interestMinor: number; feesMinor: number; cashMovementMinor: number };
    calc: { closing: import("../snapshot").ClosingState; versions: Record<string, string> };
    period: { key: string; from: string; to: string; chargeDates: string[] };
    chain: ReturnType<typeof repaymentChain>;
    actualDated: boolean;
    allocation: InterestAllocation;
    lenderFeed: boolean;
    matchStatus: string;
    unsafeReasons: string[];
    payoff: PayoffPlan | null;
    expectedPaymentMinor?: number;
  },
): void {
  const { date, row, candidate, repayment, calc, period, chain, actualDated, allocation, lenderFeed, payoff } = input;
  const digits = ctx.model.currency.minorDigits;
  const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  const feesMinor = payoff ? payoff.fees : Math.abs(repayment.feesMinor);
  // The matched payment happened on its own date, whatever Bench does with it below.
  const parts = nonPrincipalParts(ctx, { interest: 0, fees: feesMinor });
  const edit = payoff ? null : overrideFor(ctx, date, row);
  const observedEntry: ChainEntry = payoff ? payoff.entry : { dueDate: date, paidDate: row.date, amountMinor: Math.abs(row.amountMinor), feesMinor: parts.parts.reduce((sum, p) => sum + p.amount, 0), ...(edit ? { appliedInterestMinor: edit.interestMinor } : {}) };
  const earlier = chain.entries.slice();
  const allocated = chain.add(observedEntry);
  const decision = classifyExistingStructure({ candidate, lenderPattern: "embedded-interest", rowRole: "payment" });
  if (decision.disposition !== "restructure" && decision.classification !== "blocked") {
    out.notices.push({ code: decision.reasons[0] ?? "manual-review", periodKey: date, text: existingStructureReason(decision.reasons[0] ?? "").text });
    return;
  }
  if (decision.classification === "blocked" && !row.reconciled) {
    out.notices.push({ code: decision.reasons[0] ?? "blocked", periodKey: date, text: existingStructureReason(decision.reasons[0] ?? "").text });
    return;
  }

  const blockers: PostingReason[] = [...baseBlockers(ctx)];
  const reviews: PostingReason[] = decision.reasons.filter((code) => code !== "reconciled-row-read-only").map(existingStructureReason);
  if (row.reconciled) blockers.push(REASONS.reconciledRow);
  if (payoff) {
    reviews.push(REASONS.payoff);
    const f = payoff.figures;
    reviews.push({ code: "payoff-figures", text: `Paid ${fmt(Math.abs(row.amountMinor))} on ${f.paidDate}: principal owed ${fmt(f.owedPrincipalMinor)} and interest to that day ${fmt(f.interestMinor)}${f.excessMinor > 0 ? `, ${fmt(f.excessMinor)} more than that (${payoff.fees ? "shown as a payoff fee" : "added to the interest line"}; change it if it is something else)` : f.excessMinor < 0 ? `, ${fmt(-f.excessMinor)} less (within your tolerance; taken off the interest)` : ""}.` });
  } else if (input.expectedPaymentMinor !== undefined) {
    // A payment far from the scheduled repayment is never a routine split (owner decision 2026-10-07).
    const difference = Math.abs(Math.abs(row.amountMinor) - input.expectedPaymentMinor);
    if (difference > Math.max(ctx.debt.driftToleranceMinor ?? 100, Math.round(input.expectedPaymentMinor / 10))) reviews.push(REASONS.unusualAmount);
  }
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
  if (input.matchStatus === "unsafe" || input.unsafeReasons.length) blockers.push(...input.unsafeReasons.map((code) => ({ code, text: `The matched row is unsafe to change (${code}). Resolve it in Actual, then re-run.` })));
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
        reviews.push(editedReason(override, digits));
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
  const plan = payment && liability ? splitChildren(ctx, row, { interest: interestMinor, fees: feesMinor }, lenderFeed) : null;
  if (plan && !plan.ok) blockers.push(...plan.blockers);
  const children = plan?.ok ? plan.children : [];
  const components: ComponentLine[] = children.map((c) => ({ kind: c.economicKind, amountMinor: Math.abs(c.amountMinor) }));

  out.postings.push(finalize(ctx, {
    postingKind: "repayment-split", periodKey: date, shape: "restructure", generation: generationFor(ctx, "repayment-split", date), marker: null,
    inputSnapshot: {
      ...inputSnapshot(ctx, period, replacesCounterpart ? [row, replacesCounterpart] : [row], { lenderFeed, ...(payoff ? { payoff: true } : {}), ...(override ? { overrideInterestMinor: override.interestMinor, calculatedInterestMinor: override.calculatedInterestMinor, overrideReason: override.reason } : {}) }),
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
      ...(payoff ? { payoff: payoff.figures } : {}),
    },
    engineVersions: versions,
    // FR-170c: one payment matched under the enabled rule; the policy decides from the notes. A payoff is never routine.
    policy: { blockers, reviews, routineSplit: !payoff && input.matchStatus === "unique" },
  }));
}

/**
 * The repayment itself, for a matched row. A rule that looks in the loan account matches the
 * loan-side row of a transfer; the repayment is the other side, in the account it was paid from
 * (or, when it is already split there, that split), and that is the row Bench records or changes.
 * Any other row is the repayment as matched.
 */
function paymentSide(ctx: PlanningContext, matched: MatchCandidate): { ok: true; candidate: MatchCandidate } | { ok: false; text: string } {
  if (matched.accountId !== ctx.debt.liabilityAccountId || !matched.transferId) return { ok: true, candidate: matched };
  const other = ctx.candidates.find((c) => c.id === matched.transferId);
  const payment = other?.isChild && other.parentId ? ctx.candidates.find((c) => c.id === other.parentId) : other;
  if (!payment) return { ok: false, text: "The repayment was found in the loan account, but Bench cannot see the payment it came from. Set the account repayments are paid from in Link to Actual, then refresh." };
  return { ok: true, candidate: payment };
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


/** A recorded split: its actual date and amount, and the interest Actual holds (it counts, like an edit). */
function entryFromRecorded(recorded: RecordedSplit, dueDate: string): ChainEntry {
  return { dueDate, paidDate: recorded.parent.date, amountMinor: Math.abs(recorded.parent.amountMinor), feesMinor: 0, appliedInterestMinor: recorded.interestMinor };
}

/**
 * Plan the record of a repayment already split in Actual: the principal part must be the transfer
 * to this loan's account; the other parts are interest (and any fees). Actual's figures are used;
 * a difference from Bench's calculation beyond one minor unit asks for review.
 */
function planRecordedSplit(
  ctx: PlanningContext,
  out: PlanResult,
  input: { date: string; row: RowSnapshot; repayment: { interestMinor: number; principalMovementMinor: number }; chain: ReturnType<typeof repaymentChain>; actualDated: boolean; allocation: InterestAllocation; period: { key: string; from: string; to: string; chargeDates: string[] } },
): void {
  const { date, row, chain } = input;
  const children = [...ctx.rows.values()].filter((r) => r.isChild && r.parentId === row.id).sort((a, b) => a.id.localeCompare(b.id));
  const transfers = children.filter((c) => c.transferId);
  const principalChild = transfers.length === 1 ? transfers[0] : null;
  const liabilityPayee = ctx.debt.liabilityAccountId ? ctx.transferPayeeByAccount[ctx.debt.liabilityAccountId] : undefined;
  const blockers: PostingReason[] = [...baseBlockers(ctx)];
  if (!principalChild || (liabilityPayee && principalChild.payeeId !== liabilityPayee)) blockers.push({ code: "recorded-split-elsewhere", text: "The split's transfer part does not go to this loan's account. Fix the split in Actual, then refresh." });
  const payment = Math.abs(row.amountMinor);
  const actualPrincipal = principalChild ? Math.abs(principalChild.amountMinor) : 0;
  const actualInterest = payment - actualPrincipal;
  // T314: the user's change to this split, still undecided and made against the split as it is now.
  const edit = principalChild && children.length === 2 ? recordedEditFor(ctx, date, row, children) : null;
  const interestMinor = edit ? edit.interestMinor : actualInterest;
  const principalMinor = payment - interestMinor;
  const entry: ChainEntry = { dueDate: date, paidDate: row.date, amountMinor: payment, feesMinor: 0, appliedInterestMinor: interestMinor };
  const earlier = chain.entries.slice();
  const allocated = chain.add(entry);
  const calculatedInterestMinor = input.actualDated && allocated.ok
    ? allocateRepaymentSplitCalculated(ctx, input.allocation, earlier, entry) ?? Math.abs(input.repayment.interestMinor)
    : Math.abs(input.repayment.interestMinor);
  const reviews: PostingReason[] = [];
  const fmt = (minor: number) => (minor / 10 ** ctx.model.currency.minorDigits).toFixed(ctx.model.currency.minorDigits);
  const closing = { date: row.date, principalMinor: allocated.ok ? allocated.row.balanceAfterMinor : 0, accruedInterestMinor: 0, carriedRemainder: null };
  const counterpart = principalChild?.transferId ? ctx.rows.get(principalChild.transferId) ?? null : null;
  const recorded: RecordedSplit = { parent: row, children, principalMinor, interestMinor, calculatedInterestMinor, counterpart };
  const snapshotInput = { ...inputSnapshot(ctx, input.period, [row, ...children], { recordedSplit: true }), observedRepayments: { allocation: input.allocation, repayments: [...earlier, entry] } };
  if (edit && principalChild) {
    if (!counterpart) blockers.push({ code: "counterpart-not-visible", text: "Bench cannot see the loan-side row of this split's transfer part. Widen the period shown, or check the transfer in Actual." });
    const sign = row.amountMinor < 0 ? -1 : 1;
    const interestChild = children.find((c) => c.id !== principalChild.id)!;
    reviews.push({ code: "edited-split", text: `Edited: Actual has interest ${fmt(actualInterest)}, calculated ${fmt(calculatedInterestMinor)}, your value ${fmt(interestMinor)}${edit.reason ? ` (${edit.reason})` : ""}.` });
    out.postings.push(finalize(ctx, {
      postingKind: "repayment-split", periodKey: date, shape: "adjust", generation: generationFor(ctx, "repayment-split", date), marker: null,
      inputSnapshot: snapshotInput,
      outputSnapshot: {
        format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "adjust-split",
        parent: row, children, counterpart,
        amounts: [{ id: principalChild.id, amountMinor: sign * principalMinor }, { id: interestChild.id, amountMinor: sign * interestMinor }],
        recordedSplit: recorded,
        edit: { actualInterestMinor: actualInterest, calculatedInterestMinor, interestMinor, reason: edit.reason },
        closing,
      },
      engineVersions: { ...chain.engineVersions },
      policy: { blockers, reviews },
    }));
    return;
  }
  if (Math.abs(interestMinor - calculatedInterestMinor) > OVERRIDE_NO_REASON_MINOR) {
    reviews.push({ code: "recorded-split-differs", text: `Edited in Actual: calculated interest ${fmt(calculatedInterestMinor)}, Actual has ${fmt(interestMinor)}.` });
  }
  out.postings.push(finalize(ctx, {
    postingKind: "repayment-split", periodKey: date, shape: "claim", generation: generationFor(ctx, "repayment-split", date), marker: null,
    inputSnapshot: snapshotInput,
    outputSnapshot: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "claim",
      rows: principalChild ? [principalChild] : [],
      role: "repayment",
      closing,
      recordedSplit: recorded,
    },
    engineVersions: { ...chain.engineVersions },
    policy: { blockers, reviews, recordedSplit: true },
  }));
}

/**
 * The user's change to a split already in Actual (T314), when an undecided proposal for this period
 * carries one made against the split exactly as Actual holds it now (same lines, same amounts).
 */
function recordedEditFor(ctx: PlanningContext, date: string, row: RowSnapshot, children: RowSnapshot[]): { interestMinor: number; reason: string | null } | null {
  for (const p of ctx.postings) {
    if (p.postingKind !== "repayment-split" || p.periodKey !== date || p.status !== "proposed") continue;
    const output = p.outputSnapshot;
    if (output.kind !== "adjust-split" || !output.edit || output.parent.id !== row.id || output.parent.amountMinor !== row.amountMinor) continue;
    const same = output.children.length === children.length && output.children.every((c) => children.some((now) => now.id === c.id && now.amountMinor === c.amountMinor));
    if (same) return { interestMinor: output.edit.interestMinor, reason: output.edit.reason };
  }
  return null;
}

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
  let balance: number | null = ctx.opening.principalMinor;
  const add = (entry: ChainEntry): ReturnType<ObservedRepaymentAllocator["push"]> => {
    entries.push(entry);
    const result = allocator ? allocator.push(entry) : { ok: false as const, message: unavailable };
    balance = result.ok ? result.row.balanceAfterMinor : null;
    return result;
  };
  if (actualDated) for (const entry of repaymentsBeforeWindow(ctx)) add(entry);
  /** What the next repayment would allocate, without recording it (the payoff check). */
  const peek = (entry: ChainEntry) => (allocator ? allocateRepaymentSplit({ model: ctx.model, opening: ctx.opening, observed: { allocation, repayments: [...entries, entry] } }) : { ok: false as const, message: unavailable });
  /** The principal owed after the last repayment, or null when the chain could not be allocated. */
  const owed = () => balance;
  return { entries, add, peek, owed, engineVersions: allocator?.engineVersions ?? {} };
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
