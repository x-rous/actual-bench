import { evidenceHash } from "./evidence";
import { financingCostKind, hasTrackingCostTransfer, TRACKING_COST_PROBLEM, hasPlanTag, trackingBalance, trackingTransferMatches, trackingRowIndex } from "./planTracking";
import { addMonths, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { simulate } from "@/lib/financial-models/loan/projection";
import { revolvingPayment } from "@/lib/financial-models/loan/revolving";
import type { Anchor } from "@/lib/financial-models/loan/model";
import { cardModel } from "./financialAdapter";
import { sumMinor } from "./statements";
import type { Card, PlanLink, RepaymentPlan, Workspace } from "./models";
import type { ActivityRow, ActivitySnapshot } from "./activity";

export const arrangementLabels = { fixed: "Fixed instalments", "minimum-deadline": "Minimum + deadline", promotional: "Promotional rate", deferred: "Deferred interest", revolving: "Ordinary revolving" };
export const roleLabels = { "conversion-credit": "Conversion credit", "instalment-billed": "Principal billed", "combined-instalment": "Combined instalment", "principal-release": "Principal released to card", "plan-fee": "Plan fee", "plan-interest": "Plan interest / profit", adjustment: "Plan adjustment", refund: "Refund" };
/** Expected totals/components in integer minor units; null components are unspecified after a revision. */
export type ExpectedInstalment = { index: number; date: string; amountMinor: number; principalMinor: number | null; interestMinor: number | null; feeMinor: number | null; final: boolean };

/** Pure expectations using the shared daily engine and minimum-payment primitive. No Actual events or balance writes. */
export function planProjection(plan: RepaymentPlan, card: Card) {
  if (plan.balanceOnly || !["fixed", "minimum-deadline"].includes(plan.arrangement)) return { calculated: false as const, rows: [] as ExpectedInstalment[], reason: plan.balanceOnly ? "Track balance only; no schedule required" : "Not calculated" };
  const principal = plan.amountMinor ?? plan.opening?.principalMinor;
  const months = plan.months, firstDueDate = plan.firstDueDate;
  if (principal == null || months === null || firstDueDate === null) return { calculated: false as const, rows: [] as ExpectedInstalment[], reason: "Enter principal and schedule terms" };
  const startDate = plan.amountMinor === null ? plan.opening!.date : plan.startDate;
  // Inclusive fixed amounts describe a contract total, not a guessed amortization rate.
  if (plan.arrangement === "fixed" && plan.includesCosts) {
    const monthlyFeesMinor = sumMinor(Array.from({ length: months }, () => plan.monthlyFeeMinor));
    const contractualMinor = sumMinor(Array.from({ length: months }, () => plan.monthlyMinor ?? 0));
    const difference = contractualMinor - principal - monthlyFeesMinor;
    if (difference < -months) return { calculated: false as const, rows: [] as ExpectedInstalment[], reason: "The monthly amounts do not cover the converted principal and included fees. Correct the amount, instalment or term." };
    const financeMinor = Math.max(0, difference);
    let principalLeft = principal, financeLeft = financeMinor;
    const rows: ExpectedInstalment[] = [];
    for (let index = 0; index < months; index++) {
      const final = index === months - 1;
      const interestMinor = final ? financeLeft : Math.min((plan.monthlyMinor ?? 0) - plan.monthlyFeeMinor, Math.ceil(financeLeft / (months - index)));
      const principalMinor = final ? principalLeft : Math.min(principalLeft, (plan.monthlyMinor ?? 0) - plan.monthlyFeeMinor - interestMinor);
      const feeMinor = sumMinor([plan.monthlyFeeMinor, index === 0 ? plan.upfrontFeeMinor : 0]);
      rows.push({ index: index + 1, date: addMonths(firstDueDate, index, parseIsoDate(firstDueDate).day), amountMinor: sumMinor([principalMinor, interestMinor, feeMinor]), principalMinor, interestMinor, feeMinor, final });
      principalLeft -= principalMinor; financeLeft -= interestMinor;
    }
    return { calculated: true as const, unusualFinal: false, insufficientInterest: false, warning: null, rows, principalMinor: principal, interestMinor: financeMinor, upfrontFeeMinor: plan.upfrontFeeMinor, monthlyFeesMinor, totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)), reason: "Fixed inclusive contract: the monthly amount and term determine total finance cost. Recorded APR does not add a second interest charge. Upfront fee is separate; the final amount adjusts minor rounding only." };
  }
  const rows: ExpectedInstalment[] = [];
  const model = cardModel({ ...card, purchaseAprBps: plan.aprBps, interestModel: "daily-simple-365", closingDay: parseIsoDate(firstDueDate).day }, startDate, principal);
  model.terms.creditLimitMinor = null;
  model.terms.firstInterestChargeDate = firstDueDate;
  model.profile.negativeAmortizationAllowed = true;
  let anchor: Anchor = { date: startDate, principalMinor: principal, accruedInterestMinor: 0, source: "expected-plan-only" };
  let interestMinor = 0;
  let unusualFinal = false;
  let insufficientInterest = false;
  for (let index = 0; index < months; index++) {
    const date = addMonths(firstDueDate, index, parseIsoDate(firstDueDate).day);
    const preview = simulate({ model, anchor, events: [], to: date, options: { generateScheduledRepayments: false, applyAssumptions: false } });
    if (!preview.ok) return { calculated: false as const, rows: [], reason: preview.blocked.map((entry) => entry.message).join(" ") };
    const interest = sumMinor([...preview.events.map((entry) => entry.interestMinor), preview.closing.accruedInterestMinor]) - (anchor.accruedInterestMinor ?? 0);
    const debt = sumMinor([preview.closing.principalMinor, preview.closing.accruedInterestMinor]);
    const minimum = revolvingPayment({ paymentModel: "percent-of-balance", percentOfBalanceBps: plan.minimumPercentBps, minimumFloorMinor: plan.minimumFloorMinor }, { balanceMinor: debt, lastChargeMinor: interest, contractualPaymentMinor: null, minorDigits: 2, mode: "half-up" });
    const contractual = plan.arrangement === "fixed" ? plan.includesCosts ? Math.max(0, (plan.monthlyMinor ?? 0) - plan.monthlyFeeMinor) : sumMinor([plan.monthlyMinor ?? 0, interest]) : minimum.ok ? minimum.minor : 0;
    const final = index === months - 1;
    const payment = final ? debt : Math.min(debt, contractual);
    if (plan.arrangement === "fixed" && final && Math.abs(debt - contractual) > months) unusualFinal = true;
    if (!final && contractual < interest) insufficientInterest = true;
    if (debt === 0 && plan.monthlyFeeMinor === 0) break;
    const applied = simulate({ model, anchor, events: payment > 0 ? [{ kind: "repayment", date, amountMinor: payment, ref: { source: "assumption", id: `${plan.id}:${index}` } }] : [], to: date, options: { generateScheduledRepayments: false, applyAssumptions: false } });
    if (!applied.ok) return { calculated: false as const, rows: [], reason: applied.blocked.map((entry) => entry.message).join(" ") };
    const fee = sumMinor([plan.monthlyFeeMinor, index === 0 ? plan.upfrontFeeMinor : 0]);
    rows.push({ index: index + 1, date, amountMinor: sumMinor([payment, fee]), principalMinor: Math.max(0, payment - interest), interestMinor: interest, feeMinor: fee, final });
    interestMinor = sumMinor([interestMinor, interest]);
    anchor = { ...applied.closing, source: "expected-plan-only" };
  }
  return { calculated: true as const, unusualFinal, insufficientInterest, warning: unusualFinal ? "The entered amount, term, rate and monthly instalment do not agree. Review the final amount; it is more than a rounding adjustment." : insufficientInterest ? "The monthly amount does not cover accrued interest; the debt grows." : null, rows, principalMinor: principal, interestMinor, upfrontFeeMinor: plan.upfrontFeeMinor, monthlyFeesMinor: sumMinor(rows.map((entry) => entry.feeMinor ?? 0)) - plan.upfrontFeeMinor, totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)), reason: plan.arrangement === "minimum-deadline" ? "Daily simple Actual/365 minimum estimate; fees are separate and the final payment clears the remainder. Unpaid billed interest can capitalize in this illustration." : plan.includesCosts ? "Daily simple Actual/365 estimate (unpaid billed interest can capitalize); monthly amount includes interest and monthly fees. Upfront fee is shown separately on the first due date." : "Daily simple Actual/365 estimate (unpaid billed interest can capitalize); interest and fees are added to the principal instalment. Final payment clears the estimated remainder." };
}
export function planSources(plan: RepaymentPlan) {
  return plan.sourceTransactions;
}
export function planForTransaction(workspace: Workspace, transactionId: string) {
  return workspace.plans?.find((plan) => planSources(plan).some((source) => source.transactionId === transactionId)) ?? workspace.plans?.find((plan) => workspace.planLinks?.some((link) => link.transactionId === transactionId && link.planId === plan.id));
}
export function currentPlanLink(workspace: Workspace, row: ActivityRow): PlanLink | undefined {
  return workspace.planLinks?.find((link) => link.transactionId === row.id && link.fingerprint === row.fingerprint);
}
export function planHealth(plan: RepaymentPlan, workspace: Workspace, snapshot: ActivitySnapshot, today: string, available = true) {
  const reasons: string[] = [];
  const index = trackingRowIndex(snapshot);
  if (!available) reasons.push("Refresh Actual activity");
  if (planSources(plan).some((source) => index.get(source.transactionId)?.fingerprint !== source.fingerprint)) reasons.push("Check the original transaction link");
  const links = workspace.planLinks?.filter((link) => link.planId === plan.id) ?? [];
  if (links.some((link) => index.get(link.transactionId)?.fingerprint !== link.fingerprint)) reasons.push("Check this link: an Actual entry changed or is unavailable");
  if (plan.tracking) {
    const card = workspace.cards.find((entry) => entry.id === plan.cardId);
    if (card && hasTrackingCostTransfer(plan, card, workspace, snapshot, today)) reasons.push(TRACKING_COST_PROBLEM);
    const balance = trackingBalance(plan, snapshot, today, workspace.planLinks);
    if (!balance) reasons.push("Load the plan account history");
    if (plan.status !== "active" && balance && balance.signedMinor < 0) reasons.push("Principal remains in the plan account");
    if (links.some((link) => { const row = index.get(link.transactionId); return row?.transferId && !trackingTransferMatches(row, plan, snapshot); })) reasons.push("Check this plan transfer link");
  }
  if (plan.refundReview && links.some((link) => link.role === "refund") && plan.refundReview.signature !== refundEvidenceSignature(links)) reasons.push("Review the updated refund");
  if (plan.status === "active" && available && !plan.balanceOnly && plan.recording !== "retained" && ["fixed", "minimum-deadline"].includes(plan.arrangement)) {
    const card = workspace.cards.find((entry) => entry.id === plan.cardId)!;
    const missing = planSchedule(plan, card, links).filter((entry) => entry.date < today && entry.date > (plan.opening?.date ?? "0000-00-00") && entry.date >= snapshot.from && entry.date <= snapshot.to && !links.some((link) => ["instalment-billed", "combined-instalment"].includes(link.role) && link.instalment === entry.index && index.get(link.transactionId)?.fingerprint === link.fingerprint));
    if (missing.length) reasons.push(`Check expected posting: ${missing.length} not linked`);
  }
  return { status: reasons.length ? "Needs review" : plan.status === "completed" ? "Completed" : plan.status === "cancelled" ? "Cancelled" : "Active", reasons, pending: links.some((link) => index.get(link.transactionId)?.cleared !== true) };
}

