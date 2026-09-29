import { compareDates, type IsoDate } from "../calendar/dates";
import { add, fromMinor, max, min, mul, DEC_ZERO, type Dec } from "../money/kernel";
import type { OffsetLink } from "./model";

/**
 * Offset eligibility (FR-055, FR-017, V3 §10.13).
 *
 * An offset is a cash asset, never negative debt: it reduces only the base
 * that interest is charged on, never the recorded liability. For each link in
 * force on a date:
 *
 *   eligible = min(cap, max(balance, 0) × percentage)
 *
 * and the interest-bearing balance is `max(debt − Σ eligible, 0)` (see
 * accrual.ts `interestBase`). A negative offset balance counts as zero.
 */

export const OFFSETS_VERSION = "offsets@1";

/** Latest known balance of each offset account, keyed by account id, in minor units. */
export type OffsetBalances = ReadonlyMap<string, { balanceMinor: number; clearedBalanceMinor: number }>;

export function linkInForce(link: OffsetLink, date: IsoDate): boolean {
  return compareDates(link.effectiveFrom, date) <= 0 && (link.effectiveTo === null || compareDates(date, link.effectiveTo) < 0);
}

/** Σ eligible offset on `date`, exact (percentages can produce fractions of a minor unit). */
export function eligibleOffset(links: readonly OffsetLink[], balances: OffsetBalances, date: IsoDate, minorDigits: number): Dec {
  let total = DEC_ZERO;
  for (const link of links) {
    if (!linkInForce(link, date)) continue;
    const known = balances.get(link.accountId);
    if (!known) continue;
    const raw = link.basis === "cleared" ? known.clearedBalanceMinor : known.balanceMinor;
    const balance = max(fromMinor(raw, minorDigits), DEC_ZERO);
    // bps ÷ 10,000 is exactly bps × 10^-4, so the product is exact.
    let eligible = mul(balance, { int: BigInt(link.percentageBps), scale: 4 });
    if (link.capMinor !== null) eligible = min(eligible, fromMinor(link.capMinor, minorDigits));
    total = add(total, eligible);
  }
  return total;
}
