"use client";
import { CalendarRange } from "lucide-react";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import type { Card, RepaymentPlan, TransactionType, Workspace } from "../lib/models";
import { familyOf } from "../lib/derive/families";
import { currentPlanEntry, planForTransaction } from "../lib/derive/indexes";
import { isPlanAccountTransfer, ownerOf, peerOf } from "../lib/derive/planAccounts";
import { roleLabels } from "../lib/plans";

export type PlanLink = { plan: RepaymentPlan | null; role: string; via: string };

/**
 * The plan a card transaction belongs to, its role, and why: a link you made, or (for plan-account
 * transfers, D4) the plan account or its #tag. One rule for Activity, review and the plan view.
 */
export function planOf(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot): PlanLink {
  const linked = planForTransaction(workspace, row.id);
  const peer = peerOf(row, snapshot);
  const owner = linked ?? (peer ? ownerOf(peer, workspace.plans, snapshot) : undefined);
  if (!owner || owner.cardId !== card.id) return { plan: null, role: "", via: "" };
  const entry = currentPlanEntry(workspace, row);
  const role = entry
    ? entry.instalmentNumber !== null && owner.instalmentCount !== null
      ? `Instalment ${entry.instalmentNumber}/${owner.instalmentCount}` : roleLabels[entry.role]
    : linked ? "Changed in Actual" : row.amountMinor > 0 ? "Conversion" : "Instalment";
  const via = linked ? "linked by you" : owner.planAccountTag ? `via tag ${owner.planAccountTag}` : "own plan account";
  return { plan: owner, role, via };
}

/**
 * Why a plan-account transfer belongs where it does (D4), in words: ownership comes from the account
 * or its #tag, never from a link, so the fix is always made in Actual. Null for any other row.
 */
export function transferOwnership(row: ActivityRow, workspace: Workspace, snapshot: ActivitySnapshot) {
  if (!isPlanAccountTransfer(row, snapshot, workspace)) return null;
  const peer = peerOf(row, snapshot)!;
  const planLeg = workspace.plans.some((plan) => plan.planAccountId === row.accountId) ? row : peer;
  const account = snapshot.accounts?.find((entry) => entry.id === planLeg.accountId)?.name ?? "the plan account";
  const owner = ownerOf(planLeg, workspace.plans, snapshot);
  if (owner?.planAccountTag) {
    return `Belongs to plan ${owner.name} because its notes contain ${owner.planAccountTag}. To move it, change the tag in Actual, then Refresh.`;
  }
  if (owner) return `Belongs to plan ${owner.name}: everything in ${account} belongs to it. To move it, change the account in Actual.`;
  const tags = workspace.plans.filter((plan) => plan.planAccountId === planLeg.accountId && plan.planAccountTag).map((plan) => plan.planAccountTag);
  return tags.length
    ? `A transfer with ${account} that no plan claims yet. Add ${tags.join(" or ")} to its notes in Actual, then Refresh.`
    : `A transfer with ${account}. Add a plan that uses this account to count it.`;
}

/**
 * Amount colours on credit-card transaction tables (owner decision, 18 Oct 2026): money back in green,
 * interest and fees in amber, everything else in the default colour. Red stays for errors and overdue.
 */
export function amountClass(kind: TransactionType, amountMinor: number) {
  const family = familyOf(kind);
  if (amountMinor > 0 && (family === "payment" || family === "refund" || family === "cashback" || family === "interest" || family === "fee")) {
    return "text-green-700 dark:text-green-400";
  }
  if (amountMinor < 0 && (family === "interest" || family === "fee")) return "text-amber-700 dark:text-amber-400";
  return undefined;
}

/** A small plan icon beside the type: the plan, the role and how it is linked; opens the plan. */
export function PlanMark({ link, onOpen }: { link: PlanLink; onOpen?: (planId: string) => void }) {
  if (!link.plan) return null;
  const text = `${link.plan.name} · ${link.role} · ${link.via}`;
  const plan = link.plan;
  return <button
    type="button"
    tabIndex={-1}
    title={text}
    aria-label={`Plan ${text}`}
    disabled={!onOpen}
    onClick={() => onOpen?.(plan.id)}
    className="inline-flex shrink-0 items-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
  ><CalendarRange className="size-3.5" aria-hidden /></button>;
}
