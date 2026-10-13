"use client";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Card, Workspace, ActivityClassification as Classification } from "../lib/models";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { activityKind } from "../lib/activity";
import { creditCardStore } from "../lib/memory";

export function ActivityClassification({ budget, card, row, workspace, snapshot, available, compact = false }: {
  budget: string; card: Card; row: ActivityRow; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; compact?: boolean;
}) {
  const [initial, setInitial] = useState({ revision: card.revision, fingerprint: row.fingerprint });
  const [editing, setEditing] = useState(false);
  const current = activityKind(row, card, workspace, snapshot);
  const [kind, setKind] = useState<Classification["kind"]>(current === "ambiguous" || current === "payment" ? "other" : current);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (row.transferId && row.amountMinor > 0) return <span>{current}</span>;
  return <><div className={compact ? "flex min-w-0 items-center" : "flex flex-wrap items-center gap-1"}>{!compact && <span>{current.replaceAll("-", " ")}</span>}<Button variant="link" size="xs" className={compact ? "h-6 min-w-0 max-w-full gap-1 px-0 text-xs" : undefined} title={`Change classification: ${current.replaceAll("-", " ")}`} aria-label={`Classify ${row.label}`} onClick={() => { setInitial({ revision: card.revision, fingerprint: row.fingerprint }); setKind(current === "ambiguous" || current === "payment" ? "other" : current); setError(""); setEditing(true); }}>{compact ? <><span className="truncate">{current.replaceAll("-", " ")}</span><Pencil className="size-3 shrink-0" aria-hidden /></> : "Classify"}</Button></div><Dialog open={editing} onOpenChange={setEditing}><DialogContent><DialogTitle>Classify {row.label}</DialogTitle><DialogDescription>Identify the charge in this workspace. This does not change its category or transaction in Actual.</DialogDescription>
    <div className="flex flex-wrap gap-1">{(row.amountMinor < 0 ? row.transferId ? ["cash-advance", "other"] : ["purchase", "cash-advance", "interest", "fee", "other"] : ["refund", "other"]).map((value) => <Button key={value} size="xs" variant="outline" aria-pressed={kind === value} className={kind === value ? "border-primary bg-primary/10 text-primary" : undefined} onClick={() => setKind(value as Classification["kind"])}>{value.replaceAll("-", " ")}</Button>)}</div>
    <Input size="sm" aria-label={`Classification reason for ${row.label}`} placeholder="Reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
    <div className="flex gap-2"><Button size="xs" variant="outline" onClick={() => setEditing(false)}>Cancel</Button><Button size="xs" disabled={!available} onClick={() => {
      try {
        creditCardStore.getState().classify(budget, card.id, initial.revision, snapshot, { cardId: card.id, transactionId: row.id, fingerprint: initial.fingerprint, kind, reason });
        setEditing(false);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not classify activity"); }
    }}>Save classification</Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </DialogContent></Dialog></>;
}
