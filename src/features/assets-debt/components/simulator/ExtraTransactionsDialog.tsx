"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAmount } from "../../lib/money";
import { extraTransactions, simKey, type SimAssumption, type SimAssumptionKind, type SimulationState } from "../../lib/simulatorModel";
import { DateField, FeatureSwitch, MoneyField, SelectField, TextField } from "../fields";

export const KIND_LABEL: Record<SimAssumptionKind, string> = {
  "extra-repayment": "Extra payment",
  draw: "Redraw / withdrawal",
  fee: "Fee",
  "payment-change": "Repayment change",
  "offset-balance": "Set absolute offset balance",
  "offset-deposit": "Offset deposit",
  "offset-withdrawal": "Offset withdrawal",
};

const REPEATS: SimAssumptionKind[] = ["extra-repayment", "draw", "fee", "offset-deposit", "offset-withdrawal"];
const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

export function listedExtraTransactions(sim: SimulationState): SimAssumption[] {
  return extraTransactions(sim).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export function describeAssumption(assumption: SimAssumption, digits: number): string {
  const amount = formatAmount(assumption.amountMinor, digits);
  if (assumption.kind === "offset-balance") return `${assumption.effectiveFrom} → offset balance ${amount}`;
  if (assumption.kind === "payment-change") return `${assumption.effectiveFrom} → repayment ${amount}`;
  return `${KIND_LABEL[assumption.kind]} ${amount} on ${assumption.effectiveFrom}${assumption.recurrence ? `, then ${assumption.recurrence.frequency} until ${assumption.recurrence.until}` : ""}${assumption.kind === "fee" ? ` (${assumption.feeTreatment === "capitalized" ? "added to the loan" : "paid in cash"})` : ""}`;
}

export function assumptionDetails(assumption: SimAssumption): string {
  const details = [
    assumption.kind === "offset-balance" ? "Replaces the offset balance from this date" : null,
    assumption.kind === "offset-deposit" ? "Deposited into the offset account" : null,
    assumption.kind === "offset-withdrawal" ? "Withdrawn from the offset account" : null,
    assumption.recurrence ? `Repeats ${assumption.recurrence.frequency} until ${assumption.recurrence.until}` : "One-off",
    assumption.kind === "fee" ? (assumption.feeTreatment === "capitalized" ? "Added to the loan" : "Paid in cash") : null,
    assumption.note,
  ];
  return details.filter(Boolean).join(" · ");
}

export type ExtraEditor = SimAssumptionKind | SimAssumption;

export function ExtraTransactionsDialog({ open, onClose, sim, propose, editor }: { open: boolean; onClose: () => void; sim: SimulationState; propose: (next: SimulationState) => void; editor: ExtraEditor | null }) {
  const offset = sim.offsets[0] ?? null;
  const draft = useMemo(() => {
    if (!open || !editor) return null;
    if (typeof editor !== "string") return editor;
    return { key: simKey("extra"), kind: editor, effectiveFrom: sim.startDate, recurrence: null, amountMinor: 0, feeTreatment: editor === "fee" ? "cash-paid" as const : null, offsetAccountId: editor === "offset-balance" ? offset?.placeholderAccountId ?? null : null, note: null } satisfies SimAssumption;
  }, [open, editor, offset?.placeholderAccountId, sim.startDate]);

  const save = (assumption: SimAssumption) => {
    const exists = sim.assumptions.some((candidate) => candidate.key === assumption.key);
    propose({ ...sim, assumptions: exists ? sim.assumptions.map((candidate) => (candidate.key === assumption.key ? assumption : candidate)) : [...sim.assumptions, assumption] });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{draft ? KIND_LABEL[draft.kind] : "Event"}</DialogTitle>
          <DialogDescription>{draft?.kind === "offset-balance" ? "Replace the absolute offset account balance from this date. This is not a deposit or withdrawal." : draft && (draft.kind === "extra-repayment" || draft.kind === "offset-deposit" || draft.kind === "draw" || draft.kind === "offset-withdrawal") ? "Choose whether this event applies to the loan or an active offset account." : "This event affects only this simulation until the loan is saved."}</DialogDescription>
        </DialogHeader>
        {draft ? <AssumptionEditor key={draft.key} item={draft} sim={sim} onCancel={onClose} onSave={save} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AssumptionEditor({ item, sim, onCancel, onSave }: { item: SimAssumption; sim: SimulationState; onCancel: () => void; onSave: (assumption: SimAssumption) => void }) {
  const [draft, setDraft] = useState(item);
  const set = (patch: Partial<SimAssumption>) => setDraft((current) => ({ ...current, ...patch }));
  const canRepeat = REPEATS.includes(draft.kind);
  const paymentAction = draft.kind === "extra-repayment" || draft.kind === "offset-deposit";
  const withdrawalAction = draft.kind === "draw" || draft.kind === "offset-withdrawal";
  const offsetKind = draft.kind === "offset-balance" || draft.kind === "offset-deposit" || draft.kind === "offset-withdrawal";
  const positive = paymentAction || withdrawalAction || draft.kind === "fee";
  const problems = [
    positive && draft.amountMinor <= 0 ? "Enter an amount above zero." : null,
    offsetKind && !draft.offsetAccountId ? "Enable and select an offset account for this event." : null,
    draft.recurrence && draft.recurrence.until < draft.effectiveFrom ? "The end date must be on or after the first date." : null,
  ].filter((problem): problem is string => !!problem);
  const amountLabel = draft.kind === "offset-balance" ? "Offset balance from this date" : draft.kind === "payment-change" ? "New repayment" : draft.kind === "offset-deposit" ? "Deposit amount" : draft.kind === "offset-withdrawal" ? "Withdrawal amount" : "Amount";
  const destination = draft.kind === "offset-deposit" ? "offset" : "loan";
  const source = draft.kind === "offset-withdrawal" ? "offset" : "loan";
  const offsetOptions = sim.offsets.map((offset, index) => ({ value: offset.placeholderAccountId, label: `Offset account ${index + 1}` }));

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (!problems.length) onSave(draft); }}>
      {paymentAction && sim.offsets.length ? (
        <SelectField
          label="Destination"
          value={destination}
          options={[{ value: "loan", label: "Loan" }, { value: "offset", label: "Offset account" }]}
          onChange={(value) => set({ kind: value === "offset" ? "offset-deposit" : "extra-repayment", offsetAccountId: value === "offset" ? (draft.offsetAccountId ?? sim.offsets[0].placeholderAccountId) : null })}
        />
      ) : null}
      {withdrawalAction && sim.offsets.length ? (
        <SelectField
          label="Source"
          value={source}
          options={[{ value: "loan", label: "Loan" }, { value: "offset", label: "Offset account" }]}
          onChange={(value) => set({ kind: value === "offset" ? "offset-withdrawal" : "draw", offsetAccountId: value === "offset" ? (draft.offsetAccountId ?? sim.offsets[0].placeholderAccountId) : null })}
        />
      ) : null}
      {offsetKind && sim.offsets.length > 1 ? (
        <SelectField label="Offset account" value={draft.offsetAccountId ?? ""} options={offsetOptions} onChange={(offsetAccountId) => set({ offsetAccountId })} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField label={amountLabel} valueMinor={draft.amountMinor || null} minorDigits={sim.minorDigits} onChange={(amountMinor) => set({ amountMinor: amountMinor ?? 0 })} />
        <DateField label={draft.recurrence ? "First date" : "Date"} value={draft.effectiveFrom} onChange={(effectiveFrom) => set({ effectiveFrom })} />
      </div>
      {draft.kind === "fee" ? (
        <SelectField label="How it is paid" value={draft.feeTreatment ?? "cash-paid"} options={[{ value: "cash-paid", label: "Paid in cash" }, { value: "capitalized", label: "Added to the loan" }]} onChange={(feeTreatment) => set({ feeTreatment: feeTreatment as SimAssumption["feeTreatment"] })} />
      ) : null}
      {canRepeat ? (
        <div className="rounded-md border border-border p-3">
          <FeatureSwitch label="Repeat this event" checked={draft.recurrence !== null} onChange={(on) => set({ recurrence: on ? { frequency: "monthly", until: draft.effectiveFrom } : null })} />
          {draft.recurrence ? (
            <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <SelectField label="Every" value={draft.recurrence.frequency} options={FREQUENCIES} onChange={(frequency) => set({ recurrence: { ...draft.recurrence!, frequency: frequency as NonNullable<SimAssumption["recurrence"]>["frequency"] } })} />
              <DateField label="Until" value={draft.recurrence.until} onChange={(until) => set({ recurrence: { ...draft.recurrence!, until } })} />
            </div>
          ) : null}
        </div>
      ) : null}
      <TextField label="Details" value={draft.note ?? ""} onChange={(note) => set({ note: note || null })} />
      {problems.length ? <ul role="alert" className="list-disc pl-5 text-xs text-destructive">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={problems.length > 0}>Save event</Button>
      </DialogFooter>
    </form>
  );
}
