"use client";

import { Input } from "@/components/ui/input";
import { fractionToPercent, percentToFraction } from "../../lib/money";
import { REPAYMENT_FREQUENCY_OPTIONS } from "../../lib/vocabulary";
import type { SimulationState } from "../../lib/simulatorModel";
import { DateField, IntegerField, MoneyField, PercentField, SelectField } from "../fields";

/**
 * The five primary inputs (P1.3b T205; FR-216): loan amount, term, start date,
 * interest rate (typed, or with the slider) and repayment frequency. Nothing else is needed to see a
 * complete simulation; nothing here is Actual-specific.
 */
export function PrimaryInputs({ sim, change, onRateChanges }: { sim: SimulationState; change: (next: SimulationState) => void; onRateChanges: () => void }) {
  const years = sim.termMonths === null ? null : Math.floor(sim.termMonths / 12);
  const months = sim.termMonths === null ? null : sim.termMonths % 12;
  const setTerm = (y: number | null, m: number | null) => {
    const total = (y ?? 0) * 12 + (m ?? 0);
    change({ ...sim, termMonths: y === null && m === null ? null : total > 0 ? total : null });
  };
  const laterRates = sim.rates.length - 1;
  const setRate = (v: string | null) => change({ ...sim, rates: sim.rates.map((r, i) => (i === 0 ? { ...r, annualRateDecimal: v } : r)) });
  return (
    <div className="flex flex-col gap-3">
      <MoneyField label={sim.shape === "revolving-credit" ? "Amount drawn" : "Loan amount"} valueMinor={sim.principalMinor} minorDigits={sim.minorDigits} suffix={sim.currency} onChange={(v) => change({ ...sim, principalMinor: v })} />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Term</legend>
        <div className="grid grid-cols-2 gap-2">
          <IntegerField label="Years" value={years} onChange={(y) => setTerm(y, months)} />
          <IntegerField label="Months" value={months} onChange={(m) => setTerm(years, m)} />
        </div>
      </fieldset>
      <DateField label="Start date" value={sim.startDate} onChange={(d) => change({ ...sim, startDate: d, rates: sim.rates.map((r, i) => (i === 0 ? { ...r, accrualEffectiveFrom: d } : r)) })} />
      <div className="flex flex-col gap-1">
        <PercentField label="Interest rate (per year)" valueFraction={sim.rates[0]?.annualRateDecimal ?? null} onChange={setRate} />
        <Input
          type="range"
          aria-label="Interest rate slider"
          min={0}
          max={15}
          step={0.05}
          value={Number(fractionToPercent(sim.rates[0]?.annualRateDecimal ?? null) || 0)}
          onChange={(e) => {
            const r = percentToFraction(e.target.value);
            if (r.ok) setRate(r.value);
          }}
          className="h-4 border-0 bg-transparent px-0 accent-primary"
        />
        <button type="button" className="self-start text-[11px] text-primary underline-offset-2 hover:underline" onClick={onRateChanges}>
          {laterRates > 0 ? `Rate changes (${laterRates})` : "Add rate changes"}
        </button>
      </div>
      <SelectField label="Repayment frequency" value={sim.profile.repaymentFrequency} options={REPAYMENT_FREQUENCY_OPTIONS} onChange={(v) => change({ ...sim, profile: { ...sim.profile, repaymentFrequency: v as SimulationState["profile"]["repaymentFrequency"] } })} />
    </div>
  );
}
