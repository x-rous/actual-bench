import type { ActivityRow, ActivitySnapshot } from "./activity";
import type { Card, PlanLink, RepaymentPlan, Workspace } from "./models";
import { recognizedCost, costFamily } from "./recognition";

/** Exact optional tags help matching; explicit source links work without tags. */
export function hasPlanTag(notes: string | null, tag: string) {
  return Boolean(tag && Array.from(notes?.match(/#[\p{L}\p{N}_-]+/gu) ?? []).includes(tag));
}
const sum = (values: number[]) => {
  const value = Number(values.reduce((total, amount) => total + BigInt(amount), BigInt(0)));
  if (!Number.isSafeInteger(value)) throw new Error("Plan balance exceeds safe money precision");
  return value;
};
const indexes = new WeakMap<ActivitySnapshot, Map<string, ActivityRow>>();
const accountRows = new WeakMap<ActivitySnapshot, Map<string, ActivityRow[]>>();
const conflictingIds = new WeakMap<ActivitySnapshot, Set<string>>();
/** Immutable snapshot index, shared by linking, balances and historical points. */
export function trackingRowIndex(snapshot: ActivitySnapshot) {
  let index = indexes.get(snapshot);
  if (!index) {
    index = new Map();
    const conflicts = new Set<string>();
    for (const row of [...snapshot.rows, ...snapshot.counterparts, ...(snapshot.trackingAccounts ?? []).flatMap((account) => [...account.rows, ...(account.counterparts ?? [])])]) {
      const old = index.get(row.id);
      if (old && (old.accountId !== row.accountId || old.amountMinor !== row.amountMinor || old.transferId !== row.transferId || old.date !== row.date || old.cleared !== row.cleared || old.transferKnown !== row.transferKnown || old.parentId !== row.parentId)) conflicts.add(row.id);
      if (!old) index.set(row.id, row);
    }
    conflictingIds.set(snapshot, conflicts);
    indexes.set(snapshot, index);
    const accounts = new Map<string, ActivityRow[]>();
    for (const row of index.values()) { const rows = accounts.get(row.accountId) ?? []; rows.push(row); accounts.set(row.accountId, rows); }
    accountRows.set(snapshot, accounts);
  }
  return index;
}
export function isTrackingTransfer(row: ActivityRow, snapshot: ActivitySnapshot, workspace?: Workspace) {
  if (!row.transferId) return false;
  const peer = trackingRowIndex(snapshot).get(row.transferId);
  return Boolean(peer && (workspace?.plans?.some((plan) => plan.tracking?.accountId === peer.accountId) || snapshot.trackingAccounts?.some((entry) => entry.accountId === peer.accountId)));
}

/** A plan link never replaces an independently identified interest/fee type. */
export function financingCostKind(row: ActivityRow, card: Card, workspace: Pick<Workspace, "classifications" | "planLinks">): "fee" | "interest" | null {
  const manual = workspace.classifications.find((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.fingerprint === row.fingerprint);
  if (manual) return costFamily(manual.kind);
  const recognized = recognizedCost(row, card, workspace);
  if (recognized) return recognized;
  const role = workspace.planLinks?.find((link) => link.transactionId === row.id && link.fingerprint === row.fingerprint)?.role;
  return role === "plan-interest" ? "interest" : role === "plan-fee" ? "fee" : null;
}
export const TRACKING_COST_PROBLEM = "Check this plan transfer: fees and interest are expenses; only principal reduces the plan account.";

/** Reciprocal identity, configured account and opposite amounts; each side reconciles independently. */
export function trackingTransferMatches(row: ActivityRow, plan: RepaymentPlan, snapshot: ActivitySnapshot) {
  if (!plan.tracking || !row.transferKnown || !row.transferId) return false;
  const peer = trackingRowIndex(snapshot).get(row.transferId);
  if (conflictingIds.get(snapshot)?.has(row.id) || conflictingIds.get(snapshot)?.has(peer?.id ?? "")) return false;
  return Boolean(peer && peer.transferKnown && peer.transferId === row.id && peer.amountMinor === -row.amountMinor && (row.accountId === plan.tracking.accountId && peer.accountId === snapshot.accountId || peer.accountId === plan.tracking.accountId && row.accountId === snapshot.accountId));
}
export function planOwnsTrackingRow(plan: RepaymentPlan, row: ActivityRow, snapshot: ActivitySnapshot, links: PlanLink[] = []) {
  const peer = row.transferId ? trackingRowIndex(snapshot).get(row.transferId) : undefined;
  const explicit = links.filter((link) => link.transactionId === row.id || link.transactionId === peer?.id);
  if (explicit.length) return explicit.some((link) => link.planId === plan.id && (link.transactionId === row.id ? link.fingerprint === row.fingerprint : link.fingerprint === peer?.fingerprint));
  return Boolean(plan.tracking && (hasPlanTag(row.notes, plan.tracking.tag) || hasPlanTag(peer?.notes ?? null, plan.tracking.tag)));
}
const assignedCache = new WeakMap<RepaymentPlan, WeakMap<ActivitySnapshot, { links: PlanLink[]; rows: ActivityRow[] }>>();
const noLinks: PlanLink[] = [];
function assignedRows(plan: RepaymentPlan, snapshot: ActivitySnapshot, links: PlanLink[]) {
  let snapshots = assignedCache.get(plan);
  if (!snapshots) { snapshots = new WeakMap(); assignedCache.set(plan, snapshots); }
  const previous = snapshots.get(snapshot);
  if (previous?.links === links) return previous.rows;
  const rows = snapshot.trackingAccounts?.find((account) => account.accountId === plan.tracking?.accountId)?.rows.filter((row) => planOwnsTrackingRow(plan, row, snapshot, links)) ?? [];
  snapshots.set(snapshot, { links, rows });
  return rows;
}

type BalanceSeries = { dates: string[]; signed: number[]; confirmed: number[] };
const seriesCache = new WeakMap<ActivityRow[], BalanceSeries>();
/** Prefix balances in integer minor units; repeated historical cutoffs use binary search. */
function balanceThrough(rows: ActivityRow[], date: string) {
  let series = seriesCache.get(rows);
  if (!series) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    series = { dates: [], signed: [0], confirmed: [0] };
    for (const row of sorted) {
      series.dates.push(row.date);
      series.signed.push(sum([series.signed.at(-1)!, row.amountMinor]));
      series.confirmed.push(sum([series.confirmed.at(-1)!, row.cleared === true ? row.amountMinor : 0]));
    }
    seriesCache.set(rows, series);
  }
  let low = 0, high = series.dates.length;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (series.dates[middle] <= date) low = middle + 1; else high = middle; }
  return { signed: series.signed[low], confirmed: series.confirmed[low] };
}

/** Assigned recorded principal, integer minor units. Opening is end-of-day and counted once. */
export function trackingBalance(plan: RepaymentPlan, snapshot: ActivitySnapshot, date: string, links: PlanLink[] = noLinks) {
  if (!plan.tracking) return null;
  const account = snapshot.trackingAccounts?.find((entry) => entry.accountId === plan.tracking!.accountId);
  const opening = plan.opening;
  if (!account || account.issues.length || account.to < date || opening && opening.date > date) return null;
  const assigned = assignedRows(plan, snapshot, links);
  trackingRowIndex(snapshot);
  if (assigned.some((row) => conflictingIds.get(snapshot)?.has(row.id) || row.transferId && conflictingIds.get(snapshot)?.has(row.transferId))) return null;
  if (!opening && !assigned.length) return null;
  const current = balanceThrough(assigned, date);
  const before = opening ? balanceThrough(assigned, opening.date) : { signed: 0, confirmed: 0 };
  return { signedMinor: sum([-(opening?.principalMinor ?? 0), current.signed, -before.signed]), confirmedSignedMinor: sum([-(opening?.principalMinor ?? 0), current.confirmed, -before.confirmed]) };
}
export function hasTrackingCostTransfer(plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot, date: string) {
  return assignedRows(plan, snapshot, workspace.planLinks ?? noLinks).some((row) => {
    if (row.date > date || plan.opening && row.date <= plan.opening.date || !row.transferId) return false;
    const peer = trackingRowIndex(snapshot).get(row.transferId);
    return peer?.accountId === card.accountId && financingCostKind(peer, card, workspace) !== null;
  });
}

/** Shared account assignments, never the whole account on every card. */
export function trackedCardDebt(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, signedCardMinor: number, date: string) {
  const plans = workspace.plans?.filter((plan) => plan.cardId === card.id && plan.tracking) ?? [];
  const links = workspace.planLinks ?? noLinks, problems: string[] = [];
  // Account-level remainder is separate from this card’s plan validity; integer minor units.
  const sharedAccounts: { accountId: string; differenceMinor: number; unlinkedCurrentCount: number }[] = [];
  let trackingSignedMinor = 0, confirmedTrackingSignedMinor = 0, transitSignedMinor = 0, confirmedTransitSignedMinor = 0, invalid = false;
  const all = trackingRowIndex(snapshot), pairs = new Set<string>();
  for (const plan of plans) {
    const binding = plan.tracking!;
    if (links.some((link) => link.planId === plan.id && all.get(link.transactionId)?.fingerprint !== link.fingerprint)) { problems.push("Check this link: a plan entry changed or is unavailable"); invalid = true; }
    if (binding.tag && workspace.plans?.some((other) => other.id !== plan.id && other.tracking?.accountId === binding.accountId && other.tracking.tag === binding.tag)) { problems.push("A plan reference is assigned twice"); invalid = true; }
    if (hasTrackingCostTransfer(plan, card, workspace, snapshot, date)) { problems.push(TRACKING_COST_PROBLEM); invalid = true; }
    const balance = trackingBalance(plan, snapshot, date, links);
    if (!balance) { problems.push("Load the plan account history"); continue; }
    trackingSignedMinor = sum([trackingSignedMinor, balance.signedMinor]);
    confirmedTrackingSignedMinor = sum([confirmedTrackingSignedMinor, balance.confirmedSignedMinor]);
    if (balance.signedMinor > 0) { problems.push("Check the plan opening and principal transfers"); invalid = true; }
    for (const row of accountRows.get(snapshot)?.get(binding.accountId) ?? []) {
      if (!planOwnsTrackingRow(plan, row, snapshot, links)) continue;
      if (!row.transferId) continue;
      const peer = all.get(row.transferId);
      if (!peer || peer.accountId !== card.accountId || !trackingTransferMatches(row, plan, snapshot)) { problems.push("Check this plan transfer link"); invalid = true; continue; }
      if (row.date > date && peer.date > date) continue;
      const key = [row.id, peer.id].sort().join(":");
      if (!pairs.has(key)) {
        // Neutralize each one-sided internal movement on its own reporting basis.
        if ((row.date <= date) !== (peer.date <= date)) transitSignedMinor = sum([transitSignedMinor, -(row.date <= date ? row.amountMinor : peer.amountMinor)]);
        const rowConfirmed = row.date <= date && row.cleared === true;
        const peerConfirmed = peer.date <= date && peer.cleared === true;
        if (rowConfirmed !== peerConfirmed) confirmedTransitSignedMinor = sum([confirmedTransitSignedMinor, -(rowConfirmed ? row.amountMinor : peer.amountMinor)]);
        pairs.add(key);
      }
    }
  }
  for (const accountId of new Set(plans.map((plan) => plan.tracking!.accountId))) {
    const account = snapshot.trackingAccounts?.find((entry) => entry.accountId === accountId);
    const allPlans = workspace.plans?.filter((plan) => plan.tracking?.accountId === accountId) ?? [];
    if (account?.rows.some((row) => row.date <= date && allPlans.filter((plan) => planOwnsTrackingRow(plan, row, snapshot, links)).length > 1)) { problems.push("A plan entry is assigned more than once"); invalid = true; }
    const allocations = allPlans.map((plan) => trackingBalance(plan, snapshot, date, links));
    if (!account || account.signedBalanceMinor === undefined || allocations.some((entry) => !entry)) { problems.push("Plan account total unavailable"); continue; }
    const actual = sum([account.signedBalanceMinor, ...account.rows.filter((row) => row.date > date).map((row) => -row.amountMinor)]);
    const differenceMinor = sum(allocations.map((entry) => entry!.signedMinor)) - actual;
    if (differenceMinor !== 0) sharedAccounts.push({ accountId, differenceMinor, unlinkedCurrentCount: unassignedPlanEntries(workspace, snapshot, card).filter((row) => row.accountId === accountId && row.date <= date).length });
  }
  const pendingCard = sum(snapshot.rows.filter((row) => row.date <= date && row.cleared !== true).map((row) => row.amountMinor));
  const pendingCredits = sum(snapshot.rows.filter((row) => row.date <= date && row.cleared !== true && row.amountMinor > 0 && !isTrackingTransfer(row, snapshot, workspace)).map((row) => row.amountMinor));
  const signedMinor = sum([signedCardMinor, trackingSignedMinor, transitSignedMinor]);
  const confirmedSignedMinor = sum([signedCardMinor, -pendingCard, confirmedTrackingSignedMinor, confirmedTransitSignedMinor]);
  // Signed integer minor units eligible for credit capacity; pending credits cannot release it.
  const capacitySignedMinor = sum([signedMinor, -pendingCredits]);
  return { capacitySignedMinor, tracked: plans.length > 0, known: plans.every((plan) => trackingBalance(plan, snapshot, date, links) !== null) && !invalid, trackingMinor: -trackingSignedMinor, transitMinor: -transitSignedMinor, signedMinor, debtMinor: Math.max(0, -signedMinor), confirmedDebtMinor: Math.max(0, -confirmedSignedMinor), creditUsedMinor: Math.max(0, -capacitySignedMinor), problems: [...new Set(problems)], sharedAccounts };
}
export function unassignedPlanEntries(workspace: Workspace, snapshot: ActivitySnapshot, card?: Card) {
  const index = trackingRowIndex(snapshot);
  return (snapshot.trackingAccounts ?? []).flatMap((account) => account.rows.filter((row) => (!card || index.get(row.transferId ?? "")?.accountId === card.accountId && workspace.plans?.some((plan) => plan.cardId === card.id && plan.tracking?.accountId === account.accountId && (!plan.opening || row.date > plan.opening.date))) && !(workspace.plans ?? []).filter((plan) => plan.tracking?.accountId === account.accountId).some((plan) => planOwnsTrackingRow(plan, row, snapshot, workspace.planLinks))).map((row) => ({ ...row, accountLabel: snapshot.accounts?.find((entry) => entry.id === row.accountId)?.name ?? "Plan account" })));
}

/** Recorded history; billing alone never repays debt. */
export function trackedDebtPoints(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, signedCardTodayMinor: number, dates: string[]) {
  const total = balanceThrough(snapshot.rows, "9999-12-31").signed;
  return dates.map((date) => {
    if (date < snapshot.from || date > snapshot.to) return { date, value: null };
    const signed = sum([signedCardTodayMinor, -total, balanceThrough(snapshot.rows, date).signed]);
    const debt = trackedCardDebt(card, workspace, snapshot, signed, date);
    return { date, value: debt.known ? debt.debtMinor : null, source: "Recorded total debt", breakdown: [{ label: "On card", value: -signed }, ...(debt.tracked ? [{ label: "In plan account", value: debt.known ? debt.trackingMinor : null }, ...(debt.transitMinor ? [{ label: "Transfer in transit", value: debt.transitMinor }] : [])] : [])] };
  });
}
