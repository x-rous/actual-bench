import { addDays, compareDates, type IsoDate } from "../calendar/dates";
import { add, fromMinor, sub, toDecString, toMinor, DEC_ZERO, type Dec } from "../money/kernel";
import { dayInterest, intermediateScale } from "./accrual";
import { dayCountOf, rateTable, validateModel } from "./engineCommon";
import type { LoanModelSnapshot } from "./model";
import { DEFAULT_INTEREST_ALLOCATION, type InterestAllocation } from "./lenderStatement";
import { CURRENT_COMPONENT_VERSIONS } from "./versions";

/**
 * Interest allocation of observed repayments (RD-084 P1.6 T282, T283).
 *
 * The projection charges interest on scheduled dates. A repayment that really
 * happened is split from what really happened instead: the balance steps on
 * each payment's actual date, and interest accrues day by day with the
 * loan's own day count, rates and intermediate rounding (the same primitives
 * the daily engine uses). This is lender reporting, not a second interest
 * method: the economics (interest accrued per day on the balance owed) are
 * identical under both allocations; only which repayment reports which part
 * of the accrued interest differs.
 *
 * - `as-calculated` (default): a repayment carries the interest accrued since
 *   the previous repayment, up to its own actual date.
 * - `accrued-to-due-date`: a repayment carries the interest accrued to its
 *   (adjusted) due date as if it were paid on that date; the benefit of paying
 *   early is credited in the next repayment. Reported interest k is
 *   `A(k) - A(k-1)`, where `A(k)` is the accrual from the opening to due date
 *   k with earlier repayments on their actual dates and repayment k on its
 *   due date (or its actual date, when that is later).
 *
 * Each repayment's interest is rounded once, with the profile's interest
 * posting rounding. A fee the lender deducted from a repayment is passed as
 * `feesMinor` and stays a separate line: it is never absorbed into interest
 * or principal.
 */

export const STATEMENT_ALLOCATION_VERSION = "statement-allocation@1";

export { DEFAULT_INTEREST_ALLOCATION, INTEREST_ALLOCATIONS, type InterestAllocation, type LenderStatementSettings } from "./lenderStatement";

export type ObservedRepayment = {
  /** The scheduled date the repayment settles, after business-day adjustment. */
  dueDate: IsoDate;
  /** The date the money actually moved. */
  paidDate: IsoDate;
  amountMinor: number;
  /** A fee the lender took from this repayment, kept as its own line. */
  feesMinor?: number;
  /**
   * The interest actually applied for this repayment when it differs from the calculation (a
   * user's edit, T291). Later repayments then build on the principal actually applied.
   */
  appliedInterestMinor?: number;
  /**
   * An extra payment (owner decision 2026-10-07): all of it is principal; the interest built up
   * until it was paid is carried to the next repayment, so later interest runs on the lower balance.
   */
  extra?: boolean;
};

export type AllocatedRepayment = ObservedRepayment & {
  interestMinor: number;
  feesMinor: number;
  principalMinor: number;
  balanceBeforeMinor: number;
  balanceAfterMinor: number;
  /** Interest accrued over the repayment's own period on actual dates, exactly (the economics). */
  economicInterest: string;
  /**
   * Interest owed that this repayment did not cover (it all went to interest, none to principal);
   * carried to the next repayment. Happens after a missed repayment on an interest-heavy loan.
   */
  unpaidInterestMinor?: number;
};

export type StatementAllocationResult =
  | { ok: true; allocation: InterestAllocation; rows: AllocatedRepayment[]; engineVersions: Record<string, string> }
  | { ok: false; message: string };

export function interestAllocationOf(model: LoanModelSnapshot): InterestAllocation {
  return model.lenderStatement?.interestAllocation ?? DEFAULT_INTEREST_ALLOCATION;
}

export function statementAllocationVersions(model: LoanModelSnapshot): Record<string, string> {
  const dc = dayCountOf(model);
  return {
    "statement-allocation": STATEMENT_ALLOCATION_VERSION,
    accrual: CURRENT_COMPONENT_VERSIONS.accrual,
    daycount: dc.version,
    rates: CURRENT_COMPONENT_VERSIONS.rates,
    "money-kernel": CURRENT_COMPONENT_VERSIONS["money-kernel"],
  };
}

export type ObservedRepaymentAllocator = {
  allocation: InterestAllocation;
  engineVersions: Record<string, string>;
  /** Allocate the next repayment in date order; after a failure every later push fails too. */
  push(repayment: ObservedRepayment): { ok: true; row: AllocatedRepayment } | { ok: false; message: string };
  /** What `push` would allocate for the next repayment, without recording it. */
  preview(repayment: ObservedRepayment): { ok: true; row: AllocatedRepayment } | { ok: false; message: string };
};