/** Exact evidence acknowledgement. A changed/new refund reopens review. */
export function refundEvidenceSignature(links: PlanLink[]) {
  return evidenceHash(links.filter((link) => link.role === "refund").map((link) => [link.transactionId, link.fingerprint]).sort((a, b) => a[0].localeCompare(b[0])));
}

/** User-confirmed remaining totals override expectations only; billed history and Actual balances stay intact. */
export function planSchedule(plan: RepaymentPlan, card: Card, links: PlanLink[]) {
  const projection = planProjection(plan, card);
  const review = plan.refundReview;
  if (!review || review.signature !== refundEvidenceSignature(links) || review.treatment !== "revised") return projection.rows;
  return projection.rows.map((entry) => {
    if (links.some((link) => ["instalment-billed", "combined-instalment"].includes(link.role) && link.instalment === entry.index)) return entry;
    const revised = review.remaining.find((row) => row.index === entry.index);
    return revised ? { ...entry, date: revised.date, amountMinor: revised.amountMinor, principalMinor: null, interestMinor: null, feeMinor: null } : entry;
  });
}

/** Suggested matches require user confirmation. All money comparisons use integer minor units. */
export function suggestPlanLink(row: ActivityRow, plan: RepaymentPlan, card: Card, links: PlanLink[], snapshot?: ActivitySnapshot, workspace: Pick<Workspace, "classifications" | "planLinks"> = { classifications: [], planLinks: links }) {
  if (planSources(plan).some((source) => source.transactionId === row.id) || row.amountMinor === 0 || row.date < plan.startDate || links.some((link) => link.transactionId === row.id)) return null;
  if (row.transferId && (!snapshot || !trackingTransferMatches(row, plan, snapshot))) return null;
  const cost = financingCostKind(row, card, workspace);
  if (cost && row.transferId) return null;
  const text = `${row.label} ${row.notes ?? ""}`.toLowerCase();
  const reference = Boolean(plan.tracking?.tag && hasPlanTag(row.notes, plan.tracking.tag) || plan.reference && text.includes(plan.reference.toLowerCase()));
  const bonus = reference ? 35 : 0;
  const reason = (label: string) => reference ? `Plan reference matches · ${label}` : label;
  if (cost) return { role: cost === "interest" ? "plan-interest" as const : "plan-fee" as const, instalment: null, reason: reason(`Identified ${cost}; check the plan`), score: 45 + bonus };
  if (row.amountMinor > 0) {
    if (/refund|credit note/i.test(text)) return reference ? { role: "refund" as const, instalment: null, reason: "Refund with matching plan reference", score: 95 } : null;
    return row.amountMinor === plan.amountMinor && !links.some((link) => link.role === "conversion-credit") ? { role: "conversion-credit" as const, instalment: null, reason: reason("Matches converted principal"), score: 70 + bonus } : null;
  }
  const amount = -row.amountMinor;
  const matches = planSchedule(plan, card, links).filter((entry) => row.date <= entry.date && row.date >= addMonths(entry.date, -1) && [entry.amountMinor, ...(entry.principalMinor === null || entry.interestMinor === null ? [] : [entry.principalMinor, sumMinor([entry.principalMinor, entry.interestMinor])])].includes(amount));
  if (matches.length) return { role: row.transferId || /\bprincipal\b/i.test(text) ? "instalment-billed" as const : "combined-instalment" as const, instalment: matches[0].index, reason: reason(matches.length > 1 ? "Amount matches several periods; choose one" : `Matches instalment ${matches[0].index} amount and period`), score: 65 + bonus };
  if (reference) return { role: row.transferId ? "instalment-billed" as const : "combined-instalment" as const, instalment: null, reason: "Plan reference matches; check the amount and period", score: 70 };
  return null;
}

/** Opening-aware expectations; earlier periods are history, not missing postings. */
export function planProgress(plan: RepaymentPlan, card: Card, links: PlanLink[]) {
  const rows = planSchedule(plan, card, links);
  const tracked = rows.filter((entry) => !plan.opening || entry.date > plan.opening.date);
  const billed = new Set(links.filter((link) => ["instalment-billed", "combined-instalment"].includes(link.role)).map((link) => link.instalment));
  return { rows, tracked, earlier: rows.length - tracked.length, billedCount: tracked.filter((entry) => billed.has(entry.index)).length, next: tracked.find((entry) => !billed.has(entry.index)), totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)), revised: rows.some((entry) => entry.principalMinor === null) };
}
