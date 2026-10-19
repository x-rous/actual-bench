"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import type { Card, PlanEntryRole, Workspace } from "../lib/models";
import { planForTransaction } from "../lib/derive/indexes";
import { planEntryFor, roleLabels, suggestPlanLink } from "../lib/plans";
import { creditCardStore } from "../lib/store/store";
import { money, plural } from "./primitives/format";

type Props = {
  budget: string;
  card: Card;
  rows: ActivityRow[];
  workspace: Workspace;
  snapshot: ActivitySnapshot;
  available: boolean;
  onClose: () => void;
};

export const ROLES: PlanEntryRole[] = ["original", "instalment", "conversion", "settlement", "cost", "refund", "adjustment"];

/**
 * Link card transactions to a plan, with their role (§9.10). Plan transactions are reviewed in
 * Activity filtered to the plan, so this replaces the plan editor's transaction table.
 */
export function PlanLinkDialog({ budget, card, rows, workspace, snapshot, available, onClose }: Props) {
  const linked = rows.length === 1 ? planForTransaction(workspace, rows[0].id) : undefined;
  const plans = workspace.plans.filter((plan) => plan.cardId === card.id && (plan.status === "active" || plan.id === linked?.id));
  const firstSuggestion = rows.length === 1
    ? plans.map((plan) => ({ plan, suggestion: suggestPlanLink(rows[0], plan, card, workspace, snapshot) })).find((entry) => entry.suggestion)
    : undefined;
  const [planId, setPlanId] = useState(linked?.id ?? firstSuggestion?.plan.id ?? plans[0]?.id ?? "");
  const current = linked && workspace.planEntries.find((entry) => entry.planId === linked.id && entry.transactionId === rows[0].id);
  const [role, setRole] = useState<PlanEntryRole>(current?.role ?? firstSuggestion?.suggestion?.role ?? (rows[0]?.amountMinor > 0 ? "refund" : "instalment"));
  const [number, setNumber] = useState(String(current?.instalmentNumber ?? firstSuggestion?.suggestion?.instalmentNumber ?? ""));
  const [error, setError] = useState("");
  const plan = plans.find((entry) => entry.id === planId);

  async function save(unlink = false) {
    try {
      if (!available) throw new Error("Refresh Actual before linking");
      if (!plan) throw new Error("Choose a plan");
      const ids = new Set(rows.map((row) => row.id));
      const kept = workspace.planEntries.filter((entry) => entry.planId === plan.id && !ids.has(entry.transactionId));
      const instalment = role === "instalment" && number.trim() ? Number(number) : null;
      const next = unlink ? kept : [...kept, ...rows.map((row) => planEntryFor(plan.id, row, role, instalment))];
      await creditCardStore.getState().savePlan(budget, plan.revision, snapshot, plan, next);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't link to the plan");
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogTitle>{linked ? `Plan ${linked.name}` : "Link to plan"}</DialogTitle>
      <DialogDescription>
        {rows.length === 1 ? `${rows[0].label} · ${money(rows[0].amountMinor)}` : plural(rows.length, "transaction")}.
        {firstSuggestion?.suggestion && ` Suggested: ${firstSuggestion.suggestion.reason}.`} The statement and Actual stay unchanged.
      </DialogDescription>
      {plans.length ? <div className="grid gap-3">
        <Select aria-label="Plan" value={planId} onValueChange={setPlanId} options={plans.map((entry) => ({ value: entry.id, label: entry.name }))} />
        <Select aria-label="Role" value={role} onValueChange={(value) => setRole(value as PlanEntryRole)}
          options={ROLES.map((value) => ({ value, label: roleLabels[value] }))} />
        {role === "instalment" && <label className="text-xs text-muted-foreground">Instalment number (optional)
          <Input size="sm" inputMode="numeric" className="mt-1 w-28" value={number} onChange={(event) => setNumber(event.target.value)} />
        </label>}
      </div> : <p className="text-sm text-muted-foreground">This card has no plans yet. Make one from a purchase or in the Plans tab.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {linked && <Button variant="outline" className="mr-auto" disabled={!available} onClick={() => save(true)}>Unlink</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!available || !plan} onClick={() => save()}>{linked ? "Save link" : "Link"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
