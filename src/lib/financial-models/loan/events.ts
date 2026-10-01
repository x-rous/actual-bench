import { compareDates, type IsoDate } from "../calendar/dates";
import { generateSchedule } from "../calendar/schedule";
import type { Certainty, EventRef, FutureAssumption, LedgerEvent } from "./model";

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
 * accrual also follows that day's charge (as in Figura's calculator); the
 * order of a repayment and a charge on the same day changes no balance that
 * bears interest, only the per-row balances reported.
 */

export const EVENT_ORDER_VERSION_V1 = "event-order@1";
export const EVENT_ORDER_VERSION = "event-order@2";

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

/** The day's steps in order for a profile. Anything moved after the accrual also follows the charge. */
export function dayStepOrder(profile: EventOrderProfile = DEFAULT_EVENT_ORDER): DayStep[] {
  const { scheduledRepayments, otherPayments, offsets } = placements(profile);
  const before: DayStep[] = ["contract-change", "external-cash"];
  const after: DayStep[] = [];
  (otherPayments === "before-accrual" ? before : after).push("payment");
  (scheduledRepayments === "before-accrual" ? before : after).push("scheduled-repayment");
  (offsets === "before-accrual" ? before : after).push("offset-change");
  return [...before, "determine-balance", "accrue", "charge", ...after, "close"];
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
    case "offset-deposit":
    case "offset-withdrawal":
      return "offset-change";
    case "payment-change":
      return "contract-change";
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

// ─── Normalized engine events (T054, T055) ────────────────────────────────────

/** A dated event as both engines consume it: validated, expanded and keyed. */
export type EngineEvent = {
  date: IsoDate;
  kind: "repayment" | "extra-repayment" | "draw" | "fee" | "offset-balance" | "offset-deposit" | "offset-withdrawal" | "lender-interest-charge" | "payment-change";
  /** Positive magnitude (a draw increases the debt by it; a repayment reduces it). */
  amountMinor: number;
  capitalized: boolean;
  accountId: string | null;
  clearedBalanceMinor: number | null;
  certainty: Certainty;
  ref: EventRef | null;
  key: string;
};

export type NormalizedEvents = { ok: true; events: EngineEvent[] } | { ok: false; date: IsoDate; message: string };

export const OFFSET_STATE_EVENT_KINDS = ["offset-balance", "offset-deposit", "offset-withdrawal"] as const;
export type OffsetStateEventKind = (typeof OFFSET_STATE_EVENT_KINDS)[number];
export const isOffsetStateEventKind = (kind: string): kind is OffsetStateEventKind =>
  (OFFSET_STATE_EVENT_KINDS as readonly string[]).includes(kind);
type OffsetStateLedgerEvent = Extract<LedgerEvent, { kind: OffsetStateEventKind }>;
const isOffsetStateLedgerEvent = (event: LedgerEvent): event is OffsetStateLedgerEvent =>
  isOffsetStateEventKind(event.kind);

/**
 * Validate and merge observed ledger events with baseline assumptions.
 *
 * - Repayments, extra repayments, draws and fees are positive magnitudes. A
 *   negative repayment is refused, never read as a draw (FR-018); a draw is
 *   its own event that increases the debt.
 * - Recurring assumptions expand to real dates at their frequency.
 * - Events after `to` are dropped; the result is in same-day order.
 */
export function normalizeEvents(
  ledger: readonly LedgerEvent[],
  assumptions: readonly FutureAssumption[],
  window: { after: IsoDate; to: IsoDate },
  profile: EventOrderProfile
): NormalizedEvents {
  const out: EngineEvent[] = [];
  const inWindow = (d: IsoDate) => compareDates(d, window.after) > 0 && compareDates(d, window.to) <= 0;

  for (const [i, e] of ledger.entries()) {
    if (isOffsetStateLedgerEvent(e)) {
      const amountMinor = e.kind === "offset-balance" ? e.balanceMinor : e.amountMinor;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || (e.kind !== "offset-balance" && amountMinor === 0)) {
        return { ok: false, date: e.date, message: `A ${e.kind} amount must be a positive number of minor units.` };
      }
      if (compareDates(e.date, window.to) > 0) continue;
      out.push({
        date: e.date,
        kind: e.kind,
        amountMinor,
        capitalized: false,
        accountId: e.accountId,
        clearedBalanceMinor: e.kind === "offset-balance" ? e.clearedBalanceMinor : null,
        certainty: "observed",
        ref: e.kind === "offset-balance" ? null : e.ref,
        key: `offset:${e.accountId}:${e.date}:${e.kind}:${i}`,
      });
      continue;
    }
    if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor < 0) {
      const what = e.kind === "repayment" || e.kind === "extra-repayment" ? "A repayment cannot be negative; record a draw instead." : `A ${e.kind} amount must be a positive number of minor units.`;
      return { ok: false, date: e.date, message: what };
    }
    if (!inWindow(e.date)) continue;
    out.push({
      date: e.date,
      kind: e.kind,
      amountMinor: e.amountMinor,
      capitalized: e.kind === "fee" ? e.treatment === "capitalized" : false,
      accountId: null,
      clearedBalanceMinor: null,
      certainty: "observed",
      ref: e.ref,
      key: `${e.ref.source}:${e.ref.id}`,
    });
  }

  for (const [i, a] of assumptions.entries()) {
    if (a.kind !== "offset-balance" && (!Number.isSafeInteger(a.amountMinor) || a.amountMinor < 0)) {
      return { ok: false, date: a.date, message: `A ${a.kind} assumption must be a positive number of minor units.` };
    }
    if ((a.kind === "offset-deposit" || a.kind === "offset-withdrawal") && a.amountMinor === 0) {
      return { ok: false, date: a.date, message: `A ${a.kind} assumption must be a positive number of minor units.` };
    }
    const recurrence = "recurrence" in a ? a.recurrence : undefined;
    const dates = recurrence
      ? generateSchedule({ frequency: recurrence.frequency, firstDate: a.date }, { from: a.date, to: compareDates(recurrence.until, window.to) < 0 ? recurrence.until : window.to })
      : [a.date];
    for (const date of dates) {
      if (!inWindow(date) && !(isOffsetStateEventKind(a.kind) && compareDates(date, window.after) <= 0)) continue;
      const base = { date, capitalized: false, accountId: null, clearedBalanceMinor: null, certainty: "assumed" as const, ref: { source: "assumption" as const, id: `${i}:${date}` }, key: `assumption:${i}:${date}` };
      if (a.kind === "offset-balance") out.push({ ...base, kind: "offset-balance", amountMinor: a.balanceMinor, accountId: a.accountId, clearedBalanceMinor: a.balanceMinor });
      else if (a.kind === "offset-deposit" || a.kind === "offset-withdrawal") out.push({ ...base, kind: a.kind, amountMinor: a.amountMinor, accountId: a.accountId });
      else if (a.kind === "fee") out.push({ ...base, kind: "fee", amountMinor: a.amountMinor, capitalized: a.treatment === "capitalized" });
      else out.push({ ...base, kind: a.kind, amountMinor: a.amountMinor });
    }
  }
  return { ok: true, events: orderEvents(out, profile) };
}
