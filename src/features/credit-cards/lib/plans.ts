import { addDays, addMonths, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { simulate } from "@/lib/financial-models/loan/projection";
import { revolvingPayment } from "@/lib/financial-models/loan/revolving";
import type { Anchor } from "@/lib/financial-models/loan/model";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { cardModel } from "./financialAdapter";
import { sumMinor } from "./statements";
import { formatCardMonth } from "./displayDates";
import { costFamilyOf } from "./derive/families";
import { planEntriesFor } from "./derive/indexes";
import { hasPlanTag, peerOf, planLedger, planPrincipal, rowIndex, transferPairKey } from "./derive/planAccounts";
import { activityKind } from "./derive/types";
import type { Card, PlanEntry, PlanEntryRole, RepaymentPlan, Workspace } from "./models";
import type { ActivityRow, ActivitySnapshot } from "./activity";

export const roleLabels: Record<PlanEntryRole, string> = {
  original: "Original purchase",
  instalment: "Instalment billed",
  conversion: "Conversion",
  settlement: "Early settlement",
  cost: "Plan fee or interest",
  refund: "Refund",
  adjustment: "Plan adjustment",
};

/** Expected totals and components in integer minor units. */
export type ExpectedInstalment = {
  index: number;
  date: string;
  amountMinor: number;
  principalMinor: number;
  interestMinor: number;
  feeMinor: number;
  final: boolean;
};

type Projection =
  | { calculated: false; rows: ExpectedInstalment[]; reason: string }
  | {
    calculated: true;
    rows: ExpectedInstalment[];
    reason: string;
    warning: string | null;
    principalMinor: number;
    interestMinor: number;
    upfrontFeeMinor: number;
    monthlyFeesMinor: number;
    totalMinor: number;
  };

const notCalculated = (reason: string): Projection => ({ calculated: false, rows: [], reason });

const projections = new WeakMap<RepaymentPlan, WeakMap<Card, Projection>>();

/**
 * The expected schedule, computed once per plan and card (D5) with the shared daily engine.
 * Never creates Actual events or balances. Plans and cards are immutable, so the cache holds.
 */
export function planProjection(plan: RepaymentPlan, card: Card): Projection {
  let byCard = projections.get(plan);
  if (!byCard) {
    byCard = new WeakMap();
    projections.set(plan, byCard);
  }
  let result = byCard.get(card);
  if (!result) {
    result = calculateProjection(plan, card);
    byCard.set(card, result);
  }
  return result;
}

const basisLabel = (card: Card) => (card.interestModel === "daily-simple-360" ? "Actual/360" : "Actual/365");

function calculateProjection(plan: RepaymentPlan, card: Card): Projection {
  if (plan.scheduleKind === null) return notCalculated("Balance only; no schedule");
  if (plan.scheduleKind === "promotional") return notCalculated("Promotional terms; no instalment schedule");
  const principal = plan.originalAmountMinor ?? plan.opening?.principalMinor ?? null;
  const months = plan.instalmentCount;
  const firstDueDate = plan.firstDueDate;
  const startDate = plan.originalAmountMinor !== null ? plan.startDate : plan.opening?.date ?? plan.startDate;
  if (principal === null || months === null || firstDueDate === null || startDate === null) {
    return notCalculated("Enter the principal, start and schedule");
  }
  const dueDay = parseIsoDate(firstDueDate).day;
  const monthly = plan.instalmentMinor ?? 0;
  // A fixed amount that includes costs describes a contract total, not an amortisation rate.
  if (plan.scheduleKind === "fixed" && plan.includesCosts) {
    const monthlyFeesMinor = sumMinor(Array.from({ length: months }, () => plan.monthlyFeeMinor));
    const contractualMinor = sumMinor(Array.from({ length: months }, () => monthly));
    const difference = contractualMinor - principal - monthlyFeesMinor;
    if (difference < -months) {
      return notCalculated("The monthly amounts do not cover the principal and included fees. Correct the amount or term.");
    }
    const financeMinor = Math.max(0, difference);
    let principalLeft = principal;
    let financeLeft = financeMinor;
    const rows: ExpectedInstalment[] = [];
    for (let index = 0; index < months; index++) {
      const final = index === months - 1;
      const available = monthly - plan.monthlyFeeMinor;
      const interestMinor = final ? financeLeft : Math.min(available, Math.ceil(financeLeft / (months - index)));
      const principalMinor = final ? principalLeft : Math.min(principalLeft, available - interestMinor);
      const feeMinor = sumMinor([plan.monthlyFeeMinor, index === 0 ? plan.upfrontFeeMinor : 0]);
      rows.push({
        index: index + 1,
        date: addMonths(firstDueDate, index, dueDay),
        amountMinor: sumMinor([principalMinor, interestMinor, feeMinor]),
        principalMinor,
        interestMinor,
        feeMinor,
        final,
      });
      principalLeft -= principalMinor;
      financeLeft -= interestMinor;
    }
    return {
      calculated: true,
      rows,
      warning: null,
      principalMinor: principal,
      interestMinor: financeMinor,
      upfrontFeeMinor: plan.upfrontFeeMinor,
      monthlyFeesMinor,
      totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)),
      reason: "Fixed contract: the monthly amount and term set the total finance cost. The final amount adjusts rounding.",
    };
  }
  const rows: ExpectedInstalment[] = [];
  // PL-15: the card's day-count basis.
  const model = cardModel({ ...card, purchaseAprBps: plan.aprBps, closingDay: dueDay }, startDate, principal);
  model.terms.creditLimitMinor = null;
  model.terms.firstInterestChargeDate = firstDueDate;
  model.profile.negativeAmortizationAllowed = true;
  let anchor: Anchor = { date: startDate, principalMinor: principal, accruedInterestMinor: 0, source: "expected-plan-only" };
  let interestTotal = 0;
  let unusualFinal = false;
  let insufficientInterest = false;
  const options = { generateScheduledRepayments: false, applyAssumptions: false };
  for (let index = 0; index < months; index++) {
    const date = addMonths(firstDueDate, index, dueDay);
    const preview = simulate({ model, anchor, events: [], to: date, options });
    if (!preview.ok) return notCalculated(preview.blocked.map((entry) => entry.message).join(" "));
    const accrued = sumMinor([...preview.events.map((entry) => entry.interestMinor), preview.closing.accruedInterestMinor]);
    const interest = accrued - (anchor.accruedInterestMinor ?? 0);
    const debt = sumMinor([preview.closing.principalMinor, preview.closing.accruedInterestMinor]);
    const minimum = revolvingPayment(
      { paymentModel: "percent-of-balance", percentOfBalanceBps: plan.minimumPercentBps, minimumFloorMinor: plan.minimumFloorMinor },
      { balanceMinor: debt, lastChargeMinor: interest, contractualPaymentMinor: null, minorDigits: 2, mode: "half-up" },
    );
    const fixedPayment = plan.includesCosts ? Math.max(0, monthly - plan.monthlyFeeMinor) : sumMinor([monthly, interest]);
    const contractual = plan.scheduleKind === "fixed" ? fixedPayment : minimum.ok ? minimum.minor : 0;
    const final = index === months - 1;
    const payment = final ? debt : Math.min(debt, contractual);
    if (plan.scheduleKind === "fixed" && final && Math.abs(debt - contractual) > months) unusualFinal = true;
    if (!final && contractual < interest) insufficientInterest = true;
    if (debt === 0 && plan.monthlyFeeMinor === 0) break;
    const events = payment > 0
      ? [{ kind: "repayment" as const, date, amountMinor: payment, ref: { source: "assumption" as const, id: `${plan.id}:${index}` } }]
      : [];
    const applied = simulate({ model, anchor, events, to: date, options });
    if (!applied.ok) return notCalculated(applied.blocked.map((entry) => entry.message).join(" "));
    const fee = sumMinor([plan.monthlyFeeMinor, index === 0 ? plan.upfrontFeeMinor : 0]);
    rows.push({
      index: index + 1,
      date,
      amountMinor: sumMinor([payment, fee]),
      principalMinor: Math.max(0, payment - interest),
      interestMinor: interest,
      feeMinor: fee,
      final,
    });
    interestTotal = sumMinor([interestTotal, interest]);
    anchor = { ...applied.closing, source: "expected-plan-only" };
  }
  const warning = unusualFinal
    ? "The amount, term, rate and monthly instalment do not agree; the final amount is more than a rounding adjustment."
    : insufficientInterest ? "The monthly amount does not cover accrued interest; the debt grows." : null;
  return {
    calculated: true,
    rows,
    warning,
    principalMinor: principal,
    interestMinor: interestTotal,
    upfrontFeeMinor: plan.upfrontFeeMinor,
    monthlyFeesMinor: sumMinor(rows.map((entry) => entry.feeMinor)) - plan.upfrontFeeMinor,
    totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)),
    reason: `Daily simple ${basisLabel(card)} estimate; ${plan.scheduleKind === "minimum-deadline"
      ? "the final payment clears the remainder."
      : plan.includesCosts ? "the monthly amount includes interest and monthly fees." : "interest and fees are added to each instalment."}`,
  };
}

