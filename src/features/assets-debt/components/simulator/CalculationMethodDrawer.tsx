"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { validateProfile, type CalculationProfile } from "@/lib/financial-models/loan/profile";
import { summarizeProfile, type SimulationState } from "../../lib/simulatorModel";
import {
  ACCRUAL_OPTIONS,
  AMORTIZATION_OPTIONS,
  BALANCE_PRECISION_OPTIONS,
  CAPITALIZATION_OPTIONS,
  CHARGE_FREQUENCY_OPTIONS,
  DAY_COUNT_OPTIONS,
  FINAL_PAYMENT_OPTIONS,
  PROFILE_PRESETS,
  RATE_QUOTE_OPTIONS,
  RECAST_OPTIONS,
  REPAYMENT_DERIVATION_OPTIONS,
  ROUNDING_OPTIONS,
} from "../../lib/vocabulary";
import { DateField, FeatureSwitch, IntegerField, SelectField, TextField } from "../fields";

/**
 * Calculation method (P1.3b T207; FR-221). Every config v1 convention, kept
 * out of the normal path; the collapsed control shows a one-line summary.
 * Presets fill fields and name no lender. Changes apply live and stay unsaved.
 */

type Profile = CalculationProfile;

const TIMING_OPTIONS = [
  { value: "start-of-day", label: "Before the day's interest" },
  { value: "end-of-day", label: "After the day's interest" },
  { value: "custom", label: "Set each group separately" },
];
const PLACEMENT_OPTIONS = [
  { value: "before-accrual", label: "Before the day's interest" },
  { value: "after-accrual", label: "After the day's interest" },
];
const RATE_TIMING_OPTIONS = [
  { value: "on-accrual-effective-date", label: "From the rate's own date" },
  { value: "from-next-charge-period", label: "From the next interest period" },
];
const REPAYMENT_TIMING_OPTIONS = [
  { value: "transaction-date", label: "On the repayment date" },
  { value: "next-calendar-day", label: "From the next day" },
];
const SCALE_OPTIONS = [
  { value: "full", label: "Full precision" },
  { value: "currency", label: "Currency precision" },
  { value: "fixed", label: "A fixed number of places" },
];

export function CalculationMethodSummary({ sim, onOpen }: { sim: SimulationState; onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calculation method</span>
      <span className="text-xs">{summarizeProfile(sim.profile)}</span>
      <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={onOpen}>
        Change calculation method
      </Button>
    </div>
  );
}

