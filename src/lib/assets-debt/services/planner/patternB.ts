import { chargeCategory } from "../../actual/representation";
import { existingStructureReason, REASONS } from "../../classification/policy";
import { classifyExistingStructure } from "../../classification/existingStructure";
import { POSTING_OUTPUT_FORMAT, POSTING_OUTPUT_FORMAT_VERSION, type ClosingState, type RowSnapshot } from "../snapshot";
import {
  addIsoDays,
  baseBlockers,
  budgetStatusOf,
  compareIso,
  component,
  eventsOn,
  finalize,
  generationFor,
  inputSnapshot,
  ledgerIncrease,
  livePosting,
  markerFor,
  matchPeriod,
  alignmentReviews,
  repaymentAlignment,
  usableAccount,
  windowRun,
  type PlanResult,
  type PlanningContext,
} from "./common";
import { planReversal } from "./adjustments";

/**
 * Pattern B: interest charged separately to the loan (RD-084 P1.6 T118;
 * FR-004, FR-014–FR-016, SC-009).
 *
 * For each projected interest charge in the window:
 *
 * - with a lender feed (an enabled `interest-charge` matching rule), Bench
 *   looks for the lender's own charge first and only links it (a `claim`, no
 *   Actual write); while it has not arrived Bench waits through the grace
 *   period and never posts its own charge;
 * - without a lender feed, Bench proposes creating the charge in the liability
 *   account (uncategorized when off-budget);
 * - if the lender's charge arrives after Bench already applied its own, Bench
 *   proposes a compensating reversal, for review, so interest is never
 *   counted twice.
 *
 * Repayments already recorded as a transfer to the loan are claimed (no
 * write). Two unlinked rows (bank payment and lender row) become a transfer
 * pair through the two-call link.
 */
export function planPatternB(ctx: PlanningContext): PlanResult {
  const out: PlanResult = { postings: [], notices: [] };
  const liability = usableAccount(ctx, ctx.debt.liabilityAccountId);
  const blockers = baseBlockers(ctx);
  const lenderFeed = ctx.rules["interest-charge"] !== undefined;

  const window = eventsInWindow(ctx);
  if ("error" in window) {
    out.notices.push({ code: "calculation-blocked", periodKey: ctx.window.from, text: `The loan cannot be calculated: ${window.error}` });
    return out;
  }

  // Paid off (owner decision 2026-10-07): nothing is charged or expected after the payoff.
  const payoff = patternBPayoff(ctx);
  for (const date of window.chargeDates) {
    if (payoff && date > payoff.date) continue;
    const calc = eventsOn(ctx, date);
    if ("error" in calc) continue;
    const charge = calc.events.find((e) => e.eventType === "interest-charge");
    if (!charge) continue;
    const interest = Math.abs(charge.interestMinor);
    if (interest === 0) continue;
    const period = { key: date, from: date, to: date, chargeDates: [date] };
    const benchCharge = livePosting(ctx, "interest-charge", date);

    if (lenderFeed) {
      const match = matchPeriod(ctx, "interest-charge", { periodKey: date, date, paymentMinor: interest, interestMinor: interest });
      const unique = match?.status === "unique" ? match.candidates[0].candidate : null;
      if (unique) {
        const row = ctx.rows.get(unique.id);
        if (benchCharge && benchCharge.status === "applied") {
          // The lender's charge arrived after Bench posted its own: review a reversal.
          out.postings.push(planReversal(ctx, benchCharge, [REASONS.lateLenderCharge]));
          continue;
        }
        if (livePosting(ctx, "interest-link", date) || !row) continue;
        const generation = generationFor(ctx, "interest-link", date);
        out.postings.push(finalize(ctx, {
          postingKind: "interest-link", periodKey: date, shape: "claim", generation, marker: null,
          inputSnapshot: inputSnapshot(ctx, period, [row]),
          outputSnapshot: { format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "claim", rows: [row], role: "lender-interest-charge", closing: calc.closing },
          engineVersions: calc.versions,
          policy: { blockers, reviews: unique.amountMinor !== ledgerIncrease(ctx, interest) ? [REASONS.needsReview] : [] },
        }));
        continue;
      }
      if (match?.status === "multiple" || match?.status === "unsafe") {
        out.notices.push({ code: "lender-charge-ambiguous", periodKey: date, text: "Several rows look like the lender's interest charge; resolve them in Actual or tighten the matching rule." });
        continue;
      }
      const graceEnds = addIsoDays(date, ctx.debt.lenderChargeGraceDays);
      out.notices.push(compareIso(ctx.today, graceEnds) <= 0
        ? { code: "waiting-for-lender", periodKey: date, text: "Nothing will be written for this period until the lender's row arrives." }
        : { code: "lender-charge-missing", periodKey: date, text: "The lender's interest charge has not arrived after the grace period. Check the lender feed in Actual." });
      continue;
    }

    if (benchCharge) continue;
    const generation = generationFor(ctx, "interest-charge", date);
    const marker = markerFor(ctx, "interest-charge", date, generation);
    const category = liability ? chargeCategory(liability, component(ctx, "interest")?.categoryId ?? null, "interest") : { ok: true as const, categoryId: null };
    const reasons = [...blockers, ...(category.ok ? [] : [{ code: category.code, text: category.text }])];
    out.postings.push(finalize(ctx, {
      postingKind: "interest-charge", periodKey: date, shape: "create", generation, marker,
      inputSnapshot: inputSnapshot(ctx, period, []),
      outputSnapshot: {
        format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "create",
        operations: [{
          accountId: ctx.debt.liabilityAccountId ?? "", date, amountMinor: ledgerIncrease(ctx, interest), payeeId: null, transferAccountId: null,
          categoryId: category.ok ? category.categoryId : null, notes: "Interest charge", cleared: false, importedId: marker, economicKind: "interest",
        }],
        accountBudgetStatus: budgetStatusOf(ctx, [ctx.debt.liabilityAccountId]),
        components: [{ kind: "interest", amountMinor: interest }],
        closing: calc.closing,
      },
      engineVersions: calc.versions,
      policy: { blockers: reasons },
    }));
  }

  planPatternBRepayments(ctx, out, window.repaymentDates, payoff);
  return out;
}

