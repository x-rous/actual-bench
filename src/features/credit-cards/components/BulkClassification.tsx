"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { creditCardStore } from "../lib/memory";
import { activityKind, type ActivityRow, type ActivitySnapshot } from "../lib/activity";
import type { Card, Workspace, ActivityClassification } from "../lib/models";
import { currentPlanLink } from "../lib/plans";
import { chargeChoices, creditChoices, classificationLabels, feeLabels } from "../lib/classifications";
export function suggestedKind(row: ActivityRow) { return !row.transferId && row.transferKnown && row.amountMinor !== 0 ? row.amountMinor < 0 ? "purchase" as const : "refund" as const : null; }
export function BulkClassification({ budget, card, workspace, snapshot, rows, selected = [], available, onMappings, onDone }: { budget: string; card: Card; workspace: Workspace; snapshot: ActivitySnapshot; rows: ActivityRow[]; selected?: ActivityRow[]; available: boolean; onMappings?: () => void; onDone?: () => void }) {
  const [open, setOpen] = useState(false); const [error, setError] = useState("");
  const [kind, setKind] = useState<ActivityClassification["kind"]>("purchase");
  const [feeSubtype, setFeeSubtype] = useState("other");
  const [revision, setRevision] = useState(card.revision);
  const unknown = rows.filter((row) => ["unclassified", "ambiguous"].includes(activityKind(row, card, workspace, snapshot)));
  const charges = unknown.filter((row) => row.amountMinor < 0);
  const credits = unknown.filter((row) => row.amountMinor > 0);
  const purchases = charges.filter((row) => suggestedKind(row) === "purchase");
  const refunds = credits.filter((row) => suggestedKind(row) === "refund");
  const lockedSelection = selected.some((row) => activityKind(row, card, workspace, snapshot) === "payment" || Boolean(currentPlanLink(workspace, row)) || row.amountMinor === 0);
  const selectedCharges = selected.every((row) => row.amountMinor < 0);
  const mixed = selected.some((row) => row.amountMinor < 0) && selected.some((row) => row.amountMinor > 0);
  const choices = selectedCharges ? selected.some((row) => row.transferId) ? chargeChoices.filter((choice) => !["purchase", "interest", "fee"].includes(choice)) : chargeChoices : creditChoices;
  function apply(targets: ActivityRow[], type?: ActivityClassification["kind"], expected = card.revision) {
    try {
      if (!available) throw new Error("Refresh Actual activity before classifying");
      creditCardStore.getState().classifyMany(budget, card.id, expected, snapshot, targets.map((row) => ({ cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind: type ?? suggestedKind(row), feeSubtype: type === "fee" ? feeSubtype : null, reason: "Classification confirmed by user" })));
      setError(""); setOpen(false); onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not classify selected activity"); }
  }
  return <>{(unknown.length > 0 || selected.length > 0) && <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/20 p-3 text-xs" role="region" aria-label="Activity classification actions"><span className="mr-auto text-muted-foreground">{unknown.length ? `${charges.length} ${charges.length === 1 ? "charge" : "charges"} unclassified` : "Selected activity"}{credits.length ? ` · ${credits.length} ${credits.length === 1 ? "credit" : "credits"} unclassified` : ""}</span>{purchases.length > 0 && <Button size="xs" variant="outline" disabled={!available} onClick={() => apply(purchases, "purchase")}>Classify as purchases</Button>}{refunds.length > 0 && <Button size="xs" variant="outline" disabled={!available} onClick={() => apply(refunds, "refund")}>Confirm suggested refunds</Button>}{onMappings && <Button size="xs" variant="ghost" onClick={onMappings}>Set category mappings</Button>}{selected.length > 0 && <Button size="xs" disabled={!available || lockedSelection} title={lockedSelection ? "Deselect payments and linked plan postings before bulk classification" : undefined} onClick={() => { setRevision(card.revision); setKind(choices[0]); setOpen(true); }}>Classify selected ({selected.length})</Button>}{error && <p role="alert" className="w-full text-destructive">{error}</p>}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Classify selected transactions</DialogTitle><DialogDescription>Updates Bench classifications only. Actual transactions stay unchanged. All selected rows are applied together or none are saved.</DialogDescription>{mixed ? <><p className="text-sm">The selection includes charges and credits. Confirm direction-based suggestions, or select one direction to choose another classification.</p><Button disabled={selected.some((row) => !suggestedKind(row))} onClick={() => apply(selected, undefined, revision)}>Confirm suggestions</Button></> : <><Select aria-label="Bulk classification" value={kind} onValueChange={(value) => setKind(value as ActivityClassification["kind"])} options={choices.map((value) => ({ value, label: classificationLabels[value] }))} />{kind === "fee" && <Select aria-label="Bulk fee type" value={feeSubtype} onValueChange={setFeeSubtype} options={Object.entries(feeLabels).map(([value, label]) => ({ value, label }))} />}<Button onClick={() => apply(selected, kind, revision)}>Apply classification</Button></>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</DialogContent></Dialog>
  </>;
}
