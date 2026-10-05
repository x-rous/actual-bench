import { addDays, compareDates, daysBetween, type IsoDate } from "../calendar/dates";
import { matchRuleStrength, type MatchConditionV1, type MatchConditionsV1, type MatchRuleStrength } from "./dsl";

export type MatchCandidate = {
  id: string;
  /** False when a transport returned a split child without its own stable id. */
  stableId?: boolean;
  parentId: string | null;
  accountId: string;
  date: IsoDate;
  amountMinor: number;
  payeeId: string | null;
  importedPayee: string | null;
  notes: string | null;
  categoryId: string | null;
  cleared?: boolean;
  reconciled?: boolean;
  transferId?: string | null;
  isParent: boolean;
  isChild?: boolean;
  benchMarked: boolean;
  postingLinked: boolean;
  /**
   * An existing split of exactly one transfer part plus other parts: a repayment already split in
   * Actual, which can be recorded as it is (owner decision 2026-10-06), so it is not unsafe.
   */
  loanSplit?: boolean;
};

export type ExpectedMatchPeriod = {
  periodKey: string;
  date: IsoDate;
  paymentMinor: number;
  balanceAfterMinor?: number | null;
  fromOffsetMinor?: number;
  otherFundsMinor?: number;
  principalMinor?: number;
  interestMinor?: number;
  feesMinor?: number;
};

export type MatchDeviation = { amountMinor: number; days: number };
export type CandidateEvaluation = {
  candidate: MatchCandidate;
  matches: boolean;
  unsafeReasons: string[];
  deviation: MatchDeviation;
};

export type PeriodMatchStatus = "missing" | "unique" | "multiple" | "unsafe";
export type PeriodMatchEvaluation = {
  expected: ExpectedMatchPeriod;
  status: PeriodMatchStatus;
  candidates: CandidateEvaluation[];
  strength: MatchRuleStrength;
  reviewReasons: string[];
};

export function normalizeMatchText(value: string | null): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const magnitude = (amount: number): number => Math.abs(amount);

function directionMatches(amount: number, direction: "outflow" | "inflow" | "either"): boolean {
  return direction === "either" || (direction === "outflow" ? amount < 0 : amount > 0);
}

function amountMatches(condition: Extract<MatchConditionV1, { kind: "amount" }>, candidate: MatchCandidate): boolean {
  if (!directionMatches(candidate.amountMinor, condition.direction)) return false;
  const actual = magnitude(candidate.amountMinor);
  if (condition.operator === "exact") return actual === condition.amountMinor;
  if (condition.operator === "between") return actual >= condition.minMinor && actual <= condition.maxMinor;
  const difference = BigInt(Math.abs(actual - condition.amountMinor));
  return condition.tolerance.kind === "absolute"
    ? difference <= BigInt(condition.tolerance.amountMinor)
    : difference * BigInt(10_000) <= BigInt(condition.amountMinor) * BigInt(condition.tolerance.bps);
}

function textMatches(actual: string | null, operator: "exact" | "contains" | "one-of", value: string | string[]): boolean {
  const normalized = normalizeMatchText(actual);
  const values = (Array.isArray(value) ? value : [value]).map(normalizeMatchText);
  return operator === "contains" ? normalized.includes(values[0] ?? "") : values.includes(normalized);
}

