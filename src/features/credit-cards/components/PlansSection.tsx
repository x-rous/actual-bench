"use client";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { formatCardDate } from "../lib/displayDates";
import type { Card, RepaymentPlan, Workspace } from "../lib/models";
import type { ActivitySnapshot } from "../lib/activity";
import { trackingBalance, trackingRowIndex, unassignedPlanEntries } from "../lib/planTracking";
import { planHealth, planProgress } from "../lib/plans";
import { creditCardStore } from "../lib/memory";
import { sumMinor } from "../lib/statements";
import { PlanEditor } from "./PlanEditor";
import { Status } from "./WorkspaceVisuals";
import { FieldInfo } from "./FieldInfo";

export function PlansSection({ budget, card, workspace, snapshot, available, today }: { budget: string; card: Card; workspace: Workspace; snapshot?: ActivitySnapshot; available: boolean; today: string }) {
  const plans = workspace.plans?.filter((plan) => plan.cardId === card.id) ?? [];
  const [editor, setEditor] = useState<{ plan?: RepaymentPlan; focus?: string } | null>(null);
  const [removing, setRemoving] = useState<RepaymentPlan | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [assignment, setAssignment] = useState("");
  const [error, setError] = useState("");
  const index = snapshot ? trackingRowIndex(snapshot) : new Map();
  const unassigned = snapshot ? unassignedPlanEntries(workspace, snapshot, card) : [];
  const dialogs = <>
    {editor && snapshot && <PlanEditor key={`${editor.plan?.id ?? "new"}:${editor.focus ?? ""}`} budget={budget} card={card} plan={editor.plan} workspace={workspace} snapshot={snapshot} available={available} focusTransactionId={editor.focus} initialTab={editor.focus ? "transactions" : "terms"} onClose={() => setEditor(null)} />}
    <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }}><DialogContent><DialogTitle>Remove plan metadata?</DialogTitle><DialogDescription>Actual balances stay unchanged. Remaining principal must be moved or reassigned before its tracking setup is removed. Undo is available.</DialogDescription>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRemoving(null)}>Keep plan</Button><Button variant="destructive" onClick={() => { try { creditCardStore.getState().deletePlan(budget, removing!.id, removing!.revision, card.revision, snapshot); setRemoving(null); } catch (cause) { setError((cause as Error).message); } }}>Remove plan</Button></div></DialogContent></Dialog>
    <Dialog open={reviewing} onOpenChange={setReviewing}><DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-3xl"><DialogTitle>Review plan entries</DialogTitle><DialogDescription>Only unlinked plan-account transfers for this credit card are shown. Choose its plan, then review the link in Transactions.</DialogDescription><Select aria-label="Assign entries to plan" value={assignment} onValueChange={setAssignment} options={[{ value: "", label: "Choose plan" }, ...plans.filter((plan) => plan.tracking).map((plan) => ({ value: plan.id, label: plan.reference || index.get(plan.sourceTransactions[0]?.transactionId ?? "")?.label || "Existing plan" }))]} /><table className="w-full text-left text-xs"><thead><tr><th>Date</th><th>Entry</th><th>Amount</th><th>Action</th></tr></thead><tbody>{unassigned.map((row) => <tr key={row.id} className="border-t"><td className="py-2">{formatCardDate(row.date)}</td><td>{row.label}</td><td>{formatAmount(row.amountMinor, 2)}</td><td><Button size="xs" variant="outline" disabled={!plans.some((plan) => plan.id === assignment && plan.tracking?.accountId === row.accountId)} onClick={() => { setEditor({ plan: plans.find((plan) => plan.id === assignment), focus: row.transferId && snapshot?.rows.some((entry) => entry.id === row.transferId) ? row.transferId : row.id }); setReviewing(false); }}>Review link</Button></td></tr>)}</tbody></table></DialogContent></Dialog>
  </>;
  if (!plans.length) return null;
  return <section id="card-plans" className="overflow-hidden rounded-lg border bg-background" aria-label="Repayment plans"><div className="flex items-center justify-between gap-3 border-b px-4 py-2.5"><h2 className="text-sm font-semibold">Repayment plans <span className="ml-1 text-xs font-normal text-muted-foreground">{plans.filter((plan) => plan.status === "active").length} active</span></h2><div className="flex gap-2">{unassigned.length > 0 && <Button size="sm" variant="outline" onClick={() => setReviewing(true)}>Review plan entries ({unassigned.length})</Button>}</div></div>
    <div className="overflow-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="bg-muted/20 text-muted-foreground"><tr>{["Plan", "Plan account", "Billed this month", "Progress", "Next expected", "Status", "Actions"].map((label) => <th key={label} className="px-4 py-2.5 font-medium">{label}</th>)}</tr></thead><tbody>{plans.map((plan) => {
      const source = index.get(plan.sourceTransactions[0]?.transactionId ?? "");
      const links = workspace.planLinks?.filter((link) => link.planId === plan.id) ?? [];
      const billed = links.filter((link) => ["instalment-billed", "combined-instalment"].includes(link.role) && index.get(link.transactionId)?.fingerprint === link.fingerprint);
      const actual = billed.flatMap((link) => { const row = index.get(link.transactionId); return row && row.date.slice(0, 7) === today.slice(0, 7) ? [-row.amountMinor] : []; });
      const progress = planProgress(plan, card, links.filter((link) => index.get(link.transactionId)?.fingerprint === link.fingerprint));
      const next = plan.status === "active" ? progress.next : undefined;
      const remaining = snapshot && trackingBalance(plan, snapshot, today, workspace.planLinks);
      const health = snapshot ? planHealth(plan, workspace, snapshot, today, available) : { status: "Needs review", reasons: ["Refresh Actual activity"], pending: false };
      const name = plan.reference || source?.label || "Existing repayment plan";
      return <tr key={plan.id} className="border-t"><td className="px-4 py-2.5"><p className="font-medium">{name}</p><p className="mt-1 text-muted-foreground">{plan.balanceOnly ? "Balance only" : plan.recording === "retained" ? "Balance kept on card" : "Linked Actual entries"}</p>{health.reasons.length > 0 && <div className="flex items-center text-muted-foreground">Check plan<FieldInfo label={`Plan checks for ${name}`}>{health.reasons.join(" · ")}</FieldInfo></div>}</td><td className="px-4 py-2.5 tabular-nums">{plan.tracking ? remaining ? formatAmount(-remaining.signedMinor, 2) : "Refresh plan account" : "On card"}</td><td className="px-4 py-2.5 tabular-nums">{formatAmount(sumMinor(actual), 2)}</td><td className="px-4 py-2.5">{plan.balanceOnly ? "Balance only" : `${progress.billedCount} of ${progress.tracked.length} tracked billed${progress.earlier ? ` · ${progress.earlier} earlier` : ""}`}{health.pending && <p className="mt-1 text-muted-foreground">Clearing not confirmed</p>}</td><td className="px-4 py-2.5">{next ? <>{formatAmount(next.amountMinor, 2)}<p className="mt-1 text-muted-foreground">{formatCardDate(next.date)}</p></> : "-"}</td><td className="px-4 py-2.5"><Status tone={health.status === "Needs review" ? "attention" : health.status === "Active" ? "info" : "neutral"}>{health.status}</Status></td><td className="px-4 py-2.5"><div className="flex gap-1"><Button size="icon-xs" variant="ghost" aria-label={`Edit plan ${name}`} disabled={!available} onClick={() => setEditor({ plan })}><Pencil className="size-3.5" aria-hidden /></Button><Button size="icon-xs" variant="ghost" aria-label={`Remove plan ${name}`} onClick={() => { setError(""); setRemoving(plan); }}><Trash2 className="size-3.5" aria-hidden /></Button></div></td></tr>;
    })}</tbody></table></div>{dialogs}
  </section>;
}