export const planSchedule = (plan: RepaymentPlan, card: Card) => planProjection(plan, card).rows;

const amountIndexes = new WeakMap<ExpectedInstalment[], Map<number, ExpectedInstalment[]>>();
/** Expected instalments by every amount a posting may carry: total, principal, principal + interest. */
function scheduleByAmount(rows: ExpectedInstalment[]) {
  let index = amountIndexes.get(rows);
  if (!index) {
    index = new Map();
    for (const entry of rows) {
      const amounts = new Set([entry.amountMinor, entry.principalMinor, sumMinor([entry.principalMinor, entry.interestMinor])]);
      for (const amount of amounts) index.set(amount, [...(index.get(amount) ?? []), entry]);
    }
    amountIndexes.set(rows, index);
  }
  return index;
}

export type PlanSuggestion = { role: PlanEntryRole; instalmentNumber: number | null; reason: string; score: number };

/**
 * A suggested entry for one card row: a cheap lookup against the cached schedule. Suggestions
 * always need confirmation. Plan-account transfers are owned structurally and never suggested.
 */
export function suggestPlanLink(row: ActivityRow, plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot): PlanSuggestion | null {
  if (row.amountMinor === 0 || (plan.startDate && row.date < plan.startDate)) return null;
  if (planEntriesFor(workspace, row.id).length || row.transferId) return null;
  const kind = activityKind(row, card, workspace, snapshot);
  const text = `${row.label} ${row.notes ?? ""}`.toLowerCase();
  const tagged = Boolean(plan.planAccountTag && hasPlanTag(row.notes, plan.planAccountTag));
  const named = tagged || text.includes(plan.name.toLowerCase());
  const bonus = named ? 35 : 0;
  const reason = (label: string) => (named ? `Plan name matches · ${label}` : label);
  // A fee or interest charge is the plan's only when it names the plan or matches one of its expected fees;
  // any other card fee after the start is not evidence.
  if (costFamilyOf(kind)) {
    const expected = [plan.upfrontFeeMinor, plan.monthlyFeeMinor].filter((fee) => fee > 0);
    if (!named && !expected.includes(-row.amountMinor)) return null;
    return { role: "cost", instalmentNumber: null, reason: reason(named ? `Plan ${kind}` : `Matches the plan's ${kind}`), score: 45 + bonus };
  }
  if (row.amountMinor > 0) {
    if (kind === "refund") return named ? { role: "refund", instalmentNumber: null, reason: "Refund naming this plan", score: 95 } : null;
    const converted = row.amountMinor === plan.originalAmountMinor;
    return converted ? { role: "conversion", instalmentNumber: null, reason: reason("Matches the original amount"), score: 70 + bonus } : null;
  }
  const candidates = scheduleByAmount(planSchedule(plan, card)).get(-row.amountMinor) ?? [];
  const matches = candidates.filter((entry) => row.date <= entry.date && row.date >= addMonths(entry.date, -1));
  if (matches.length) {
    const label = matches.length > 1 ? "Amount matches several periods; choose one" : `Matches instalment ${matches[0].index}`;
    return { role: "instalment", instalmentNumber: matches[0].index, reason: reason(label), score: 65 + bonus };
  }
  return named ? { role: "instalment", instalmentNumber: null, reason: "Plan name matches; check the amount", score: 70 } : null;
}