function conditionMatches(condition: MatchConditionV1, candidate: MatchCandidate, expected: ExpectedMatchPeriod): boolean {
  switch (condition.kind) {
    case "source-account": return candidate.accountId === condition.accountId;
    case "payee": return condition.operator === "exact" ? candidate.payeeId === condition.payeeId : candidate.payeeId !== null && condition.payeeIds.includes(candidate.payeeId);
    case "imported-payee": return textMatches(candidate.importedPayee, condition.operator, condition.operator === "one-of" ? condition.values : condition.value);
    case "notes": return textMatches(candidate.notes, condition.operator, condition.value);
    case "amount": return amountMatches(condition, candidate);
    case "expected-date": return compareDates(candidate.date, addDays(expected.date, -condition.daysBefore)) >= 0 && compareDates(candidate.date, addDays(expected.date, condition.daysAfter)) <= 0;
    case "day-of-month": return Number(candidate.date.slice(8, 10)) === condition.day;
    case "cleared-state": return condition.value === "any" || candidate.cleared === undefined || candidate.cleared === (condition.value === "cleared");
    case "reconciled-state": return condition.value === "any" || candidate.reconciled === undefined || candidate.reconciled === (condition.value === "reconciled");
    case "category": return condition.operator === "empty" ? candidate.categoryId === null : condition.operator === "exact" ? candidate.categoryId === condition.categoryId : candidate.categoryId !== null && condition.categoryIds.includes(candidate.categoryId);
    case "transfer-state": return candidate.transferId === undefined || (condition.value === "present" ? candidate.transferId !== null : candidate.transferId === null);
    case "split-state": return condition.value === "parent" ? candidate.isParent : condition.value === "child" ? candidate.isChild === true : !candidate.isParent && candidate.isChild !== true;
    case "bench-marker": return !candidate.benchMarked;
    case "posting-link": return !candidate.postingLinked;
  }
}

function unsafeReasons(candidate: MatchCandidate, conditions: MatchConditionsV1, expected: ExpectedMatchPeriod): string[] {
  const reasons: string[] = [];
  if (candidate.stableId === false) reasons.push("missing-stable-child-id");
  if (candidate.isParent && !candidate.loanSplit) reasons.push("split-parent-unclaimable");
  if (candidate.parentId !== null && candidate.isChild !== true) reasons.push("missing-child-structure");
  if (conditions.items.some((item) => item.kind === "transfer-state") && candidate.transferId === undefined) reasons.push("transfer-state-unavailable");
  if (conditions.items.some((item) => item.kind === "cleared-state" && item.value !== "any") && candidate.cleared === undefined) reasons.push("cleared-state-unavailable");
  if (conditions.items.some((item) => item.kind === "reconciled-state" && item.value !== "any") && candidate.reconciled === undefined) reasons.push("reconciled-state-unavailable");
  const actual = magnitude(candidate.amountMinor);
  if (actual !== expected.paymentMinor && expected.fromOffsetMinor && actual === expected.otherFundsMinor) reasons.push("partial-offset-funding");
  else if (actual < expected.paymentMinor) reasons.push("partial-payment-representation");
  return reasons;
}

export function evaluateCandidate(conditions: MatchConditionsV1, candidate: MatchCandidate, expected: ExpectedMatchPeriod): CandidateEvaluation {
  const results = conditions.items.map((condition) => conditionMatches(condition, candidate, expected));
  const matches = conditions.operator === "all" ? results.every(Boolean) : results.some(Boolean);
  return {
    candidate,
    matches,
    unsafeReasons: matches ? unsafeReasons(candidate, conditions, expected) : [],
    deviation: { amountMinor: magnitude(candidate.amountMinor) - expected.paymentMinor, days: daysBetween(expected.date, candidate.date) },
  };
}

export function evaluateExpectedPeriod(conditions: MatchConditionsV1, candidates: readonly MatchCandidate[], expected: ExpectedMatchPeriod): PeriodMatchEvaluation {
  const evaluated = candidates.map((candidate) => evaluateCandidate(conditions, candidate, expected)).filter((result) => result.matches);
  const unsafe = evaluated.filter((result) => result.unsafeReasons.length > 0);
  const safe = evaluated.filter((result) => result.unsafeReasons.length === 0);
  const strength = matchRuleStrength(conditions).strength;
  const status: PeriodMatchStatus = unsafe.length > 0 ? "unsafe" : safe.length === 0 ? "missing" : safe.length === 1 ? "unique" : "multiple";
  return {
    expected,
    status,
    candidates: evaluated,
    strength,
    reviewReasons: status === "multiple" ? ["Several rows match; allocation must be reviewed."] : unsafe.flatMap((result) => result.unsafeReasons),
  };
}
