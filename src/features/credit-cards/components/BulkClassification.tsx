"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { creditCardStore } from "../lib/memory";
import { type ActivityRow, type ActivitySnapshot } from "../lib/activity";
import type { Card, Workspace, ActivityClassification } from "../lib/models";
import { classificationChoices, classificationLabels, feeLabels } from "../lib/classifications";

type Props = { budget: string; card: Card; workspace: Workspace; snapshot: ActivitySnapshot; rows: ActivityRow[]; selected?: ActivityRow[]; available: boolean; onMappings?: () => void; onDone?: () => void; toolbar?: boolean; onClearSelection?: () => void };

/** The same classification choices and atomic guards as the individual correction control. */
export function BulkClassification({ budget, card, snapshot, selected = [], available, onMappings, onDone, toolbar = false, onClearSelection }: Props) {
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const [kind, setKind] = useState<ActivityClassification["kind"]>("purchase");
  const [feeSubtype, setFeeSubtype] = useState("other");
  const [revision, setRevision] = useState(card.revision);
  const choices = selected.length ? classificationChoices(selected[0]).filter((choice) => selected.every((row) => classificationChoices(row).includes(choice))) : [];
  function apply() {
    try {
      if (!available) throw new Error("Refresh Actual activity before classifying");
      creditCardStore.getState().classifyMany(budget, card.id, revision, snapshot, selected.map((row) => ({ cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind, feeSubtype: kind === "fee" ? feeSubtype : null, reason: "Classification confirmed by user" })));
      setError(""); setOpen(false); onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not classify selected activity"); }
  }
  if (!selected.length) return null;
  return <><div className={cn("flex shrink-0 flex-wrap items-center gap-2 text-xs", toolbar ? "border-b border-border/40 bg-primary/5 px-2 py-1.5" : "rounded-lg border bg-muted/20 p-3")} role="region" aria-label="Activity classification actions">
    <span className={toolbar ? "font-medium text-primary" : "mr-auto text-muted-foreground"}>{selected.length} {selected.length === 1 ? "transaction" : "transactions"} selected</span>
    {onMappings && <Button size="xs" variant="ghost" onClick={onMappings}>Set category mappings</Button>}
    <Button size="xs" disabled={!available || !choices.length} onClick={() => { setError(""); setRevision(card.revision); setKind(choices[0]); setOpen(true); }}>Classify selected ({selected.length})</Button>
    {onClearSelection && <Button className="ml-auto text-muted-foreground" size="xs" variant="ghost" onClick={onClearSelection}>Clear selection</Button>}
  </div><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Classify selected transactions</DialogTitle><DialogDescription>Updates Bench classifications only. Actual transactions stay unchanged. All selected rows are applied together or none are saved.</DialogDescription>
    <Select aria-label="Bulk classification" value={kind} onValueChange={(value) => setKind(value as ActivityClassification["kind"])} options={choices.map((value) => ({ value, label: classificationLabels[value] }))} />
    {kind === "fee" && <Select aria-label="Bulk fee type" value={feeSubtype} onValueChange={setFeeSubtype} options={Object.entries(feeLabels).map(([value, label]) => ({ value, label }))} />}
    <Button disabled={!available} onClick={apply}>Apply classification</Button>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </DialogContent></Dialog></>;
}
