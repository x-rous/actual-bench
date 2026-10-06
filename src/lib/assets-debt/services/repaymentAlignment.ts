import { alignPayments, evaluateCandidate, structuralUnsafeReasons, type AlignDue, type AlignedDue, type AlignPayment, type AlignPin, type CandidateEvaluation, type MatchCandidate, type MatchConditionsV1, type PeriodMatchEvaluation } from "@/lib/financial-models/matching";
import type { PostingOutputSnapshot } from "./snapshot";

/**
 * Which payments are this loan's repayments, and which due date each one settles, in one pass
 * (owner decision 2026-10-07). Shared by Sync Repayments and the matching check, so they cannot
 * disagree.
 *
 * A loan's payments are:
 * - every transfer into the loan account (the loan account is the statement), seen from the side
 *   it was paid from, with no date or amount limit; and
 * - whatever the repayment rule identifies by payee, bank text, notes, category or amount, any day;
 *   a rule that only names an account and days keeps identifying payments by those days (it would
 *   otherwise take every payment from the account).
 * They are then lined up against the due dates (`alignPayments`): no day window, no amount filter.
 */

export type RepaymentAlignment = {
  /** The match for one due date, in the shape the planners already use; null when not aligned. */
  evaluation(key: string): PeriodMatchEvaluation | null;
  aligned(key: string): AlignedDue | null;
  extras: AlignPayment[];
  /** Every payment counted as the loan's, oldest first. */
  payments: AlignPayment[];
  /** The due date a payment is paired with, or null (extra). */
  pairedTo(paymentId: string): string | null;
};

const DATE_KINDS = new Set(["expected-date", "day-of-month"]);
const IDENTITY_KINDS = new Set(["payee", "imported-payee", "notes", "category"]);

/** Whether a rule says what the payment looks like; "any amount" (only a direction) does not. */
function identifies(rule: MatchConditionsV1): boolean {
  return rule.items.some((item) => IDENTITY_KINDS.has(item.kind)
    || (item.kind === "amount" && (item.operator !== "between" || item.maxMinor < Number.MAX_SAFE_INTEGER)));
}

/** The payment an applied change settled for its due date, and when it was paid. */
export function settledPaymentOf(output: PostingOutputSnapshot): { paymentId: string; date: string } | null {
  switch (output.kind) {
    case "restructure": return { paymentId: output.before.id, date: output.before.date };
    case "claim": return output.recordedSplit ? { paymentId: output.recordedSplit.parent.id, date: output.recordedSplit.parent.date } : output.rows[0] ? { paymentId: output.rows[0].id, date: output.rows[0].date } : null;
    case "adjust-split": return { paymentId: output.parent.id, date: output.parent.date };
    case "link": return { paymentId: output.sourceBefore.id, date: output.sourceBefore.date };
    case "convert": return { paymentId: output.before.id, date: output.before.date };
    default: return null;
  }
}

/** The paying side of a loan-side transfer row (or the split it belongs to); the row itself otherwise. */
export function payingSide(candidates: readonly MatchCandidate[], matched: MatchCandidate, liabilityAccountId: string | null): MatchCandidate | null {
  if (matched.accountId !== liabilityAccountId || !matched.transferId) return matched;
  const other = candidates.find((c) => c.id === matched.transferId);
  return other?.isChild && other.parentId ? candidates.find((c) => c.id === other.parentId) ?? null : other ?? null;
}

export function alignRepayments(input: {
  candidates: readonly MatchCandidate[];
  liabilityAccountId: string | null;
  signConvention: "negative-is-debt" | "positive-is-debt";
  rule: MatchConditionsV1 | undefined;
  dues: AlignDue[];
  pins: AlignPin[];
  toleranceMinor: number;
  minorDigits: number;
}): RepaymentAlignment {
  const { candidates, liabilityAccountId } = input;
  const claimable = candidates.filter((c) => !c.benchMarked && !c.postingLinked);
  const reduces = (amount: number) => (input.signConvention === "positive-is-debt" ? amount < 0 : amount > 0);
  const payments = new Map<string, MatchCandidate>();
  const add = (c: MatchCandidate) => {
    // When the paying side was not read, the loan-side row stands in (the row then says why it cannot be split).
    const side = payingSide(candidates, c, liabilityAccountId) ?? c;
    if (side.benchMarked || side.postingLinked || payments.has(side.id)) return;
    payments.set(side.id, side);
  };
  for (const c of claimable) {
    if (c.accountId === liabilityAccountId && !c.isChild && c.transferId && reduces(c.amountMinor)) add(c);
  }
  const rule = input.rule;
  if (rule && identifies(rule)) {
    // The rule says what the payment looks like: any day counts.
    const identity: MatchConditionsV1 = { ...rule, items: rule.items.filter((item) => !DATE_KINDS.has(item.kind)) };
    const any = { periodKey: "", date: "0001-01-01", paymentMinor: 0 };
    for (const c of claimable) if (evaluateCandidate(identity, c, any).matches) add(c);
  } else if (rule) {
    // A rule that only names an account and days: its days are all that identify the payment, so a
    // payment counts when it fits the rule around some due date (as before); which due date it
    // settles is still decided by the alignment.
    for (const c of claimable) {
      if (input.dues.some((d) => evaluateCandidate(rule, c, { periodKey: d.key, date: d.date, paymentMinor: d.expectedMinor }).matches)) add(c);
    }
  }
  const digits = input.minorDigits;
  const result = alignPayments(
    { dues: input.dues, payments: [...payments.values()].map((c) => ({ id: c.id, date: c.date, amountMinor: Math.abs(c.amountMinor) })), pins: input.pins },
    { toleranceMinor: input.toleranceMinor, formatMinor: (minor) => (minor / 10 ** digits).toFixed(digits) },
  );
  const byKey = new Map(result.dues.map((d) => [d.key, d]));
  const pairs = new Map(result.dues.flatMap((d) => (d.payment && !d.settled ? [[d.payment.id, d.key] as const] : [])));
  const listed = [...payments.values()].map((c) => ({ id: c.id, date: c.date, amountMinor: Math.abs(c.amountMinor) })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const strength = "strong" as const;
  return {
    extras: result.extras,
    payments: listed,
    pairedTo: (id) => pairs.get(id) ?? null,
    aligned: (key) => byKey.get(key) ?? null,
    evaluation: (key) => {
      const d = byKey.get(key);
      if (!d) return null;
      const expected = { periodKey: d.key, date: d.date, paymentMinor: d.expectedMinor };
      const candidate = d.payment ? payments.get(d.payment.id) : undefined;
      if (!d.payment || !candidate || d.settled) return { expected, status: "missing", candidates: [], strength, reviewReasons: d.reasons.map((r) => r.text) };
      const unsafe = structuralUnsafeReasons(candidate);
      const evaluated: CandidateEvaluation = { candidate, matches: true, unsafeReasons: unsafe, deviation: { amountMinor: Math.abs(candidate.amountMinor) - d.expectedMinor, days: d.daysFromDue ?? 0 } };
      return { expected, status: unsafe.length ? "unsafe" : "unique", candidates: [evaluated], strength, reviewReasons: d.reasons.map((r) => r.text) };
    },
  };
}
