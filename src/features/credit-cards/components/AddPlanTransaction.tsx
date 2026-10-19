"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import type { Card, PlanEntryRole, RepaymentPlan, Workspace } from "../lib/models";
import { planForTransaction } from "../lib/derive/indexes";
import { activityKind } from "../lib/derive/types";
import { planEntryFor, roleLabels, suggestPlanLink } from "../lib/plans";
import { creditCardStore } from "../lib/store/store";
import { ROLES } from "./PlanLinkDialog";
import { formatCardDate } from "../lib/displayDates";
import { money } from "./primitives/format";

type Props = {
  budget: string;
  card: Card;
  plan: RepaymentPlan;
  workspace: Workspace;
  snapshot: ActivitySnapshot;
  available: boolean;
  /** Plan-account plans: their transfers belong by account or tag, so only the original purchase is added by hand. */
  onlyOriginal?: boolean;
  onClose: () => void;
};

/**
 * The proposed role: a debit for the plan's original amount (or dated by its start) is the original purchase;
 * then Bench's suggestion; otherwise the sign decides (a purchase is the original, a credit the conversion,
 * any other debit an instalment).
 */
function proposedRole(row: ActivityRow, plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot, hasOriginal: boolean) {
  const original = !hasOriginal && row.amountMinor < 0 && (-row.amountMinor === plan.originalAmountMinor || (plan.startDate !== null && row.date <= plan.startDate));
  if (original) return { role: "original" as PlanEntryRole, number: null };
  const suggestion = suggestPlanLink(row, plan, card, workspace, snapshot);
  if (suggestion && !(hasOriginal && suggestion.role === "original")) return { role: suggestion.role, number: suggestion.instalmentNumber };
  if (row.amountMinor > 0) return { role: "conversion" as PlanEntryRole, number: null };
  return { role: (!hasOriginal && activityKind(row, card, workspace, snapshot) === "purchase" ? "original" : "instalment") as PlanEntryRole, number: null };
}

/**
 * Add transaction (plan view): find one of the card's transactions, confirm the proposed role and link
 * it. Transactions already in a plan are left out; a plan has one original purchase. Actual is never changed.
 */
export function AddPlanTransaction({ budget, card, plan, workspace, snapshot, available, onlyOriginal = false, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<ActivityRow | null>(null);
  const [role, setRole] = useState<PlanEntryRole>("original");
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const needle = search.trim().toLowerCase();
  const hasOriginal = workspace.planEntries.some((entry) => entry.planId === plan.id && entry.role === "original");
  const roles = ROLES.filter((value) => !hasOriginal || value !== "original");
  const rows = snapshot.rows
    .filter((row) => row.accountId === card.accountId && !planForTransaction(workspace, row.id) && (!onlyOriginal || (row.amountMinor < 0 && !row.transferId)))
    .filter((row) => !needle || [row.label, row.notes ?? "", formatCardDate(row.date), money(row.amountMinor)].join(" ").toLowerCase().includes(needle))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, 50);

  function pick(row: ActivityRow) {
    const proposal = onlyOriginal ? { role: "original" as PlanEntryRole, number: null } : proposedRole(row, plan, card, workspace, snapshot, hasOriginal);
    setPicked(row);
    setRole(proposal.role);
    setNumber(proposal.number === null ? "" : String(proposal.number));
  }

  async function link() {
    try {
      if (!available) throw new Error("Refresh Actual before linking");
      if (!picked) throw new Error("Choose a transaction");
      const entries = workspace.planEntries.filter((entry) => entry.planId === plan.id);
      const instalment = role === "instalment" && number.trim() ? Number(number) : null;
      await creditCardStore.getState().savePlan(budget, plan.revision, snapshot, plan, [...entries, planEntryFor(plan.id, picked, role, instalment)]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't link the transaction");
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[80dvh] flex-col gap-3 sm:max-w-2xl">
      <div>
        <DialogTitle>{onlyOriginal ? `Add the original purchase to ${plan.name}` : `Add a transaction to ${plan.name}`}</DialogTitle>
        <DialogDescription>{onlyOriginal
          ? "Find the purchase the plan was made from, then Link. Its transfers already belong to the plan; Actual stays unchanged."
          : "Find the card transaction, check its role, then Link. Actual stays unchanged."}</DialogDescription>
      </div>
      <SearchInput size="sm" aria-label="Find a card transaction" placeholder="Payee, notes, date or amount" value={search} onValueChange={setSearch} autoFocus />
      <ul aria-label="Card transactions" className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
        {rows.length ? rows.map((row) => <li key={row.id}>
          <button type="button" aria-pressed={picked?.id === row.id} onClick={() => pick(row)}
            className={cn("grid w-full grid-cols-[84px_1fr_auto] items-baseline gap-3 px-3 py-1.5 text-left text-xs hover:bg-muted",
              picked?.id === row.id && "bg-blue-50 dark:bg-blue-950/40")}>
            <span>{formatCardDate(row.date)}</span>
            <span className="truncate">{row.label}{row.notes ? <span className="text-muted-foreground"> · {row.notes}</span> : null}</span>
            <span className="tabular-nums">{money(row.amountMinor)}</span>
          </button>
        </li>) : <li className="px-3 py-4 text-xs text-muted-foreground">No card transactions match.</li>}
      </ul>
      {picked && !onlyOriginal && <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">Role
          <Select size="sm" className="mt-1 w-48" aria-label="Role" value={role} onValueChange={(value) => setRole(value as PlanEntryRole)}
            options={roles.map((value) => ({ value, label: roleLabels[value] }))} />
        </label>
        {role === "instalment" && <label className="text-xs text-muted-foreground">Instalment number (optional)
          <Input size="sm" inputMode="numeric" className="mt-1 w-28" value={number} onChange={(event) => setNumber(event.target.value)} />
        </label>}
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!available || !picked} onClick={link}>Link</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
