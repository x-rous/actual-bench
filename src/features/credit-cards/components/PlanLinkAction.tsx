"use client";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import type { Card, Workspace } from "../lib/models";
import { planForTransaction, suggestPlanLink } from "../lib/plans";
import { trackingTransferMatches } from "../lib/planTracking";
import { PlanEditor } from "./PlanEditor";

/** Shared entry point; plan edits never discard the surrounding statement's membership draft. */
export function PlanLinkAction({ budget, card, row, workspace, snapshot, available }: { budget: string; card: Card; row: ActivityRow; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean }) {
  const existing = planForTransaction(workspace, row.id);
  const [choosing, setChoosing] = useState(false);
  const [planId, setPlanId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const plans = (workspace.plans ?? []).filter((plan) => plan.cardId === card.id && (plan.status === "active" || plan.id === existing?.id));
  const plan = workspace.plans?.find((entry) => entry.id === editing);
  if (row.transferId && !plans.some((entry) => trackingTransferMatches(row, entry, snapshot)) || (!plans.length && !existing)) return null;
  return <><Button size="icon-xs" variant="ghost" disabled={!available} aria-label={`${existing ? "Manage plan link" : "Link to plan"} for ${row.label}`} title={existing ? "Manage plan and linked transactions" : "Link to an existing plan"} onClick={() => existing ? setEditing(existing.id) : setChoosing(true)}><Link2 className="size-3" aria-hidden /></Button>
    <Dialog open={choosing} onOpenChange={setChoosing}><DialogContent><DialogTitle>Link transaction to a plan</DialogTitle><DialogDescription>{row.label} · {formatAmount(row.amountMinor, 2)}. Select a plan, then confirm the posting role in Transactions. This does not change statement inclusion or the Actual category.</DialogDescription><Select aria-label="Existing repayment plan" value={planId} onValueChange={setPlanId} options={[{ value: "", label: "Choose plan" }, ...plans.map((entry) => { const source = snapshot.rows.find((posting) => posting.id === entry.transactionId); const match = suggestPlanLink(row, entry, card, workspace.planLinks?.filter((link) => link.planId === entry.id) ?? [], snapshot, workspace); return { value: entry.id, label: `${entry.reference || source?.label || "Existing plan"} · ${formatAmount(entry.amountMinor, 2)}${match ? ` · ${match.reason}` : ""}` }; })]} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setChoosing(false)}>Cancel</Button><Button disabled={!planId} onClick={() => { setEditing(planId); setChoosing(false); }}>Review link</Button></div></DialogContent></Dialog>
    {plan && <PlanEditor key={plan.id} budget={budget} card={card} row={row} plan={plan} workspace={workspace} snapshot={snapshot} available={available} initialTab="transactions" focusTransactionId={row.id} onClose={() => setEditing(null)} />}
  </>;
}