/**
 * An allocator that takes repayments one at a time, carrying its state, so a
 * caller planning many periods allocates each repayment once instead of
 * re-accruing the whole history for every split. Pure; never throws on bad input.
 */
export function createObservedRepaymentAllocator(input: {
  model: LoanModelSnapshot;
  /** The opening balance; interest accrued but not yet charged at the opening goes to the first repayment. */
  opening: { date: IsoDate; principalMinor: number; accruedInterestMinor?: number | null };
  allocation?: InterestAllocation;
}): { ok: true; allocator: ObservedRepaymentAllocator } | { ok: false; message: string } {
  const { model, opening } = input;
  const blocked = validateModel(model);
  if (blocked) return { ok: false, message: blocked.message };
  if (model.profile.accrual === "per-period") return { ok: false, message: "Splitting repayments by their actual dates needs daily accrual." };
  const allocation = input.allocation ?? interestAllocationOf(model);
  const digits = model.currency.minorDigits;
  const profile = model.profile;
  const dc = dayCountOf(model);
  const rates = rateTable(model.rates);
  const scale = intermediateScale(profile, digits);
  const shift = profile.repaymentEffectiveTiming === "next-calendar-day" ? 1 : 0;

  // Interest on `balance` for each day in [from, to).
  const accrue = (balance: Dec, from: IsoDate, to: IsoDate): Dec | string => {
    let total = DEC_ZERO;
    for (let d = from; compareDates(d, to) < 0; d = addDays(d, 1)) {
      const rate = rates.rateOn(d);
      if (rate === null) return `No interest rate applies on ${d}.`;
      total = add(total, dayInterest(balance, rate, dc, d, scale, profile.rounding.intermediateRounding));
    }
    return total;
  };

  let count = 0;
  let failure: string | null = null;
  let balanceMinor = opening.principalMinor;
  let effectivePrevious = opening.date;
  // Accrual from the opening to the previous repayment's effective date on the actual path, and A(k-1).
  const accruedAtOpening = fromMinor(opening.accruedInterestMinor ?? 0, digits);
  let actualToPrevious = accruedAtOpening;
  let reportedToDue = DEC_ZERO;
  let carriedIn = accruedAtOpening;
  const fail = (message: string) => {
    failure = message;
    return { ok: false as const, message };
  };

  const push: ObservedRepaymentAllocator["push"] = (r) => {
    if (failure !== null) return { ok: false, message: failure };
    const i = count++;
    if (!Number.isSafeInteger(r.amountMinor) || r.amountMinor <= 0) return fail(`Repayment ${i + 1} must be a positive amount.`);
    const fees = r.feesMinor ?? 0;
    if (!Number.isSafeInteger(fees) || fees < 0 || fees > r.amountMinor) return fail(`Repayment ${i + 1} has an invalid fee amount.`);
    const effective = addDays(r.paidDate, shift);
    if (compareDates(effective, effectivePrevious) < 0) return fail(`Repayment ${i + 1} is earlier than the one before it.`);
    const balance = fromMinor(balanceMinor, digits);
    const economic = accrue(balance, effectivePrevious, effective);
    if (typeof economic === "string") return fail(economic);
    if (r.extra) {
      if (r.amountMinor - fees > balanceMinor) return fail(`Extra payment ${i + 1} is more than the balance owed.`);
      // Nothing reported now: as calculated, the accrual is carried; to the due date, the next
      // repayment's difference already includes it (reported so far is unchanged).
      if (allocation === "as-calculated") carriedIn = add(carriedIn, economic);
      actualToPrevious = add(actualToPrevious, economic);
      const principalOnly = r.amountMinor - fees;
      const extraRow: AllocatedRepayment = { dueDate: r.dueDate, paidDate: r.paidDate, amountMinor: r.amountMinor, interestMinor: 0, feesMinor: fees, principalMinor: principalOnly, balanceBeforeMinor: balanceMinor, balanceAfterMinor: balanceMinor - principalOnly, economicInterest: toDecString(economic) };
      balanceMinor -= principalOnly;
      effectivePrevious = effective;
      return { ok: true, row: extraRow };
    }

    let interestExact: Dec;
    let nextReportedToDue = reportedToDue;
    if (allocation === "as-calculated") {
      interestExact = add(economic, carriedIn);
    } else {
      const deemed = compareDates(effective, r.dueDate) > 0 ? effective : r.dueDate;
      const tail = accrue(balance, effective, deemed);
      if (typeof tail === "string") return fail(tail);
      const toDue = add(add(actualToPrevious, economic), tail);
      interestExact = sub(toDue, reportedToDue);
      nextReportedToDue = toDue;
    }

    const calculatedMinor = Math.max(0, toMinor(interestExact, digits, profile.rounding.interestPostingRounding));
    const applied = r.appliedInterestMinor;
    if (applied !== undefined && (!Number.isSafeInteger(applied) || applied < 0)) return fail(`Repayment ${i + 1} has an invalid applied interest.`);
    const interestMinor = applied ?? calculatedMinor;
    // What was reported so far moves by the edit only, so the next due-date difference absorbs it
    // and unedited repayments allocate exactly as before (the accrual itself is unchanged).
    if (applied !== undefined && allocation === "accrued-to-due-date") nextReportedToDue = add(nextReportedToDue, fromMinor(applied - calculatedMinor, digits));
    let principalMinor = r.amountMinor - fees - interestMinor;
    let unpaid = DEC_ZERO;
    let interestReported = interestMinor;
    if (principalMinor < 0) {
      // A user's own interest figure must fit the payment; a calculated one that does not (after a
      // missed repayment) takes the whole payment, and the rest stays owed for the next repayment.
      if (applied !== undefined) return fail(`Repayment ${i + 1} does not cover the interest it owes.`);
      interestReported = r.amountMinor - fees;
      unpaid = sub(interestExact, fromMinor(interestReported, digits));
      principalMinor = 0;
    }
    const unpaidMinor = principalMinor === 0 && interestReported !== interestMinor ? interestMinor - interestReported : 0;
    const row: AllocatedRepayment = {
      dueDate: r.dueDate,
      paidDate: r.paidDate,
      amountMinor: r.amountMinor,
      interestMinor: interestReported,
      feesMinor: fees,
      principalMinor,
      balanceBeforeMinor: balanceMinor,
      balanceAfterMinor: balanceMinor - principalMinor,
      economicInterest: toDecString(economic),
      ...(unpaidMinor > 0 ? { unpaidInterestMinor: unpaidMinor } : {}),
    };
    // Interest not covered is carried: as calculated, into the next repayment; to the due date, by
    // reporting less so far, so the next due-date difference includes it.
    if (allocation === "as-calculated") carriedIn = unpaid;
    else nextReportedToDue = sub(nextReportedToDue, unpaid);
    reportedToDue = nextReportedToDue;
    actualToPrevious = add(actualToPrevious, economic);
    balanceMinor -= principalMinor;
    effectivePrevious = effective;
    return { ok: true, row };
  };

  // What the next repayment would allocate, leaving the allocator as it was.
  const preview: ObservedRepaymentAllocator["preview"] = (r) => {
    const saved = { count, failure, balanceMinor, effectivePrevious, actualToPrevious, reportedToDue, carriedIn };
    const result = push(r);
    ({ count, failure, balanceMinor, effectivePrevious, actualToPrevious, reportedToDue, carriedIn } = saved);
    return result;
  };

  return { ok: true, allocator: { allocation, engineVersions: statementAllocationVersions(model), push, preview } };
}