/** Billed instalments: principal moved back to the card from the plan account, or card entries. */
export function planProgress(plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot | undefined) {
  const rows = planSchedule(plan, card);
  const tracked = rows.filter((entry) => !plan.opening || entry.date > plan.opening.date);
  let billed: string[] = [];
  if (plan.recordedAs === "plan-account" && snapshot) {
    const ledger = planLedger(card, workspace, snapshot);
    // A positive plan-account row whose peer is on the card is principal billed back (one per cycle).
    billed = (ledger.rowsByPlan.get(plan.id) ?? [])
      .filter((row) => row.amountMinor > 0 && peerOf(row, snapshot)?.accountId === card.accountId)
      .map((row) => row.date.slice(0, 7));
  } else {
    const index = snapshot ? rowIndex(snapshot).rows : new Map<string, ActivityRow>();
    billed = workspace.planEntries
      .filter((entry) => entry.planId === plan.id && entry.role === "instalment")
      .map((entry) => index.get(entry.transactionId)?.date.slice(0, 7) ?? entry.transactionId);
  }
  const billedCount = Math.min(tracked.length || Infinity, new Set(billed).size);
  return {
    rows,
    tracked,
    earlier: rows.length - tracked.length,
    billedCount,
    next: tracked[billedCount],
    totalMinor: sumMinor(rows.map((entry) => entry.amountMinor)),
  };
}