/**
 * When the loan was paid off, on a loan that records interest as its own transaction: an applied
 * payoff, or the transfer into the loan account after which Actual's loan balance is zero, within
 * the tolerance. Read from the loan account's rows, so only when they were read from the opening.
 */
export function patternBPayoff(ctx: PlanningContext): { date: string; rowId: string | null } | null {
  for (const p of ctx.postings) {
    if (p.postingKind === "repayment-link" && ["applying", "applied", "indeterminate"].includes(p.status) && p.outputSnapshot.kind === "claim" && p.outputSnapshot.payoff) return { date: p.outputSnapshot.payoff.paidDate, rowId: null };
  }
  const liability = ctx.debt.liabilityAccountId;
  if (!liability || ctx.window.from > ctx.opening.date) return null;
  const tolerance = ctx.debt.driftToleranceMinor ?? 100;
  const owed = (balance: number) => (ctx.debt.signConvention === "positive-is-debt" ? balance : -balance);
  const rows = [...ctx.rows.values()].filter((r) => r.accountId === liability && !r.isChild).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let balance = 0;
  let owedSoFar = false;
  for (let i = 0; i < rows.length; i++) {
    balance += rows[i].amountMinor;
    if (owed(balance) > tolerance) owedSoFar = true;
    const lastOfDay = i === rows.length - 1 || rows[i + 1].date !== rows[i].date;
    const paysIn = rows[i].transferId && owed(rows[i].amountMinor) < 0;
    if (owedSoFar && lastOfDay && paysIn && Math.abs(owed(balance)) <= tolerance) return { date: rows[i].date, rowId: rows[i].transferId };
  }
  return null;
}

/** One projection across the preview window gives the event dates; each posting then recomputes its own day. */
export function eventsInWindow(ctx: PlanningContext): { chargeDates: string[]; repaymentDates: string[]; feeDates: string[] } | { error: string } {
  const result = windowRun(ctx);
  if (!result.ok) return { error: result.message };
  const pick = (types: string[]) => [...new Set(result.events.filter((e) => types.includes(e.eventType)).map((e) => e.date))].sort();
  return { chargeDates: pick(["interest-charge"]), repaymentDates: pick(["repayment", "final-payment"]), feeDates: pick(["fee"]) };
}