/**
 * Allocate a run of observed repayments, in date order, from an opening
 * principal. Pure; never throws on bad input.
 */
export function allocateObservedRepayments(input: {
  model: LoanModelSnapshot;
  /** The opening balance; interest accrued but not yet charged at the opening goes to the first repayment. */
  opening: { date: IsoDate; principalMinor: number; accruedInterestMinor?: number | null };
  repayments: readonly ObservedRepayment[];
  allocation?: InterestAllocation;
}): StatementAllocationResult {
  const created = createObservedRepaymentAllocator(input);
  if (!created.ok) return created;
  const { allocator } = created;
  const rows: AllocatedRepayment[] = [];
  for (const r of input.repayments) {
    const result = allocator.push(r);
    if (!result.ok) return result;
    rows.push(result.row);
  }
  return { ok: true, allocation: allocator.allocation, rows, engineVersions: allocator.engineVersions };
}

export type StatementRow = { paidDate: IsoDate; principalMinor: number; interestMinor: number; balanceMinor?: number | null };

export type StatementComparison = {
  paidDate: IsoDate;
  status: "matches" | "unexplained-difference";
  /** Lender-reported interest minus allocated interest. */
  interestDifferenceMinor: number;
};

/**
 * Compare a lender statement with the allocation, row by row. A difference
 * beyond `toleranceMinor` is reported as unexplained: it is flagged for the
 * user, never fitted into the interest calculation.
 */
export function compareLenderStatement(rows: readonly AllocatedRepayment[], statement: readonly StatementRow[], toleranceMinor: number): StatementComparison[] {
  return statement.map((s, i) => {
    const row = rows[i];
    const difference = row ? s.interestMinor - row.interestMinor : s.interestMinor;
    return { paidDate: s.paidDate, status: row && Math.abs(difference) <= toleranceMinor ? "matches" : "unexplained-difference", interestDifferenceMinor: difference };
  });
}
