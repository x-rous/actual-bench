import { compareDates, type IsoDate } from "../calendar/dates";
import { add, fromMinor, max, min, mul, DEC_ZERO, type Dec } from "../money/kernel";
import type { EngineEvent } from "./events";
import type { BlockReason, OffsetLink, OffsetStatePoint } from "./model";

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

export const OFFSETS_VERSION_V1 = "offsets@1";
export const OFFSETS_VERSION = "offsets@2";

/** Latest known balance of each offset account, keyed by account id, in minor units. */
export type OffsetBalances = ReadonlyMap<string, { balanceMinor: number; clearedBalanceMinor: number }>;
export type MutableOffsetBalances = Map<string, { balanceMinor: number; clearedBalanceMinor: number }>;

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

/** Sum the raw balance basis of each distinct linked account in force, before percentage or cap. */
export function totalOffsetBalanceMinor(links: readonly OffsetLink[], balances: OffsetBalances, date: IsoDate): number {
  const seen = new Set<string>();
  let total = 0;
  for (const link of links) {
    if (!linkInForce(link, date) || seen.has(link.accountId)) continue;
    seen.add(link.accountId);
    const known = balances.get(link.accountId);
    if (!known) continue;
    const raw = link.basis === "cleared" ? known.clearedBalanceMinor : known.balanceMinor;
    total += Math.max(raw, 0);
    if (!Number.isSafeInteger(total)) throw new RangeError("Offset balances exceed the safe integer range");
  }
  return total;
}

type OffsetTransitionResult =
  | { ok: true; points: OffsetStatePoint[] }
  | { ok: false; reason: BlockReason };

/** Materialize post-transition state for selected accounts with one authoritative linked total. */
export function offsetStatePoints(
  date: IsoDate,
  accountIds: Iterable<string>,
  balances: OffsetBalances,
  links: readonly OffsetLink[]
): OffsetStatePoint[] {
  const totalBalanceMinor = totalOffsetBalanceMinor(links, balances, date);
  return [...new Set(accountIds)].sort().map((accountId) => {
    const state = balances.get(accountId) ?? { balanceMinor: 0, clearedBalanceMinor: 0 };
    return { date, accountId, ...state, totalBalanceMinor };
  });
}

/**
 * Apply one date's complete offset-change step. Snapshot precedence and delta aggregation live
 * here so callers cannot accidentally make row order financially meaningful.
 */
export function applyOffsetTransitions(
  date: IsoDate,
  events: readonly EngineEvent[],
  balances: MutableOffsetBalances,
  links: readonly OffsetLink[]
): OffsetTransitionResult {
  const byAccount = new Map<string, EngineEvent[]>();
  for (const event of events) {
    if (event.kind !== "offset-balance" && event.kind !== "offset-deposit" && event.kind !== "offset-withdrawal") continue;
    const accountId = event.accountId!;
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), event]);
  }

  for (const accountId of [...byAccount.keys()].sort()) {
    const accountEvents = byAccount.get(accountId)!;
    const observed = accountEvents.filter((event) => event.kind === "offset-balance" && event.certainty === "observed");
    const assumed = accountEvents.filter((event) => event.kind === "offset-balance" && event.certainty !== "observed");
    const snapshots = observed.length ? observed : assumed;
    const distinctSnapshots = new Set(snapshots.map((event) => `${event.amountMinor}:${event.clearedBalanceMinor ?? event.amountMinor}`));
    if (distinctSnapshots.size > 1) {
      return {
        ok: false,
        reason: {
          code: "conflicting-offset-snapshot",
          classification: "review",
          date,
          message: `Conflicting ${observed.length ? "observed" : "assumed"} offset balances were supplied for ${accountId} on ${date}.`,
          diagnostics: { accountId, snapshotCount: snapshots.length },
        },
      };
    }

    let state = snapshots[0]
      ? { balanceMinor: snapshots[0].amountMinor, clearedBalanceMinor: snapshots[0].clearedBalanceMinor ?? snapshots[0].amountMinor }
      : balances.get(accountId) ?? { balanceMinor: 0, clearedBalanceMinor: 0 };
    const sum = (kind: "offset-deposit" | "offset-withdrawal") => {
      let amount = 0;
      for (const event of accountEvents) {
        if (event.kind !== kind) continue;
        amount += event.amountMinor;
        if (!Number.isSafeInteger(amount)) throw new RangeError(`${kind} amounts exceed the safe integer range`);
      }
      return amount;
    };
    const deposits = sum("offset-deposit");
    state = { balanceMinor: state.balanceMinor + deposits, clearedBalanceMinor: state.clearedBalanceMinor + deposits };
    if (!Number.isSafeInteger(state.balanceMinor) || !Number.isSafeInteger(state.clearedBalanceMinor)) {
      throw new RangeError("Offset balances exceed the safe integer range");
    }
    const withdrawals = sum("offset-withdrawal");
    const available = Math.min(state.balanceMinor, state.clearedBalanceMinor);
    if (withdrawals > available) {
      return {
        ok: false,
        reason: {
          code: "offset-withdrawal-exceeds-balance",
          classification: "review",
          date,
          message: `An offset withdrawal of ${withdrawals} exceeds the ${available} available in ${accountId}; the request was not capped.`,
          diagnostics: { accountId, requestedAmountMinor: withdrawals, availableAmountMinor: available },
        },
      };
    }
    balances.set(accountId, {
      balanceMinor: state.balanceMinor - withdrawals,
      clearedBalanceMinor: state.clearedBalanceMinor - withdrawals,
    });
  }

  return {
    ok: true,
    points: offsetStatePoints(date, byAccount.keys(), balances, links),
  };
}
