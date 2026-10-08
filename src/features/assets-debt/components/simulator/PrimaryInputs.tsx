"use client";

import { Button } from "@/components/ui/button";
import type { SimulationState } from "../../lib/simulatorModel";
import { DateField, IntegerField, MoneyField, PercentField, SelectField } from "../fields";
import { CalculationMethodSummary } from "./CalculationMethodDrawer";
import { ConfigurationSection } from "./ConfigurationSection";

type Props = {
  sim: SimulationState;
  change: (next: SimulationState) => void;
  onCalculationMethod: () => void;
  onRateChanges: () => void;
};

/** The ordinary modelling path, grouped by contract concept instead of one long field list. */
export function PrimaryInputs({ sim, change, onCalculationMethod, onRateChanges }: Props) {
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
        title="Loan"
        helpDescription="The core contract inputs used to build the loan timeline."
        help={[{ items: [
          { term: "Loan type", description: "Defaults to Term loan. Choosing a revolving line of credit changes which repayment fields are available." },
          { term: "Loan amount", description: "The opening principal, or the amount initially drawn for a line of credit. A new simulator starts with the sample amount 500,000." },
          { term: "Years and months", description: "The amortization term. A new simulator starts at 20 years; leave both blank only when the selected loan type does not require a fixed term." },
          { term: "Start date", description: "The date the opening balance and opening interest rate take effect. A new simulator uses today's date." },
        ] }]}
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
        title="Interest Rate"
        helpDescription="The opening rate and the calculation conventions applied to it."
        help={[{ items: [
          { term: "Interest rate", description: "The opening annual rate. A new simulator starts at 5.4% p.a.; it applies until a later rate change takes effect." },
          { term: "Calculation method", description: "Summarizes the configured day count, accrual, charging and repayment conventions. Use Set calculation method in the top bar to edit them." },
          { term: "Rate changes", description: "Defaults to none. Effective-dated later rates use the same rate-change editor available from Events." },
        ] }]}
      >
        <PercentField label="Interest rate" suffix="% p.a." valueFraction={sim.rates[0]?.annualRateDecimal ?? null} onChange={setRate} />
        <CalculationMethodSummary sim={sim} onOpen={onCalculationMethod} />
        <Button type="button" variant="outline" size="sm" className="justify-between" onClick={onRateChanges}>
          <span>Rate changes <span className="text-muted-foreground">(optional)</span></span>
          <span className="text-xs text-muted-foreground">{laterRates > 0 ? laterRates : "None"}</span>
        </Button>
      </ConfigurationSection>
    </>
  );
}
