import type { ActivityRow, ActivitySnapshot } from "../activity";
import type { Card, Workspace } from "../models";
import { safeIntegerSum } from "../minor";
import { ownerOf, peerOf, planAccountHistory, planAccountIds } from "./planAccounts";

/**
 * A plan found in a plan account (D4: one #tag per plan in a shared account, or a whole account for
 * one plan). Figures are positive minor units; nothing is created until the user saves it.
 */
export type PlanCandidate = {
  key: string;
  accountId: string;
  accountName: string;
  /** The plan's tag, or null when the whole account is one plan. */
  tag: string | null;
  /** Other tags on exactly the same transfers (e.g. a card tag beside the plan tag): either could be the plan's. */
  alternativeTags: string[];
  /** From the booking's notes without tags, else from the tag. */
  name: string;
  /** Earliest booking (principal moved into the plan account). */
  startDate: string | null;
  originalMinor: number;
  /** Principal moved back to the card since the booking. */
  movedBackMinor: number;
  remainingMinor: number;
  finished: boolean;
  lastDate: string;
  transfers: number;
  bookings: number;
  /** The plan-account rows behind the candidate. */
  rowIds: string[];
};

export type PlanDiscovery = {
  candidates: PlanCandidate[];
  /** Transfers carrying two or more plan tags: fix the tags in Actual. */
  ambiguous: ActivityRow[];
};