function planPatternBRepayments(ctx: PlanningContext, out: PlanResult, repaymentDates: string[], payoff: { date: string; rowId: string | null } | null): void {
  const blockers = baseBlockers(ctx);
  // The payoff settles the first due date on or after it (or stands on its own date after the last);
  // nothing after that is expected.
  const payoffDue = payoff ? repaymentDates.find((d) => d >= payoff.date) ?? payoff.date : null;
  if (payoff?.rowId && payoffDue && !livePosting(ctx, "repayment-link", payoffDue)) {
    const row = ctx.rows.get(payoff.rowId);
    const counterpart = row?.transferId ? ctx.rows.get(row.transferId) : undefined;
    const calc = eventsOn(ctx, payoffDue);
    if (row && counterpart && !("error" in calc)) {
      out.postings.push(finalize(ctx, {
        postingKind: "repayment-link", periodKey: payoffDue, shape: "claim", generation: generationFor(ctx, "repayment-link", payoffDue), marker: null,
        inputSnapshot: inputSnapshot(ctx, { key: payoffDue, from: payoffDue, to: payoffDue, chargeDates: [] }, [row, counterpart]),
        outputSnapshot: {
          format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "claim", rows: [row, counterpart], role: "repayment",
          closing: { ...calc.closing, date: row.date, principalMinor: 0 },
          payoff: { paidDate: row.date, owedPrincipalMinor: Math.abs(row.amountMinor), interestMinor: 0, excessMinor: 0 },
        },
        engineVersions: calc.versions,
        policy: { blockers, reviews: [REASONS.payoff] },
      }));
    }
  }
  for (const date of repaymentDates) {
    if (!ctx.rules.repayment) break;
    if (payoffDue && date >= payoffDue) break;
    const calc = eventsOn(ctx, date);
    if ("error" in calc) continue;
    const repayment = calc.events.find((e) => e.eventType === "repayment" || e.eventType === "final-payment");
    if (!repayment) continue;
    if (livePosting(ctx, "repayment-link", date)) continue;
    const payment = Math.abs(repayment.cashMovementMinor);
    const match = matchPeriod(ctx, "repayment", { periodKey: date, date, paymentMinor: payment, principalMinor: Math.abs(repayment.principalMovementMinor) });
    if (!match || match.status === "missing") {
      const missed = repaymentAlignment(ctx).aligned(date)?.reasons.find((r) => r.code === "missed")?.text ?? "No payment to this loan was found for this due date.";
      out.notices.push({ code: "repayment-missing", periodKey: date, text: `${missed} If it was paid, choose the payment for this due date.` });
      continue;
    }
    if (match.status === "unsafe") {
      // The payment found cannot be taken as it is (a split Bench did not make, no stable id).
      const code = match.candidates[0]?.unsafeReasons[0] ?? "ambiguous-existing-structure";
      out.notices.push({ code: "repayment-unusable", periodKey: date, text: existingStructureReason(code).text });
      continue;
    }
    const candidate = match.candidates[0].candidate;
    const row = ctx.rows.get(candidate.id);
    if (!row) continue;
    const decision = classifyExistingStructure({ candidate, lenderPattern: "separate-interest", rowRole: "payment" });
    const period = { key: date, from: date, to: date, chargeDates: [] as string[] };
    const generation = generationFor(ctx, "repayment-link", date);

    if (decision.disposition === "link" && decision.classification === "safe") {
      const counterpart = row.transferId ? ctx.rows.get(row.transferId) : undefined;
      if (!counterpart || counterpart.accountId !== ctx.debt.liabilityAccountId) {
        out.notices.push({ code: "transfer-elsewhere", periodKey: date, text: "The repayment is a transfer to a different account than this loan. Fix it in Actual." });
        continue;
      }
      out.postings.push(finalize(ctx, {
        postingKind: "repayment-link", periodKey: date, shape: "claim", generation, marker: null,
        inputSnapshot: inputSnapshot(ctx, period, [row, counterpart]),
        outputSnapshot: { format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "claim", rows: [row, counterpart], role: "repayment", closing: calc.closing },
        engineVersions: calc.versions,
        policy: { blockers, reviews: alignmentReviews(ctx, date) },
      }));
      continue;
    }

    if (decision.classification === "blocked") {
      out.notices.push({ code: decision.reasons[0] ?? "blocked", periodKey: date, text: existingStructureReason(decision.reasons[0] ?? "").text });
      continue;
    }

    // Two unlinked rows: the bank payment and the lender's row in the liability account.
    const lenderMatch = ctx.rules["lender-repayment-row"]
      ? matchPeriod(ctx, "lender-repayment-row", { periodKey: date, date, paymentMinor: payment })
      : null;
    const lender = lenderMatch?.status === "unique" ? ctx.rows.get(lenderMatch.candidates[0].candidate.id) : undefined;
    if (!lender && !ctx.rules["lender-repayment-row"]) {
      // No lender feed: the payment itself becomes the loan transfer (T277); Actual creates the loan-side row.
      if (!livePosting(ctx, "repayment-link", date)) out.postings.push(planConvert(ctx, { periodKey: date, generation, payment: row, closing: calc.closing, versions: calc.versions, period }));
      continue;
    }
    if (!lender) {
      out.notices.push({ code: "waiting-for-lender-row", periodKey: date, text: "The repayment is not a transfer yet and the lender's row has not arrived. Bench links the two once it does." });
      continue;
    }
    out.postings.push(planLink(ctx, { postingKind: "repayment-link", periodKey: date, generation, source: row, counterpart: lender, closing: calc.closing, versions: calc.versions, period }));
  }
}

