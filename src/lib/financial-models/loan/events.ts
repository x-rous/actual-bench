import { compareDates, type IsoDate } from "../calendar/dates";

/**
 * Same-day event order (FR-047, V3 §10.12).
 *
 * Actual dates carry no time, so the order of events on one day is a
 * convention, and a versioned one. The default day:
 *
 *   1. contract and rate changes take effect
 *   2. external cash events
 *   3. payments, principal and redraw events (other payments, then scheduled repayments)
 *   4. offset balance changes
 *   5. the interest-bearing balance is determined
 *   6. the day's interest accrues
 *   7. interest is charged or capitalized when due
 *   8. the closing state is captured
 *
 * Two boundaries follow from that order and are part of `event-order@1`:
 *
 * - A charge due on date C is taken after C's own accrual, so it covers the
 *   days after the previous charge date up to and including C, and bears
 *   interest from the next day.
 * - A simulation starts from an anchor's closing state, so the first day to
 *   accrue is the day after the anchor (for a new loan, after drawdown).
 *
 * Both match the Figura calculator's shipped code (loan/__fixtures__/au-daily/
 * SOURCES.md); that is calculator evidence, not a lender's published rule.
 *
 * A profile may move scheduled repayments, other payments (extra repayments,
 * draws) or offset changes to after the accrual, or choose a plain
 * `start-of-day` (the default above) or `end-of-day` (all three after the
 * accrual) when the lender's exact rule is unknown. Anything moved after the
 * accrual still precedes the charge; the order of a repayment and a charge on
 * the same day changes no balance that bears interest.
 */

export const EVENT_ORDER_VERSION = "event-order@1";

export type DayStep =
  | "contract-change"
  | "external-cash"
  | "payment"
  | "scheduled-repayment"
  | "offset-change"
  | "determine-balance"
  | "accrue"
  | "charge"
  | "close";

export type Placement = "before-accrual" | "after-accrual";
export type SameDayTiming = "start-of-day" | "end-of-day";

export const SAME_DAY_TIMINGS: readonly SameDayTiming[] = ["start-of-day", "end-of-day"];

/**
 * A lender-specific placement, or the simple timing choice. Scheduled
 * repayments are placed separately from other payments because calculators
 * and lenders treat them differently (Figura applies scheduled repayments
 * after the day's accrual and extra repayments before it).
 */
export type EventOrderProfile =
  | { timing: SameDayTiming }
  | { scheduledRepayments: Placement; otherPayments: Placement; offsets: Placement };

export const DEFAULT_EVENT_ORDER: EventOrderProfile = { timing: "start-of-day" };

/** The keys of the lender-specific placement form, in their frozen order. */
export const EVENT_ORDER_PLACEMENT_KEYS = ["scheduledRepayments", "otherPayments", "offsets"] as const;
export const PLACEMENTS: readonly Placement[] = ["before-accrual", "after-accrual"];

function placements(profile: EventOrderProfile): { scheduledRepayments: Placement; otherPayments: Placement; offsets: Placement } {
  if ("timing" in profile) {
    const where: Placement = profile.timing === "start-of-day" ? "before-accrual" : "after-accrual";
    return { scheduledRepayments: where, otherPayments: where, offsets: where };
  }
  return profile;
}

/** The day's steps in order for a profile. Anything moved after the accrual still precedes the charge. */
export function dayStepOrder(profile: EventOrderProfile = DEFAULT_EVENT_ORDER): DayStep[] {
  const { scheduledRepayments, otherPayments, offsets } = placements(profile);
  const before: DayStep[] = ["contract-change", "external-cash"];
  const after: DayStep[] = [];
  (otherPayments === "before-accrual" ? before : after).push("payment");
  (scheduledRepayments === "before-accrual" ? before : after).push("scheduled-repayment");
  (offsets === "before-accrual" ? before : after).push("offset-change");
  return [...before, "determine-balance", "accrue", ...after, "charge", "close"];
}

/** Which step a dated event belongs to (contracts/engine-and-projection `LedgerEvent` kinds and rate changes). */
export function stepForEvent(kind: string): DayStep {
  switch (kind) {
    case "rate-change":
    case "contract-change":
      return "contract-change";
    case "fee":
      return "external-cash";
    case "repayment":
      return "scheduled-repayment";
    case "extra-repayment":
    case "draw":
      return "payment";
    case "offset-balance":
      return "offset-change";
    case "lender-interest-charge":
    case "interest-charge":
      return "charge";
    default:
      throw new RangeError(`No same-day step for event kind ${JSON.stringify(kind)}`);
  }
}

export type OrderableEvent = { date: IsoDate; kind: string; /** Stable tie-break within a step, e.g. a source id. */ key: string };

/**
 * Events sorted by date, then by their step in the day, then by `key`. The
 * input order never matters, so the same events always come out the same way.
 */
export function orderEvents<T extends OrderableEvent>(events: readonly T[], profile: EventOrderProfile = DEFAULT_EVENT_ORDER): T[] {
  const rank = new Map(dayStepOrder(profile).map((step, i) => [step, i]));
  const keyed = events.map((event) => ({ event, rank: rank.get(stepForEvent(event.kind))! }));
  keyed.sort(
    (a, b) =>
      compareDates(a.event.date, b.event.date) ||
      a.rank - b.rank ||
      (a.event.key < b.event.key ? -1 : a.event.key > b.event.key ? 1 : 0)
  );
  return keyed.map((k) => k.event);
}