export function CalculationMethodDrawer({ open, onClose, sim, change }: { open: boolean; onClose: () => void; sim: SimulationState; change: (next: SimulationState) => void }) {
  const p = sim.profile;
  const set = (patch: Partial<Profile>) => change({ ...sim, profile: { ...p, ...patch, presetId: null } });
  const check = validateProfile(p);
  const timing = "timing" in p.eventOrder ? p.eventOrder.timing : "custom";
  const placements = "timing" in p.eventOrder ? null : p.eventOrder;
  const daily = p.accrual !== "per-period";
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Calculation method</SheetTitle>
          <SheetDescription>{summarizeProfile(p)}. Most loans never need these; change them only to match how your lender calculates.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <SelectField
            label="Start from a preset"
            value={p.presetId ?? ""}
            options={[{ value: "", label: "No preset" }, ...PROFILE_PRESETS.map((x) => ({ value: x.id, label: x.label }))]}
            hint="A preset describes a calculation shape, not any particular lender. Every field stays editable."
            onChange={(id) => {
              const preset = PROFILE_PRESETS.find((x) => x.id === id);
              if (preset) change({ ...sim, profile: { ...p, ...preset.profile, presetId: preset.id } });
            }}
          />
          {!check.ok ? (
            <ul role="alert" className="list-disc rounded border border-destructive/40 py-2 pl-6 pr-2 text-xs text-destructive">
              {check.conflicts.map((c) => (
                <li key={c.message}>{c.message}</li>
              ))}
            </ul>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">Interest</legend>
            <SelectField label="Rate quoted as" value={p.rateQuote} options={RATE_QUOTE_OPTIONS} onChange={(v) => set({ rateQuote: v as Profile["rateQuote"] })} />
            <SelectField label="Interest accrues" value={p.accrual} options={ACCRUAL_OPTIONS} onChange={(v) => set({ accrual: v as Profile["accrual"], capitalization: v === "daily-compounded" ? "daily" : "at-charge" })} />
            {daily ? <SelectField label="Day count" value={p.dayCount} options={DAY_COUNT_OPTIONS} onChange={(v) => set({ dayCount: v as Profile["dayCount"] })} /> : null}
            <SelectField label="Interest is charged" value={p.chargeFrequency} options={CHARGE_FREQUENCY_OPTIONS} onChange={(v) => set({ chargeFrequency: v as Profile["chargeFrequency"], chargeDay: v === "at-repayment" ? null : (p.chargeDay ?? 1) })} />
            {p.chargeFrequency !== "at-repayment" ? (
              <>
                <IntegerField label="Charge day of the month" min={1} value={p.chargeDay} onChange={(d) => set({ chargeDay: d })} />
                <DateField label="First interest charge" hint="Optional." value={sim.firstInterestChargeDate ?? ""} onChange={(d) => change({ ...sim, firstInterestChargeDate: d || null })} />
              </>
            ) : null}
            <SelectField label="Interest capitalizes" value={p.capitalization} options={CAPITALIZATION_OPTIONS} onChange={(v) => set({ capitalization: v as Profile["capitalization"] })} />
            <SelectField label="A new rate applies" value={p.rateEffectiveTiming} options={RATE_TIMING_OPTIONS} onChange={(v) => set({ rateEffectiveTiming: v as Profile["rateEffectiveTiming"] })} />
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">Repayment</legend>
            <SelectField label="Amortization" value={p.amortization} options={AMORTIZATION_OPTIONS.filter((o) => o.value !== "revolving")} onChange={(v) => set({ amortization: v as Profile["amortization"] })} />
            <SelectField label="Repayment amount" value={p.repaymentDerivation} options={REPAYMENT_DERIVATION_OPTIONS} onChange={(v) => set({ repaymentDerivation: v as Profile["repaymentDerivation"] })} />
            <SelectField label="Recalculate the repayment" value={p.recast} options={RECAST_OPTIONS} onChange={(v) => set({ recast: v as Profile["recast"] })} />
            {p.recast === "on-contract-date" ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium">Contract recast dates</span>
                {sim.paymentRecasts.map((r, i) => (
                  <div key={`${r.date}:${i}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <DateField label={`Recast ${i + 1}`} value={r.date} onChange={(d) => change({ ...sim, paymentRecasts: sim.paymentRecasts.map((x, j) => (j === i ? { ...x, date: d } : x)) })} />
                    <TextField label="Note" value={r.note ?? ""} onChange={(t) => change({ ...sim, paymentRecasts: sim.paymentRecasts.map((x, j) => (j === i ? { ...x, note: t || null } : x)) })} />
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove recast ${i + 1}`} onClick={() => change({ ...sim, paymentRecasts: sim.paymentRecasts.filter((_, j) => j !== i) })}>
                      Remove
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => change({ ...sim, paymentRecasts: [...sim.paymentRecasts, { date: sim.startDate, note: null }] })}>
                  Add a recast date
                </Button>
              </div>
            ) : null}
            <SelectField label="A repayment counts" value={p.repaymentEffectiveTiming} options={REPAYMENT_TIMING_OPTIONS} onChange={(v) => set({ repaymentEffectiveTiming: v as Profile["repaymentEffectiveTiming"] })} />
            <p className="text-[11px] text-muted-foreground">Interest-only repayments pay the interest charged since the previous repayment.</p>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">Same-day order</legend>
            <SelectField
              label="Transactions on the same day as interest"
              value={timing}
              options={TIMING_OPTIONS}
              onChange={(v) => set({ eventOrder: v === "custom" ? { scheduledRepayments: "before-accrual", otherPayments: "before-accrual", offsets: "before-accrual" } : { timing: v as "start-of-day" | "end-of-day" } })}
            />
            {placements ? (
              <>
                <SelectField label="Scheduled repayments" value={placements.scheduledRepayments} options={PLACEMENT_OPTIONS} onChange={(v) => set({ eventOrder: { ...placements, scheduledRepayments: v as "before-accrual" | "after-accrual" } })} />
                <SelectField label="Other payments and draws" value={placements.otherPayments} options={PLACEMENT_OPTIONS} onChange={(v) => set({ eventOrder: { ...placements, otherPayments: v as "before-accrual" | "after-accrual" } })} />
                <SelectField label="Offset balance changes" value={placements.offsets} options={PLACEMENT_OPTIONS} onChange={(v) => set({ eventOrder: { ...placements, offsets: v as "before-accrual" | "after-accrual" } })} />
              </>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">Precision and rounding</legend>
            <SelectField label="Repayment rounding" value={p.rounding.paymentRounding} options={ROUNDING_OPTIONS} onChange={(v) => set({ rounding: { ...p.rounding, paymentRounding: v as Profile["rounding"]["paymentRounding"] } })} />
            <SelectField label="Interest rounding" value={p.rounding.interestPostingRounding} options={ROUNDING_OPTIONS} onChange={(v) => set({ rounding: { ...p.rounding, interestPostingRounding: v as Profile["rounding"]["interestPostingRounding"] } })} />
            <SelectField
              label="Working precision"
              value={p.rounding.intermediateScale.mode}
              options={SCALE_OPTIONS}
              onChange={(v) => set({ rounding: { ...p.rounding, intermediateScale: v === "fixed" ? { mode: "fixed", places: 10 } : { mode: v as "full" | "currency" } } })}
            />
            {p.rounding.intermediateScale.mode === "fixed" ? (
              <IntegerField label="Decimal places" value={p.rounding.intermediateScale.places} onChange={(n) => n !== null && n <= 30 && set({ rounding: { ...p.rounding, intermediateScale: { mode: "fixed", places: n } } })} hint="0 to 30." />
            ) : null}
            <SelectField label="Working rounding" value={p.rounding.intermediateRounding} options={ROUNDING_OPTIONS} onChange={(v) => set({ rounding: { ...p.rounding, intermediateRounding: v as Profile["rounding"]["intermediateRounding"] } })} />
            <SelectField label="Balance precision" value={p.rounding.balancePrecision} options={BALANCE_PRECISION_OPTIONS} onChange={(v) => set({ rounding: { ...p.rounding, balancePrecision: v as Profile["rounding"]["balancePrecision"] } })} />
            <IntegerField label="Currency decimal places" min={0} value={sim.minorDigits} onChange={(n) => n !== null && n <= 4 && change({ ...sim, minorDigits: n })} hint={`Set from ${sim.currency}; change only for an unusual currency.`} />
            <p className="text-[11px] text-muted-foreground">Short months: a date past the end of the month moves to its last day.</p>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">End of the loan</legend>
            <SelectField label="Final repayment" value={p.finalPayment} options={FINAL_PAYMENT_OPTIONS} onChange={(v) => set({ finalPayment: v as Profile["finalPayment"] })} />
            <FeatureSwitch label="The contract allows negative amortization" description="Unpaid interest may be added to the loan when a repayment does not cover it." checked={p.negativeAmortizationAllowed} onChange={(on) => set({ negativeAmortizationAllowed: on })} />
          </fieldset>
        </div>
      </SheetContent>
    </Sheet>
  );
}
