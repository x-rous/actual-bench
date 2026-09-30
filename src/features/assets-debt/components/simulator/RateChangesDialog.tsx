"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { fractionToPercent, parseFactor } from "../../lib/money";
import { openingRate, type SimRate, type SimulationState } from "../../lib/simulatorModel";
import { PER_RATE_RECAST_OPTIONS } from "../../lib/vocabulary";
import { DateField, FeatureSwitch, MoneyField, PercentField, SelectField, TextField } from "../fields";

/**
 * Rate changes (P1.3b T208; FR-043, FR-044, FR-222). A compact timeline and a
 * row editor; only the per-rate recast choices that make sense for a single
 * change are offered. Saving a row goes through `propose`, so a change inside
 * a payment period asks before switching to day-by-day (O1).
 */
export function RateChangesDialog({ open, onClose, sim, propose }: { open: boolean; onClose: () => void; sim: SimulationState; propose: (next: SimulationState) => void }) {
  const [editing, setEditing] = useState<SimRate | null>(null);
  const later = sim.rates.slice(1).sort((a, b) => a.accrualEffectiveFrom.localeCompare(b.accrualEffectiveFrom));
  const save = (row: SimRate) => {
    const exists = sim.rates.some((r) => r.key === row.key);
    propose({ ...sim, rates: exists ? sim.rates.map((r) => (r.key === row.key ? row : r)) : [...sim.rates, row] });
    setEditing(null);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (setEditing(null), onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Rate change" : "Rate changes"}</DialogTitle>
          <DialogDescription>{editing ? "The date the new rate starts accruing, and what happens to the repayment." : `The loan starts at ${fractionToPercent(sim.rates[0]?.annualRateDecimal ?? null) || "?"}%. Later rates start on their own dates.`}</DialogDescription>
        </DialogHeader>
        {editing ? (
          <RateEditor row={editing} sim={sim} onCancel={() => setEditing(null)} onSave={save} />
        ) : (
          <>
            {later.length === 0 ? <p className="text-sm text-muted-foreground">No rate changes yet.</p> : null}
            <ul className="flex flex-col divide-y divide-border rounded border border-border">
              {later.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    From {r.accrualEffectiveFrom}: {fractionToPercent(r.annualRateDecimal)}%
                    {r.paymentEffectiveFrom ? ` · payment changes ${r.paymentEffectiveFrom}` : ""}
                    {r.paymentCap ? " · payment capped" : ""}
                    {r.rateCapDecimal || r.rateFloorDecimal ? " · rate limits" : ""}
                  </span>
                  <span className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit the rate from ${r.accrualEffectiveFrom}`}>
                      Edit
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => propose({ ...sim, rates: sim.rates.filter((x) => x.key !== r.key) })} aria-label={`Remove the rate from ${r.accrualEffectiveFrom}`}>
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing({ ...openingRate(addMonths(sim.startDate, 12)), annualRateDecimal: sim.rates[0]?.annualRateDecimal ?? null })}>
                Add a rate change
              </Button>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RateEditor({ row, sim, onCancel, onSave }: { row: SimRate; sim: SimulationState; onCancel: () => void; onSave: (row: SimRate) => void }) {
  const [draft, setDraft] = useState(row);
  const [factorText, setFactorText] = useState(row.paymentCap?.kind === "previous-payment-factor" ? row.paymentCap.factor : "");
  const [limits, setLimits] = useState(!!(row.rateCapDecimal || row.rateFloorDecimal));
  const set = (patch: Partial<SimRate>) => setDraft((d) => ({ ...d, ...patch }));
  const recalculates = (draft.paymentRecalcPolicy ?? sim.profile.recast) === "on-rate-change";
  const collision = sim.rates.some((r) => r.key !== draft.key && r.accrualEffectiveFrom === draft.accrualEffectiveFrom);
  const factor = parseFactor(factorText);
  const problems = [
    collision ? "Another rate already starts on this date." : null,
    draft.annualRateDecimal === null ? "Enter the rate." : null,
    draft.accrualEffectiveFrom <= sim.startDate ? "A rate change starts after the loan's start date." : null,
    draft.paymentCap?.kind === "previous-payment-factor" && !factor.ok ? factor.message : null,
  ].filter((p): p is string => !!p);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length) return;
        onSave({ ...draft, paymentCap: recalculates ? draft.paymentCap : null, paymentEffectiveFrom: recalculates ? draft.paymentEffectiveFrom : null });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <DateField label="Starts accruing" value={draft.accrualEffectiveFrom} onChange={(d) => set({ accrualEffectiveFrom: d })} issue={collision ? "Another rate already starts on this date." : undefined} />
        <PercentField label="New rate (per year)" valueFraction={draft.annualRateDecimal} onChange={(v) => set({ annualRateDecimal: v })} />
      </div>
      <SelectField label="Repayment on this change" value={draft.paymentRecalcPolicy ?? ""} options={PER_RATE_RECAST_OPTIONS} onChange={(v) => set({ paymentRecalcPolicy: (v || null) as SimRate["paymentRecalcPolicy"] })} />
      {recalculates ? (
        <>
          <FeatureSwitch label="The repayment changes on a different date" checked={draft.paymentEffectiveFrom !== null} onChange={(on) => set({ paymentEffectiveFrom: on ? draft.accrualEffectiveFrom : null })} />
          {draft.paymentEffectiveFrom !== null ? <DateField label="Repayment changes from" value={draft.paymentEffectiveFrom} onChange={(d) => set({ paymentEffectiveFrom: d })} /> : null}
          <SelectField
            label="Limit the new repayment"
            value={draft.paymentCap?.kind ?? ""}
            options={[
              { value: "", label: "No limit" },
              { value: "absolute", label: "At most an amount" },
              { value: "previous-payment-factor", label: "At most the previous repayment × a factor" },
            ]}
            onChange={(v) => set({ paymentCap: v === "absolute" ? { kind: "absolute", amountMinor: 0 } : v === "previous-payment-factor" ? { kind: "previous-payment-factor", factor: factor.ok && factor.value ? factor.value : "1" } : null })}
          />
          {draft.paymentCap?.kind === "absolute" ? <MoneyField label="Most the repayment can be" valueMinor={draft.paymentCap.amountMinor || null} minorDigits={sim.minorDigits} onChange={(v) => set({ paymentCap: { kind: "absolute", amountMinor: v ?? 0 } })} /> : null}
          {draft.paymentCap?.kind === "previous-payment-factor" ? (
            <TextField label="Factor" hint="For example 1.075 for at most a 7.5% increase." value={factorText} inputMode="decimal" onChange={(t) => { setFactorText(t); const f = parseFactor(t); if (f.ok && f.value) set({ paymentCap: { kind: "previous-payment-factor", factor: f.value } }); }} issue={factor.ok ? undefined : factor.message} />
          ) : null}
        </>
      ) : null}
      <button type="button" aria-expanded={limits} onClick={() => setLimits((l) => !l)} className="self-start text-xs font-medium text-primary">
        Rate limits
      </button>
      {limits ? (
        <div className="grid grid-cols-2 gap-2">
          <PercentField label="Rate cap" valueFraction={draft.rateCapDecimal} onChange={(v) => set({ rateCapDecimal: v })} />
          <PercentField label="Rate floor" valueFraction={draft.rateFloorDecimal} onChange={(v) => set({ rateFloorDecimal: v })} />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <DateField label="Announced on" value={draft.announcedAt ?? ""} onChange={(d) => set({ announcedAt: d || null })} />
        <TextField label="Source" value={draft.source ?? ""} onChange={(t) => set({ source: t || null })} hint="For example: rate-change letter." />
      </div>
      <TextField label="Note" value={draft.note ?? ""} onChange={(t) => set({ note: t || null })} />
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
          Save rate change
        </Button>
      </DialogFooter>
    </form>
  );
}