/** T277: make an existing payment the loan transfer by its payee. Always a Review proposal. */
export function planConvert(
  ctx: PlanningContext,
  input: { periodKey: string; generation: number; payment: RowSnapshot; closing: ClosingState; versions: Record<string, string>; period: { key: string; from: string; to: string; chargeDates: string[] } }
) {
  const blockers = [...baseBlockers(ctx)];
  const liabilityId = ctx.debt.liabilityAccountId ?? "";
  const transferPayeeId = ctx.transferPayeeByAccount[liabilityId];
  const { payment } = input;
  if (!ctx.canRestructure) blockers.push({ code: "convert-unavailable", text: "This connection cannot change existing transactions. Use a supported Actual Bench connection." });
  if (!transferPayeeId) blockers.push(REASONS.missingAccount);
  if (payment.reconciled) blockers.push(REASONS.reconciledRow);
  if (payment.isParent || payment.isChild) blockers.push(REASONS.splitParent);
  if (payment.transferId) blockers.push(REASONS.alreadyLinked);
  const reviews = [];
  const liability = usableAccount(ctx, liabilityId);
  const paymentAccount = usableAccount(ctx, payment.accountId);
  if (liability?.offBudget && paymentAccount && !paymentAccount.offBudget && !payment.categoryId) {
    reviews.push({ code: "uncategorized-transfer", text: "The payment has no category, so the money leaving the budget stays uncategorized. Set a category in Actual if you want it budgeted." });
  }
  return finalize(ctx, {
    postingKind: "repayment-link", periodKey: input.periodKey, shape: "convert", generation: input.generation, marker: null,
    inputSnapshot: inputSnapshot(ctx, input.period, [payment]),
    outputSnapshot: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "convert",
      before: payment, transferPayeeId: transferPayeeId ?? "", transferAccountId: liabilityId,
      expectedCounterpart: { accountId: liabilityId, amountMinor: -payment.amountMinor, notes: payment.notes },
      accountBudgetStatus: budgetStatusOf(ctx, [payment.accountId, liabilityId]),
      closing: input.closing,
    },
    engineVersions: input.versions,
    policy: { blockers, reviews },
  });
}

export function planLink(
  ctx: PlanningContext,
  input: { postingKind: "repayment-link"; periodKey: string; generation: number; source: RowSnapshot; counterpart: RowSnapshot; closing: ClosingState; versions: Record<string, string>; period: { key: string; from: string; to: string; chargeDates: string[] } }
) {
  const blockers = [...baseBlockers(ctx)];
  const transferPayeeId = ctx.transferPayeeByAccount[input.counterpart.accountId];
  if (!ctx.canRestructure) blockers.push(REASONS.linkUnverifiable);
  else if (!ctx.canVerifyTransferLinks || !transferPayeeId) blockers.push(REASONS.linkUnverifiable);
  if (input.counterpart.reconciled) blockers.push(REASONS.reconciledLenderRow);
  if (input.source.reconciled) blockers.push(REASONS.reconciledRow);
  if (input.counterpart.amountMinor !== -input.source.amountMinor) blockers.push(REASONS.amountMismatch);
  if (input.source.transferId || input.counterpart.transferId) blockers.push(REASONS.alreadyLinked);
  return finalize(ctx, {
    postingKind: input.postingKind, periodKey: input.periodKey, shape: "link", generation: input.generation, marker: null,
    inputSnapshot: inputSnapshot(ctx, input.period, [input.source, input.counterpart]),
    outputSnapshot: {
      format: POSTING_OUTPUT_FORMAT, version: POSTING_OUTPUT_FORMAT_VERSION, kind: "link",
      sourceBefore: input.source, counterpartBefore: input.counterpart, transferPayeeId: transferPayeeId ?? "",
      expectedPairState: { sourceTransferId: input.counterpart.id, counterpartTransferId: input.source.id, counterpartAmountMinor: -input.source.amountMinor },
      closing: input.closing,
    },
    engineVersions: input.versions,
    policy: { blockers },
  });
}
