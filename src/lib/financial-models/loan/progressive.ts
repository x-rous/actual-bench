import { compareDates, type IsoDate } from "../calendar/dates";
import { dec, fromMinor, toDecString, type Dec } from "../money/kernel";
import type { Anchor, LoanModelSnapshot } from "./model";
import { progressiveFirstPrincipal, progressivePrincipalAt } from "./repayment";

/**
 * Progressive principal series state shared by both engines (design 06 §1.1). The series belongs to the contract: an
 * instalment is identified by its number in the generated repayment schedule, never by how many payments were made,
 * and a new basis starts only at the opening, the end of an interest-only phase, or a contract recast date. Extra
 * repayments, rate changes and anchors carry the series on unchanged.
 */
export type ProgressiveBasis = {
  /** The instalment number (1-based) the basis starts at. */
  startNo: number;
  /** The exact, unrounded principal of that instalment. */
  first: Dec;
  /** How the basis was set: the contract opening, a basis change, the anchor's own basis, or (fallback) the anchor balance. */
  source: "opening" | "interest-only-phase-end" | "contract-date" | "anchor" | "anchor-balance";
};

export const PROGRESSIVE_VERSION = "progressive-principal@1";

export function progressiveGrowth(model: LoanModelSnapshot): Dec | null {
  return model.profile.amortization === "progressive-principal" && model.progressive ? dec(model.progressive.growthPerRepaymentDecimal) : null;
}

/** A new basis from `balanceMinor` at instalment `startNo`, over the instalments left on the amortization basis. */
export function progressiveBasis(model: LoanModelSnapshot, growth: Dec, startNo: number, balanceMinor: number, totalPayments: number, source: ProgressiveBasis["source"]): ProgressiveBasis {
  const payments = Math.max(totalPayments - (startNo - 1), 1);
  return { startNo, first: progressiveFirstPrincipal(fromMinor(balanceMinor, model.currency.minorDigits), growth, payments), source };
}

/** The scheduled principal of instalment `no` (minor units), before it is limited to the balance owed. */
export function progressivePrincipalFor(model: LoanModelSnapshot, growth: Dec, basis: ProgressiveBasis, no: number): number {
  return progressivePrincipalAt(basis.first, growth, Math.max(no - basis.startNo, 0), { minorDigits: model.currency.minorDigits, mode: model.profile.rounding.paymentRounding });
}

/**
 * The basis in force at the anchor. From the opening (no basis change before the anchor) it is the contract's own;
 * after one, the anchor must carry it (`anchor.progressiveBasis`); without it the series restarts from the anchor's
 * balance over the instalments left, reported as `anchor-balance`.
 */
export function initialProgressiveBasis(model: LoanModelSnapshot, growth: Dec, anchor: Anchor, schedule: readonly IsoDate[], totalPayments: number): ProgressiveBasis {
  if (anchor.progressiveBasis) return { startNo: anchor.progressiveBasis.startNo, first: dec(anchor.progressiveBasis.firstPrincipalExact), source: "anchor" };
  // A basis changes on the recast date, or the day after an interest-only phase ends; on or before the anchor, the
  // run cannot change it itself.
  const changedBefore =
    model.paymentRecasts.some((r) => compareDates(r.date, model.terms.openingDate) > 0 && compareDates(r.date, anchor.date) <= 0) ||
    model.phases.some((p) => compareDates(p.to, anchor.date) < 0 && schedule.some((d) => compareDates(d, p.to) > 0));
  if (!changedBefore) return progressiveBasis(model, growth, 1, model.terms.openingPrincipalMinor, totalPayments, "opening");
  const nextNo = schedule.filter((d) => compareDates(d, anchor.date) <= 0).length + 1;
  return progressiveBasis(model, growth, nextNo, anchor.principalMinor, totalPayments, "anchor-balance");
}

/** The anchor form of a basis, for a run that continues another. */
export function anchorBasis(basis: ProgressiveBasis): NonNullable<Anchor["progressiveBasis"]> {
  return { startNo: basis.startNo, firstPrincipalExact: toDecString(basis.first) };
}
