"use client";

import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils";
import type { SimulationState } from "../../lib/simulatorModel";
import { DateField, IntegerField, MoneyField, PercentField, SelectField } from "../fields";
import { CalculationMethodSummary } from "./CalculationMethodDrawer";
import { InterestOnlyControl } from "./InterestOnlyControl";

type Props = {
  sim: SimulationState;
  change: (next: SimulationState) => void;
  propose: (next: SimulationState) => void;
  onRateChanges: () => void;
};

export function ConfigurationSection({ title, help, children, className }: { title: string; help: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <fieldset aria-label={title} className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4", className)}>
      <legend className="px-1 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5">
          {title}
          <InfoHint label={`${title} fields`}>{help}</InfoHint>
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

/** The ordinary modelling path, grouped by contract concept instead of one long field list. */
export function PrimaryInputs({ sim, change, propose, onRateChanges }: Props) {
  const years = sim.termMonths === null ? null : Math.floor(sim.termMonths / 12);
  const months = sim.termMonths === null ? null : sim.termMonths % 12;
  const setTerm = (y: number | null, m: number | null) => {
    const total = (y ?? 0) * 12 + (m ?? 0);
    change({ ...sim, termMonths: y === null && m === null ? null : total > 0 ? total : null });
  };
  const laterRates = sim.rates.length - 1;
  const setRate = (annualRateDecimal: string | null) => change({ ...sim, rates: sim.rates.map((rate, index) => (index === 0 ? { ...rate, annualRateDecimal } : rate)) });

  return (
    <>
      <ConfigurationSection
        title="1. Loan"
        help="Loan type selects a fixed-term loan or line of credit. Loan amount is the opening principal or amount drawn; Years and Months define the term, and Start date is when the loan and its first rate begin."
      >
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Loan type"
            value={sim.shape}
            onChange={(shape) => change({ ...sim, shape: shape as SimulationState["shape"] })}
            options={[
              { value: "term-loan", label: "Term loan" },
              { value: "revolving-credit", label: "Line of credit" },
            ]}
          />
          <MoneyField label={sim.shape === "revolving-credit" ? "Amount drawn" : "Loan amount"} valueMinor={sim.principalMinor} minorDigits={sim.minorDigits} onChange={(principalMinor) => change({ ...sim, principalMinor })} />
          <IntegerField label="Years" value={years} onChange={(value) => setTerm(value, months)} />
          <IntegerField label="Months" value={months} onChange={(value) => setTerm(years, value)} />
          <DateField className="col-span-2" label="Start date" value={sim.startDate} onChange={(startDate) => change({ ...sim, startDate, rates: sim.rates.map((rate, index) => (index === 0 ? { ...rate, accrualEffectiveFrom: startDate } : rate)) })} />
        </div>
      </ConfigurationSection>

      <ConfigurationSection
        title="2. Interest"
        help="Interest rate is the opening annual rate. Rate changes schedule later rates, Calculation method summarizes the accrual and posting conventions, and Interest-only period defines any phase where scheduled payments cover interest without amortizing principal."
      >
        <PercentField label="Interest rate" suffix="% p.a." valueFraction={sim.rates[0]?.annualRateDecimal ?? null} onChange={setRate} />
        <CalculationMethodSummary sim={sim} />
        <Button type="button" variant="outline" size="sm" className="justify-between" onClick={onRateChanges}>
          <span>Rate changes <span className="text-muted-foreground">(optional)</span></span>
          <span className="text-xs text-muted-foreground">{laterRates > 0 ? laterRates : "None"}</span>
        </Button>
        <InterestOnlyControl sim={sim} propose={propose} />
      </ConfigurationSection>
    </>
  );
}
