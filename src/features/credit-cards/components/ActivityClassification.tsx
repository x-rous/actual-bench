"use client";
import { Pencil, LockKeyhole, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Card, Workspace, ActivityClassification as Classification } from "../lib/models";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { activityKind } from "../lib/activity";
import { creditCardStore } from "../lib/memory";
import { classificationLabels, chargeChoices, creditChoices, feeLabels, planEligibleKinds } from "../lib/classifications";
import { currentPlanLink, planForTransaction, roleLabels } from "../lib/plans";
import { formatCardDate } from "../lib/displayDates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { suggestedKind } from "./BulkClassification";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { PlanEditor } from "./PlanEditor";

export function ActivityClassification({ budget, card, row, workspace, snapshot, available, compact = false }: { budget: string; card: Card; row: ActivityRow; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; compact?: boolean }) {
  const current = activityKind(row, card, workspace, snapshot);
  const link = currentPlanLink(workspace, row);
  const linkedPlan = planForTransaction(workspace, row.id);
  const [initial, setInitial] = useState({ revision: card.revision, fingerprint: row.fingerprint });
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [kind, setKind] = useState<Classification["kind"]>("purchase");
  const [feeSubtype, setFeeSubtype] = useState<Classification["feeSubtype"]>(null);
  const [addPlan, setAddPlan] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const suggestion = ["unclassified", "ambiguous"].includes(current) ? suggestedKind(row) : null;
  const label = link ? roleLabels[link.role] : suggestion ? `${classificationLabels[suggestion]} (suggested)` : classificationLabels[current];
  const locked = current === "payment" || Boolean(link);
  const choices = row.amountMinor < 0 ? row.transferId ? chargeChoices.filter((choice) => !["purchase", "interest", "fee"].includes(choice)) : chargeChoices : creditChoices;
  const open = () => {
    const saved = workspace.classifications.find((entry) => entry.transactionId === row.id && entry.fingerprint === row.fingerprint);
    setInitial({ revision: card.revision, fingerprint: row.fingerprint });
    setKind(saved?.kind ?? (choices.includes(current as never) ? current as Classification["kind"] : choices[0]));
    setFeeSubtype(saved?.feeSubtype ?? null); setReason(saved?.reason ?? "Classification confirmed by user"); setAddPlan(false); setError(""); setEditing(true);
  };
  function save() {
    try {
      if (!available) throw new Error("Refresh Actual activity before classifying");
      creditCardStore.getState().classify(budget, card.id, initial.revision, snapshot, { cardId: card.id, transactionId: row.id, fingerprint: initial.fingerprint, kind, feeSubtype: kind === "fee" ? feeSubtype ?? "other" : null, reason });
      setEditing(false); if (addPlan && planEligibleKinds.includes(kind)) setPlanning(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not classify activity"); }
  }
  const [originalDraft, setOriginalDraft] = useState("");
  const signature = JSON.stringify({ kind, feeSubtype, reason, addPlan });
  const { requestClose, discardDialog } = useDiscardChanges(editing && signature !== originalDraft, () => setEditing(false));
  function edit() { open(); const saved = workspace.classifications.find((entry) => entry.transactionId === row.id && entry.fingerprint === row.fingerprint); setOriginalDraft(JSON.stringify({ kind: saved?.kind ?? (choices.includes(current as never) ? current : choices[0]), feeSubtype: saved?.feeSubtype ?? null, reason: saved?.reason ?? "Classification confirmed by user", addPlan: false })); }
  function confirmSuggestion() { try { if (!available || !suggestion) return; creditCardStore.getState().classify(budget, card.id, card.revision, snapshot, { cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind: suggestion, reason: "Suggested classification confirmed by user" }); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm suggestion"); } }
  return <><div className="flex min-w-0 items-center gap-1">{locked ? <span className="truncate text-xs" title={label}>{label}{compact && <LockKeyhole className="ml-1 inline size-3 text-muted-foreground" />}</span> : <Button variant="link" size="xs" className={`h-6 min-w-0 max-w-full gap-1 px-0 text-xs text-muted-foreground`} title={`Change classification: ${label}`} aria-label={`Classify ${row.label}`} onClick={edit}><span className="truncate">{compact ? label : label}</span><Pencil className="size-3 shrink-0" aria-hidden /></Button>}{suggestion && <Button size="icon-xs" variant="ghost" disabled={!available} aria-label={`Confirm suggested ${suggestion} for ${row.label}`} onClick={confirmSuggestion}><Check className="size-3" aria-hidden /></Button>}{!compact && !link && row.amountMinor < 0 && planEligibleKinds.includes(current) && <Button variant="ghost" size="xs" className="h-6 text-xs" onClick={() => setPlanning(true)}>{linkedPlan ? "View plan" : "Add plan"}</Button>}</div>
    <Dialog open={editing} onOpenChange={(next) => { if (!next) requestClose(); }}><DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-xl"><DialogHeader className="border-b p-5"><DialogTitle>Classify transaction</DialogTitle><DialogDescription>Sets how Bench counts it. The Actual category and amount don’t change.</DialogDescription></DialogHeader><div className="space-y-4 overflow-auto p-5"><div className="flex justify-between gap-3 rounded-xl border p-3"><div><p className="font-medium">{row.label}</p><p className="text-xs text-muted-foreground">{formatCardDate(row.date)} · {row.categoryName ?? "Uncategorized"} · {label}</p></div><strong className={`tabular-nums ${row.amountMinor < 0 ? "text-destructive" : ""}`}>{formatAmount(row.amountMinor, 2)}</strong></div><fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.amountMinor < 0 ? "Charges · adds to card debt" : "Credits · reduces card debt"}</legend><div role="group" aria-label="Transaction classification" className="grid gap-2 sm:grid-cols-2">{choices.map((choice) => <Button key={choice} variant="outline" className={`h-auto justify-start rounded-xl p-3 ${kind === choice ? "border-foreground ring-1 ring-foreground" : ""}`} aria-pressed={kind === choice} onClick={() => setKind(choice)}><span className={`size-3 rounded-full border ${kind === choice ? "border-foreground bg-foreground" : "border-border"}`} aria-hidden />{classificationLabels[choice]}</Button>)}</div></fieldset>
      {kind === "fee" && <div className="space-y-1.5"><Label htmlFor={`fee-${row.id}`}>Fee type</Label><Select id={`fee-${row.id}`} value={feeSubtype ?? "other"} onValueChange={(value) => setFeeSubtype(value as Classification["feeSubtype"])} options={Object.entries(feeLabels).map(([value, label]) => ({ value, label }))} /></div>}
      {planEligibleKinds.includes(kind) && <label className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm"><Checkbox checked={addPlan} onCheckedChange={setAddPlan} />Add an instalment plan next</label>}
      <div className="space-y-1.5"><Label htmlFor={`classification-reason-${row.id}`}>Reason (required)</Label><Input id={`classification-reason-${row.id}`} aria-label={`Classification reason for ${row.label}`} placeholder="Why this classification applies" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div><div className="flex justify-end gap-2 border-t bg-muted/10 p-4"><Button variant="outline" onClick={requestClose}>Cancel</Button><Button disabled={!available} onClick={save}>{addPlan && planEligibleKinds.includes(kind) ? "Save and add plan" : "Save classification"}</Button></div></DialogContent></Dialog>
    {discardDialog}{!editing && error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {planning && <PlanEditor budget={budget} card={card} row={row} plan={linkedPlan} workspace={workspace} snapshot={snapshot} available={available} onClose={() => setPlanning(false)} />}
  </>;
}
