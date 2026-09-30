"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMinor } from "../../lib/money";
import { simKey, type SimAssumption, type SimAssumptionKind, type SimulationState } from "../../lib/simulatorModel";
import { DateField, FeatureSwitch, MoneyField, SelectField, TextField } from "../fields";

/**
 * Extra transactions (P1.3b T209; FR-110, FR-222). Only kinds the model
 * supports; recurrence only where its meaning is valid (extra repayments,
 * draws and fees). An offset balance change is a dated absolute balance:
 * "offset balance 40,000 from 1 Jun 2027", never a deposit or withdrawal.
 */

const KIND_LABEL: Record<SimAssumptionKind, string> = {
  "extra-repayment": "Extra repayment",
  draw: "Redraw",
  fee: "Fee",
  "payment-change": "Repayment change",
  "offset-balance": "Offset balance change",
};
const REPEATS: SimAssumptionKind[] = ["extra-repayment", "draw", "fee"];
const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

export function describeAssumption(a: SimAssumption, currency: string, digits: number): string {
  const amount = formatMinor(a.amountMinor, digits, currency);
  switch (a.kind) {
    case "offset-balance":
      return `${a.effectiveFrom} → offset balance ${amount}`;
    case "payment-change":
      return `${a.effectiveFrom} → repayment ${amount}`;
    default:
      return `${KIND_LABEL[a.kind]} ${amount} on ${a.effectiveFrom}${a.recurrence ? `, then ${a.recurrence.frequency} until ${a.recurrence.until}` : ""}${a.kind === "fee" ? ` (${a.feeTreatment === "capitalized" ? "added to the loan" : "paid in cash"})` : ""}`;
  }
}

export function ExtraTransactionsDialog({ open, onClose, sim, propose }: { open: boolean; onClose: () => void; sim: SimulationState; propose: (next: SimulationState) => void }) {
  const [editing, setEditing] = useState<SimAssumption | null>(null);
  const offset = sim.offsets[0] ?? null;
  // The opening offset balance is edited with the offset itself, not here.
  const listed = sim.assumptions
    .filter((a) => !(a.kind === "offset-balance" && offset && a.offsetAccountId === offset.placeholderAccountId && a.effectiveFrom <= offset.effectiveFrom))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const kinds: SimAssumptionKind[] = ["extra-repayment", "draw", "fee", "payment-change", ...(offset ? (["offset-balance"] as const) : [])];
  const start = (kind: SimAssumptionKind) =>
    setEditing({ key: simKey("extra"), kind, effectiveFrom: sim.startDate, recurrence: null, amountMinor: 0, feeTreatment: kind === "fee" ? "cash-paid" : null, offsetAccountId: kind === "offset-balance" ? offset!.placeholderAccountId : null, note: null });
  const save = (a: SimAssumption) => {
    const exists = sim.assumptions.some((x) => x.key === a.key);
    propose({ ...sim, assumptions: exists ? sim.assumptions.map((x) => (x.key === a.key ? a : x)) : [...sim.assumptions, a] });
    setEditing(null);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (setEditing(null), onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? KIND_LABEL[editing.kind] : "Extra transactions"}</DialogTitle>
          <DialogDescription>{editing ? "Only what you enter here changes the simulation; nothing is saved until you save the loan." : "Extra repayments, redraws, fees, repayment changes and offset balance changes, by date."}</DialogDescription>
        </DialogHeader>
        {editing ? (
          <AssumptionEditor item={editing} sim={sim} onCancel={() => setEditing(null)} onSave={save} />
        ) : (
          <>
            {listed.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
            <ul className="flex flex-col divide-y divide-border rounded border border-border">
              {listed.map((a) => (
                <li key={a.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>{describeAssumption(a, sim.currency, sim.minorDigits)}</span>
                  <span className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label={`Edit: ${describeAssumption(a, sim.currency, sim.minorDigits)}`}>
                      Edit
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => propose({ ...sim, assumptions: sim.assumptions.filter((x) => x.key !== a.key) })} aria-label={`Remove: ${describeAssumption(a, sim.currency, sim.minorDigits)}`}>
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter className="flex-wrap">
              {kinds.map((k) => (
                <Button key={k} type="button" variant="outline" size="sm" onClick={() => start(k)}>
                  Add {KIND_LABEL[k].toLowerCase()}
                </Button>
              ))}
              <Button type="button" size="sm" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssumptionEditor({ item, sim, onCancel, onSave }: { item: SimAssumption; sim: SimulationState; onCancel: () => void; onSave: (a: SimAssumption) => void }) {
  const [draft, setDraft] = useState(item);
  const set = (patch: Partial<SimAssumption>) => setDraft((d) => ({ ...d, ...patch }));
  const canRepeat = REPEATS.includes(draft.kind);
  const positive = draft.kind === "extra-repayment" || draft.kind === "draw" || draft.kind === "fee";
  const problems = [
    positive && draft.amountMinor <= 0 ? "Enter an amount above zero." : null,
    draft.recurrence && draft.recurrence.until < draft.effectiveFrom ? "The end date must be on or after the first date." : null,
  ].filter((p): p is string => !!p);
  const amountLabel = draft.kind === "offset-balance" ? "Offset balance from this date" : draft.kind === "payment-change" ? "New repayment" : "Amount";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problems.length) onSave(draft);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <MoneyField label={amountLabel} valueMinor={draft.amountMinor || null} minorDigits={sim.minorDigits} suffix={sim.currency} onChange={(v) => set({ amountMinor: v ?? 0 })} />
        <DateField label={draft.recurrence ? "First date" : "Date"} value={draft.effectiveFrom} onChange={(d) => set({ effectiveFrom: d })} />
      </div>
      {draft.kind === "fee" ? (
        <SelectField
          label="How it is paid"
          value={draft.feeTreatment ?? "cash-paid"}
          options={[
            { value: "cash-paid", label: "Paid in cash" },
            { value: "capitalized", label: "Added to the loan" },
          ]}
          onChange={(v) => set({ feeTreatment: v as SimAssumption["feeTreatment"] })}
        />
      ) : null}
      {canRepeat ? (
        <>
          <FeatureSwitch label="Repeats" checked={draft.recurrence !== null} onChange={(on) => set({ recurrence: on ? { frequency: "monthly", until: draft.effectiveFrom } : null })} />
          {draft.recurrence ? (
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="Every" value={draft.recurrence.frequency} options={FREQUENCIES} onChange={(v) => set({ recurrence: { ...draft.recurrence!, frequency: v as NonNullable<SimAssumption["recurrence"]>["frequency"] } })} />
              <DateField label="Until" value={draft.recurrence.until} onChange={(d) => set({ recurrence: { ...draft.recurrence!, until: d } })} />
            </div>
          ) : null}
        </>
      ) : null}
      <TextField label="Description" value={draft.note ?? ""} onChange={(t) => set({ note: t || null })} />
      {problems.length ? (
        <ul role="alert" className="list-disc pl-5 text-xs text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" disabled={problems.length > 0}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
