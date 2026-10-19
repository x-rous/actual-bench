import type { ActivityRow, ActivitySnapshot } from "../activity";
import type { Card, RepaymentPlan, Workspace } from "../models";
import { minorAmountSchema } from "../models";
import { safeIntegerSum } from "../minor";

/**
 * Plan accounts (D4, D6): off-budget Actual accounts that hold plan principal.
 *
 * Ownership is decided by structure only, never by explicit links:
 * - an account used by exactly one untagged plan belongs to that plan entirely, with no opening;
 * - a shared account assigns each row to the plan whose exact `#tag` is in the row's (or its
 *   transfer peer's) notes;
 * - anything else in a plan account is "not linked to a plan yet": still never a payment, and
 *   still counted in the card's Total owed when it moved money from this card.
 */
/** Negation without −0, so owed amounts compare equal to 0. */
const negate = (value: number) => (value === 0 ? 0 : -value);

const sum = (values: readonly number[]) => {
  const fast = safeIntegerSum(values);
  if (fast !== null) return fast;
  const total = Number(values.reduce((acc, value) => acc + BigInt(value), BigInt(0)));
  return minorAmountSchema.parse(total);
};

type RowIndex = { rows: Map<string, ActivityRow>; conflicts: Set<string> };
const rowIndexes = new WeakMap<ActivitySnapshot, RowIndex>();

/** Every row the read returned (card, peers, plan accounts), by id, plus conflicting copies. */
export function rowIndex(snapshot: ActivitySnapshot): RowIndex {
  let index = rowIndexes.get(snapshot);
  if (!index) {
    index = { rows: new Map(), conflicts: new Set() };
    const all = [
      ...snapshot.rows,
      ...snapshot.counterparts,
      ...(snapshot.trackingAccounts ?? []).flatMap((account) => [...account.rows, ...(account.counterparts ?? [])]),
    ];
    for (const row of all) {
      const old = index.rows.get(row.id);
      if (!old) index.rows.set(row.id, row);
      else if (old.fingerprint !== row.fingerprint) index.conflicts.add(row.id);
    }
    rowIndexes.set(snapshot, index);
  }
  return index;
}

export const peerOf = (row: ActivityRow, snapshot: ActivitySnapshot) =>
  row.transferId ? rowIndex(snapshot).rows.get(row.transferId) : undefined;

const accountSets = new WeakMap<readonly string[], WeakMap<readonly RepaymentPlan[], Set<string>>>();
/** The budget's plan accounts: the saved list plus every account a plan uses. */
export function planAccountIds(workspace: Pick<Workspace, "planAccounts" | "plans">): Set<string> {
  let byPlans = accountSets.get(workspace.planAccounts);
  if (!byPlans) {
    byPlans = new WeakMap();
    accountSets.set(workspace.planAccounts, byPlans);
  }
  let ids = byPlans.get(workspace.plans);
  if (!ids) {
    ids = new Set([
      ...workspace.planAccounts,
      ...workspace.plans.flatMap((plan) => (plan.planAccountId ? [plan.planAccountId] : [])),
    ]);
    byPlans.set(workspace.plans, ids);
  }
  return ids;
}

/** A transfer between this row's account and a plan account. Never a payment, never a cost. */
export function isPlanAccountTransfer(
  row: ActivityRow,
  snapshot: ActivitySnapshot,
  workspace: Pick<Workspace, "planAccounts" | "plans">,
) {
  if (!row.transferId) return false;
  const ids = planAccountIds(workspace);
  const peer = peerOf(row, snapshot);
  if (!peer) return false;
  return ids.has(peer.accountId) !== ids.has(row.accountId);
}