const MONTH_TAG = /^#\d{4}-(0[1-9]|1[0-2])$/;
const tagsIn = (notes: string | null | undefined) => Array.from(notes?.match(/#[\p{L}\p{N}_-]+/gu) ?? []);
const plainNotes = (notes: string | null | undefined) => (notes ?? "").replace(/#[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
const nameFromTag = (tag: string) => tag.slice(1).replace(/[_-]+/g, " ").trim();
const total = (values: number[]) => safeIntegerSum(values) ?? values.reduce((sum, value) => sum + value, 0);

const discoveries = new WeakMap<ActivitySnapshot, WeakMap<Workspace["plans"], WeakMap<Workspace["planAccounts"], WeakMap<Card, PlanDiscovery>>>>();

/**
 * Plans waiting in this card's plan accounts, from transfers no plan owns yet. Rules, for any bank:
 * statement-month tags (#YYYY-MM) never name a plan; a tag that spans several plan tags (an umbrella
 * such as a bank or card tag) is ignored; a transfer left with exactly one tag belongs to that tag's
 * candidate, with two or more it is ambiguous. An account with no plans and no tags is one candidate.
 */
export function discoverPlans(card: Card, workspace: Workspace, snapshot: ActivitySnapshot): PlanDiscovery {
  let byPlans = discoveries.get(snapshot);
  if (!byPlans) discoveries.set(snapshot, byPlans = new WeakMap());
  let byAccounts = byPlans.get(workspace.plans);
  if (!byAccounts) byPlans.set(workspace.plans, byAccounts = new WeakMap());
  // The registered plan accounts decide which accounts are searched.
  let byCard = byAccounts.get(workspace.planAccounts);
  if (!byCard) byAccounts.set(workspace.planAccounts, byCard = new WeakMap());
  let found = byCard.get(card);
  if (!found) byCard.set(card, found = build(card, workspace, snapshot));
  return found;
}

function build(card: Card, workspace: Workspace, snapshot: ActivitySnapshot): PlanDiscovery {
  const candidates: PlanCandidate[] = [];
  const ambiguous: ActivityRow[] = [];
  for (const accountId of planAccountIds(workspace)) {
    const history = planAccountHistory(snapshot, accountId);
    if (!history || history.issues.length) continue;
    const accountName = snapshot.accounts?.find((account) => account.id === accountId)?.name ?? "Plan account";
    const used = new Set(workspace.plans.filter((plan) => plan.planAccountId === accountId && plan.planAccountTag).map((plan) => plan.planAccountTag!));
    const accountHasPlans = workspace.plans.some((plan) => plan.planAccountId === accountId);
    // This card's transfers with the account that no plan owns yet.
    const rows = history.rows.filter((row) => peerOf(row, snapshot)?.accountId === card.accountId && !ownerOf(row, workspace.plans, snapshot));
    if (!rows.length) continue;
    const tagsOf = new Map(rows.map((row) => [row.id, [...new Set([...tagsIn(row.notes), ...tagsIn(peerOf(row, snapshot)?.notes)])]
      .filter((tag) => !MONTH_TAG.test(tag) && !used.has(tag))]));
    // Umbrella tags (a bank or card tag) sit on bookings of several plans: the bookings carrying them
    // split into two or more groups by their other tags. A plan topped up with a second booking keeps
    // its tag (its bookings share the same other tags); a transfer carrying two plan tags stays ambiguous.
    const bookingsOf = new Map<string, ActivityRow[]>();
    for (const row of rows.filter((entry) => entry.amountMinor < 0)) {
      for (const tag of tagsOf.get(row.id)!) bookingsOf.set(tag, [...(bookingsOf.get(tag) ?? []), row]);
    }
    const umbrella = new Set([...bookingsOf].filter(([tag, list]) => new Set(list
      .map((row) => tagsOf.get(row.id)!.filter((other) => other !== tag).sort().join(" "))
      .filter(Boolean)).size >= 2).map(([tag]) => tag));
    // Tags carried by exactly the same transfers are one choice: keep the first, offer the rest.
    const rowsOf = new Map<string, string>();
    for (const row of rows) for (const tag of tagsOf.get(row.id)!) rowsOf.set(tag, `${rowsOf.get(tag) ?? ""}|${row.id}`);
    const alternatives = new Map<string, string[]>();
    const merged = new Set<string>();
    for (const tag of [...rowsOf.keys()].sort()) {
      if (umbrella.has(tag) || merged.has(tag)) continue;
      const same = [...rowsOf.keys()].filter((other) => other !== tag && !umbrella.has(other) && rowsOf.get(other) === rowsOf.get(tag));
      for (const other of same) merged.add(other);
      alternatives.set(tag, same.sort());
    }
    const groups = new Map<string, ActivityRow[]>();
    const untagged: ActivityRow[] = [];
    for (const row of rows) {
      const tags = tagsOf.get(row.id)!.filter((tag) => !umbrella.has(tag) && !merged.has(tag));
      if (tags.length > 1) ambiguous.push(row);
      else if (tags.length === 1) groups.set(tags[0], [...(groups.get(tags[0]) ?? []), row]);
      else untagged.push(row);
    }
    // No tags at all in an account without plans: the whole account is one plan.
    if (!groups.size && !accountHasPlans && untagged.length) groups.set("", untagged);
    for (const [tag, group] of groups) {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const bookings = sorted.filter((row) => row.amountMinor < 0);
      const originalMinor = -total(bookings.map((row) => row.amountMinor));
      const movedBackMinor = total(sorted.filter((row) => row.amountMinor > 0).map((row) => row.amountMinor));
      const booking = bookings[0];
      const bookingNotes = booking ? plainNotes(booking.notes) || plainNotes(peerOf(booking, snapshot)?.notes) : "";
      candidates.push({
        key: `${accountId}:${tag}`,
        accountId,
        accountName,
        tag: tag || null,
        alternativeTags: alternatives.get(tag) ?? [],
        name: bookingNotes || (tag ? nameFromTag(tag) : accountName),
        startDate: booking?.date ?? null,
        originalMinor,
        movedBackMinor,
        remainingMinor: Math.max(0, originalMinor - movedBackMinor),
        finished: bookings.length > 0 && movedBackMinor >= originalMinor,
        lastDate: sorted.at(-1)!.date,
        transfers: sorted.length,
        bookings: bookings.length,
        rowIds: sorted.map((row) => row.id),
      });
    }
  }
  candidates.sort((a, b) => Number(a.finished) - Number(b.finished) || (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  return { candidates, ambiguous };
}