/** Principal still owed from the plan terms alone, for plans not recorded in Actual (PL-11). */
export function planTermsRemaining(plan: RepaymentPlan, card: Card, today: string) {
  if (plan.recordedAs === "plan-account") return null;
  const projection = planProjection(plan, card);
  if (!projection.calculated) return null;
  const left = projection.rows.filter((entry) => entry.date > today).map((entry) => entry.principalMinor);
  return sumMinor(left);
}

export type PlanStatusKey =
  | "on-track"
  | "waiting-for-conversion"
  | "instalment-not-seen"
  | "cost-moved"
  | "changed"
  | "finished-with-balance"
  | "finished"
  | "cancelled"
  | "waiting-for-data";

export type PlanStatus = {
  key: PlanStatusKey;
  label: string;
  /** "On track", "Finished" and "Cancelled" need nothing; every other state is a check. */
  check: boolean;
  /** Principal in the plan account (plan-account plans), positive owed; null when unknown. */
  principalMinor: number | null;
  detail: string;
};

/** §8.4 plan status, always visible as text. A check never hides Total owed (D22). */
export function planStatus(plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot | undefined, today: string): PlanStatus {
  const status = (key: PlanStatusKey, label: string, detail = "", principalMinor: number | null = null): PlanStatus => ({
    key, label, detail, principalMinor, check: !["on-track", "finished", "cancelled"].includes(key),
  });
  if (!snapshot) return status("waiting-for-data", "Waiting for Actual data");
  const principal = planPrincipal(plan, card, workspace, snapshot, today);
  if (plan.recordedAs === "plan-account" && principal === null) {
    return status("waiting-for-data", "Waiting for Actual data", "Refresh to read the plan account");
  }
  if (plan.status !== "active") {
    if (principal) return status("finished-with-balance", `Finished · ${formatAmount(principal, 2)} still in plan account`, "", principal);
    return plan.status === "completed" ? status("finished", "Finished", "", principal) : status("cancelled", "Cancelled", "", principal);
  }
  const index = rowIndex(snapshot).rows;
  const entries = workspace.planEntries.filter((entry) => entry.planId === plan.id);
  if (entries.some((entry) => {
    const row = index.get(entry.transactionId);
    return row && row.identity !== entry.identityHash;
  })) {
    return status("changed", "Changed in Actual", "A linked transaction changed type or account", principal);
  }
  if (plan.recordedAs === "plan-account") {
    const ledger = planLedger(card, workspace, snapshot);
    const owned = ledger.rowsByPlan.get(plan.id) ?? [];
    if (owned.some((row) => entries.some((entry) => entry.role === "cost" && entry.transactionId === (peerOf(row, snapshot)?.id ?? row.id)))) {
      return status("cost-moved", "Fee or interest moved into plan account", "Fees and interest are expenses; only principal moves", principal);
    }
    if (!owned.length && !plan.opening) {
      const amount = plan.originalAmountMinor;
      const account = snapshot.accounts?.find((entry) => entry.id === plan.planAccountId)?.name ?? "the plan account";
      return status("waiting-for-conversion", "Waiting for conversion",
        `In Actual, move ${amount ? formatAmount(amount, 2) : "the principal"} from ${account} to the card`, principal);
    }
    // A shared account's other contents (other cards, plans not added yet, untagged transfers) never mark
    // this plan: this card's entries without a plan show once on the Plans tab and in Needs attention.
    if (principal === 0 && owned.length) {
      return status("on-track", "On track", `${plan.name} is fully moved back to the card. Mark it finished?`, principal);
    }
  }
  const progress = planProgress(plan, card, workspace, snapshot);
  const due = progress.next;
  if (due && addDays(due.date, 5) < today && due.date >= snapshot.from) {
    const month = formatCardMonth(due.date).split(" ")[0];
    return status("instalment-not-seen", `${month} instalment not seen`, "Due date + 5 days passed with no movement", principal);
  }
  return status("on-track", "On track", "", principal);
}

/** A new plan entry for a card row, with its transfer pair key and hashes. */
export function planEntryFor(planId: string, row: ActivityRow, role: PlanEntryRole, instalmentNumber: number | null = null): PlanEntry {
  return {
    planId,
    transactionId: row.id,
    role,
    instalmentNumber: role === "instalment" ? instalmentNumber : null,
    transferPairKey: transferPairKey(row),
    identityHash: row.identity,
    sourceHash: row.fingerprint,
  };
}