/** Exact hashtag match in notes. */
export function hasPlanTag(notes: string | null, tag: string) {
  return Boolean(tag && Array.from(notes?.match(/#[\p{L}\p{N}_-]+/gu) ?? []).includes(tag));
}

/** Sorted "legA:legB" key for a transfer, so both legs map to one plan entry. */
export function transferPairKey(row: ActivityRow) {
  return row.transferId ? [row.id, row.transferId].sort().join(":") : null;
}

/** The plan that owns a plan-account row, or null when no plan does (or two would). */
export function ownerOf(row: ActivityRow, plans: readonly RepaymentPlan[], snapshot: ActivitySnapshot) {
  const inAccount = plans.filter((plan) => plan.planAccountId === row.accountId);
  const own = inAccount.filter((plan) => plan.planAccountTag === null);
  if (own.length === 1 && inAccount.length === 1) return own[0];
  if (own.length) return null;
  const peer = peerOf(row, snapshot);
  const tagged = inAccount.filter((plan) => hasPlanTag(row.notes, plan.planAccountTag!)
    || hasPlanTag(peer?.notes ?? null, plan.planAccountTag!));
  return tagged.length === 1 ? tagged[0] : null;
}

/** Plan-account history for one account, or undefined when it was not read. */
export function planAccountHistory(snapshot: ActivitySnapshot, accountId: string) {
  return snapshot.trackingAccounts?.find((entry) => entry.accountId === accountId);
}

type TransferPair = { planLeg: ActivityRow; cardLeg: ActivityRow };

/** One card's view of its plan accounts, computed once per data state. */
export type PlanLedger = {
  /** This card's plans that keep principal in a plan account. */
  plans: RepaymentPlan[];
  /** Owned plan-account rows per plan, after any opening, sorted by date. */
  rowsByPlan: Map<string, ActivityRow[]>;
  /** Plan-account rows that moved money from this card but belong to no plan yet. */
  unassigned: ActivityRow[];
  /** Plan-account rows owned by plans on other cards that moved money from this card. */
  foreign: ActivityRow[];
  /** Card ↔ plan-account transfer pairs, for money in transit between legs. */
  pairs: TransferPair[];
  /** Accounts this card needs but whose history is missing or incomplete. */
  unavailable: string[];
  /** Conflicting copies of a plan-account row (data must refresh). */
  conflicting: boolean;
};

const ledgers = new WeakMap<ActivitySnapshot, WeakMap<readonly RepaymentPlan[], WeakMap<readonly string[], WeakMap<Card, PlanLedger>>>>();

export function planLedger(card: Card, workspace: Workspace, snapshot: ActivitySnapshot): PlanLedger {
  let byPlans = ledgers.get(snapshot);
  if (!byPlans) {
    byPlans = new WeakMap();
    ledgers.set(snapshot, byPlans);
  }
  let byAccounts = byPlans.get(workspace.plans);
  if (!byAccounts) {
    byAccounts = new WeakMap();
    byPlans.set(workspace.plans, byAccounts);
  }
  let byCard = byAccounts.get(workspace.planAccounts);
  if (!byCard) {
    byCard = new WeakMap();
    byAccounts.set(workspace.planAccounts, byCard);
  }
  let ledger = byCard.get(card);
  if (!ledger) {
    ledger = buildLedger(card, workspace, snapshot);
    byCard.set(card, ledger);
  }
  return ledger;
}

function buildLedger(card: Card, workspace: Workspace, snapshot: ActivitySnapshot): PlanLedger {
  const plans = workspace.plans.filter((plan) => plan.cardId === card.id && plan.recordedAs === "plan-account");
  const index = rowIndex(snapshot);
  const accounts = [...planAccountIds(workspace)];
  const rowsByPlan = new Map(plans.map((plan) => [plan.id, [] as ActivityRow[]]));
  const unassigned: ActivityRow[] = [];
  const foreign: ActivityRow[] = [];
  const pairs: TransferPair[] = [];
  const unavailable = new Set<string>();
  let conflicting = false;
  for (const accountId of accounts) {
    const needed = plans.some((plan) => plan.planAccountId === accountId);
    const history = planAccountHistory(snapshot, accountId);
    if (!history || history.issues.length) {
      if (needed) unavailable.add(accountId);
      continue;
    }
    const accountPlans = workspace.plans.filter((plan) => plan.planAccountId === accountId);
    // Untagged history up to the latest opening is summarised by that opening.
    const latestOpening = accountPlans.map((plan) => plan.opening?.date ?? "").sort().at(-1) ?? "";
    for (const row of history.rows) {
      const peer = peerOf(row, snapshot);
      const fromCard = peer?.accountId === card.accountId;
      if (index.conflicts.has(row.id) || (peer && index.conflicts.has(peer.id))) conflicting ||= needed || fromCard;
      const owner = ownerOf(row, workspace.plans, snapshot);
      if (owner && owner.opening && row.date <= owner.opening.date) continue;
      if (owner && rowsByPlan.has(owner.id)) rowsByPlan.get(owner.id)!.push(row);
      else if (owner && fromCard) foreign.push(row);
      else if (!owner && fromCard && row.date > latestOpening) unassigned.push(row);
      else continue;
      if (fromCard && peer) pairs.push({ planLeg: row, cardLeg: peer });
    }
  }
  for (const rows of rowsByPlan.values()) rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { plans, rowsByPlan, unassigned, foreign, pairs, unavailable: [...unavailable], conflicting };
}

/** Signed plan principal (negative = owed) at the end of `date`, or null before its opening. */
export function planSignedAt(plan: RepaymentPlan, ledger: PlanLedger, date: string, cleared = false) {
  if (plan.opening && date < plan.opening.date) return null;
  const rows = ledger.rowsByPlan.get(plan.id) ?? [];
  const moved = rows.filter((row) => row.date <= date && (!cleared || row.cleared === true));
  return sum([-(plan.opening?.principalMinor ?? 0), ...moved.map((row) => row.amountMinor)]);
}

/** Principal a plan holds in its plan account at `date`, as a positive amount owed. */
export function planPrincipal(plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot, date: string) {
  if (plan.recordedAs !== "plan-account" || !plan.planAccountId) return null;
  const ledger = planLedger(card, workspace, snapshot);
  if (ledger.unavailable.includes(plan.planAccountId) || ledger.conflicting) return null;
  const signed = planSignedAt(plan, ledger, date);
  return signed === null ? null : negate(signed);
}

/** Principal this card holds in plan accounts at the end of `date` (positive), or null if unknown. */
export function planBalanceAt(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, date: string) {
  const ledger = planLedger(card, workspace, snapshot);
  if (ledger.conflicting || ledger.unavailable.length) return null;
  const plans = ledger.plans.map((plan) => planSignedAt(plan, ledger, date));
  if (plans.some((entry) => entry === null)) return null;
  const unassigned = ledger.unassigned.filter((row) => row.date <= date).map((row) => row.amountMinor);
  return negate(sum([...(plans as number[]), ...unassigned]));
}

export type TotalOwed = {
  /** Total owed is known: card balance and every plan account read. A plan check never hides it (D22). */
  known: boolean;
  /** max(0, −card balance + plan principal + in transit), positive minor units. */
  owedMinor: number;
  /** Cleared rows only, on both card and plan accounts. */
  confirmedOwedMinor: number;
  /** Signed card balance at the date. */
  signedCardMinor: number;
  onCardMinor: number;
  inPlanAccountsMinor: number;
  /** Of `inPlanAccountsMinor`: moved from this card but not linked to a plan yet. */
  unassignedMinor: number;
  inTransitMinor: number;
  /** Signed balance used for credit capacity: pending credits never release credit. */
  capacitySignedMinor: number;
  hasPlanAccounts: boolean;
  unavailable: string[];
};

/** Total owed (§7.1 #1) at `date`, given the card's signed Actual balance at that date. */
export function totalOwed(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, signedCardMinor: number, date: string): TotalOwed {
  const ledger = planLedger(card, workspace, snapshot);
  const through = (rows: readonly ActivityRow[], cleared = false) =>
    sum(rows.filter((row) => row.date <= date && (!cleared || row.cleared === true)).map((row) => row.amountMinor));
  const plans = ledger.plans.map((plan) => ({ signed: planSignedAt(plan, ledger, date), cleared: planSignedAt(plan, ledger, date, true) }));
  const planSigned = sum(plans.map((entry) => entry.signed ?? 0));
  const planCleared = sum(plans.map((entry) => entry.cleared ?? 0));
  const otherRows = [...ledger.unassigned];
  const unassignedSigned = through(otherRows);
  const transit = transitAt(ledger.pairs, date, false);
  const transitCleared = transitAt(ledger.pairs, date, true);
  const pendingCard = sum(snapshot.rows.filter((row) => row.date <= date && row.cleared !== true).map((row) => row.amountMinor));
  const pendingCredits = sum(snapshot.rows.filter((row) => row.date <= date && row.cleared !== true && row.amountMinor > 0
    && !isPlanAccountTransfer(row, snapshot, workspace)).map((row) => row.amountMinor));
  const signed = sum([signedCardMinor, planSigned, unassignedSigned, transit]);
  const confirmedSigned = sum([signedCardMinor, -pendingCard, planCleared, through(otherRows, true), transitCleared]);
  const known = !ledger.conflicting && !ledger.unavailable.length && plans.every((entry) => entry.signed !== null);
  return {
    known,
    owedMinor: Math.max(0, -signed),
    confirmedOwedMinor: Math.max(0, -confirmedSigned),
    signedCardMinor,
    onCardMinor: negate(signedCardMinor),
    inPlanAccountsMinor: negate(sum([planSigned, unassignedSigned])),
    unassignedMinor: negate(unassignedSigned),
    inTransitMinor: negate(transit),
    capacitySignedMinor: sum([signed, -pendingCredits]),
    hasPlanAccounts: ledger.plans.length > 0 || ledger.unassigned.length > 0,
    unavailable: ledger.unavailable,
  };
}

/**
 * Money in transit between a transfer's two legs at `date`: when one leg is dated on or before
 * `date` and the other after, the earlier leg is neutralised so the movement counts once.
 */
function transitAt(pairs: readonly TransferPair[], date: string, cleared: boolean) {
  const amounts: number[] = [];
  for (const { planLeg, cardLeg } of pairs) {
    const planIn = planLeg.date <= date && (!cleared || planLeg.cleared === true);
    const cardIn = cardLeg.date <= date && (!cleared || cardLeg.cleared === true);
    if (planIn !== cardIn) amounts.push(-(planIn ? planLeg.amountMinor : cardLeg.amountMinor));
  }
  return sum(amounts);
}

/**
 * Daily Total owed history in one pass (O(days + rows)): card balance and plan principal come
 * from running totals over date-sorted rows, transit from a difference sweep over pairs.
 */
export function trackedDebtPoints(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, signedCardTodayMinor: number, dates: string[]) {
  const ledger = planLedger(card, workspace, snapshot);
  const known = !ledger.conflicting && !ledger.unavailable.length;
  const cardRows = [...snapshot.rows].sort((a, b) => a.date.localeCompare(b.date));
  const cardTotal = sum(cardRows.map((row) => row.amountMinor));
  const planRows = [...[...ledger.rowsByPlan.values()].flat(), ...ledger.unassigned]
    .sort((a, b) => a.date.localeCompare(b.date));
  const openings = ledger.plans.map((plan) => ({ date: plan.opening?.date ?? null, principal: plan.opening?.principalMinor ?? 0 }));
  const transitEvents = new Map<string, number>();
  for (const { planLeg, cardLeg } of ledger.pairs) {
    const [first, second] = planLeg.date <= cardLeg.date ? [planLeg, cardLeg] : [cardLeg, planLeg];
    if (first.date === second.date) continue;
    // From the first leg's date until the day before the second, the first leg is neutralised.
    transitEvents.set(first.date, sum([transitEvents.get(first.date) ?? 0, -first.amountMinor]));
    transitEvents.set(second.date, sum([transitEvents.get(second.date) ?? 0, first.amountMinor]));
  }
  const transitDates = [...transitEvents.keys()].sort();
  let cardIndex = 0;
  let cardThrough = 0;
  let planIndex = 0;
  let planThrough = 0;
  let transitIndex = 0;
  let transit = 0;
  return [...dates].sort().map((date) => {
    while (cardIndex < cardRows.length && cardRows[cardIndex].date <= date) cardThrough = sum([cardThrough, cardRows[cardIndex++].amountMinor]);
    while (planIndex < planRows.length && planRows[planIndex].date <= date) planThrough = sum([planThrough, planRows[planIndex++].amountMinor]);
    while (transitIndex < transitDates.length && transitDates[transitIndex] <= date) {
      transit = sum([transit, transitEvents.get(transitDates[transitIndex++])!]);
    }
    if (date < snapshot.from || date > snapshot.to) return { date, valueMinor: null, onCardMinor: null, planMinor: null, transitMinor: null };
    const signedCard = sum([signedCardTodayMinor, -cardTotal, cardThrough]);
    const beforeOpening = openings.some((opening) => opening.date !== null && date < opening.date);
    const planSigned = sum([planThrough, ...openings.map((opening) => -opening.principal)]);
    if (!known || beforeOpening) {
      return { date, valueMinor: ledger.plans.length ? null : Math.max(0, -signedCard), onCardMinor: negate(signedCard), planMinor: null, transitMinor: null };
    }
    const total = sum([signedCard, planSigned, transit]);
    return { date, valueMinor: Math.max(0, -total), onCardMinor: negate(signedCard), planMinor: negate(planSigned), transitMinor: negate(transit) };
  });
}

/** Plan-account rows that moved money from this card and belong to no plan. */
export function unassignedPlanEntries(card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  return planLedger(card, workspace, snapshot).unassigned;
}
