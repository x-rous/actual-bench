"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { bpsToFraction, formatAmount, fractionToBps } from "../../lib/money";
import { firstEligibleFundingRepaymentDate, isOffsetAssumptionKind, simKey, type SimComponent, type SimOffset, type SimulationState } from "../../lib/simulatorModel";
import { OFFSET_BASIS_OPTIONS, REPAYMENT_FREQUENCY_OPTIONS, REVOLVING_MODEL_OPTIONS } from "../../lib/vocabulary";
import { DateField, FeatureSwitch, IntegerField, MoneyField, PercentField, SelectField } from "../fields";
import { ConfigurationSection } from "./ConfigurationSection";
import { InterestOnlyControl } from "./InterestOnlyControl";

/**
 * Optional features (P1.3b T206; FR-220). Each appears only when switched on
 * or relevant. A feature switched off keeps its values here (UI state) so
 * switching it back restores them, but contributes nothing to the model.
 * Anything the period-by-period calculation cannot represent goes through
 * `propose`, which asks before switching to day-by-day (O1).
 */

type Props = { sim: SimulationState; change: (next: SimulationState) => void; propose: (next: SimulationState) => void };


export function FeatureControls({ sim, change, propose }: Props) {
  const [stash, setStash] = useState<{ offsets: SimOffset[]; offsetEvents: SimulationState["assumptions"]; components: SimComponent[] }>({ offsets: [], offsetEvents: [], components: [] });
  const [feesOpen, setFeesOpen] = useState(false);
  const [offsetAdvancedOpen, setOffsetAdvancedOpen] = useState(false);
  const derivedRepayment = useRef<SimulationState["profile"]["repaymentDerivation"]>(
    sim.profile.repaymentDerivation === "contractual-fixed" || sim.profile.repaymentDerivation === "lender-provided"
      ? "annuity-at-payment-frequency"
      : sim.profile.repaymentDerivation,
  );
  const offset = sim.offsets[0];
  const fundingOffset = sim.offsets.find((item) => item.fundScheduledRepayments) ?? null;
  const firstEligibleFundingDate = fundingOffset ? firstEligibleFundingRepaymentDate(sim, fundingOffset) : null;
  const startingBalance = offset ? sim.assumptions.find((a) => a.kind === "offset-balance" && a.offsetAccountId === offset.placeholderAccountId && a.effectiveFrom <= offset.effectiveFrom) : undefined;

  const toggleOffset = (on: boolean) => {
    if (!on) {
      setStash((s) => ({ ...s, offsets: sim.offsets, offsetEvents: sim.assumptions.filter((a) => isOffsetAssumptionKind(a.kind)) }));
      change({ ...sim, offsets: [], assumptions: sim.assumptions.filter((a) => !isOffsetAssumptionKind(a.kind)) });
      return;
    }
    const key = simKey("offset");
    const offsets = stash.offsets.length ? stash.offsets : [{ key, placeholderAccountId: key, effectiveFrom: sim.startDate, effectiveTo: null, percentageBps: 10_000, basis: "total" as const, capMinor: null, fundScheduledRepayments: false, fundScheduledRepaymentsFrom: null, useActualBalance: false }];
    const offsetEvents = stash.offsets.length ? stash.offsetEvents : [{ key: simKey("offset-balance"), kind: "offset-balance" as const, effectiveFrom: sim.startDate, recurrence: null, amountMinor: 0, feeTreatment: null, offsetAccountId: offsets[0].placeholderAccountId, note: null }];
    propose({ ...sim, offsets, assumptions: [...sim.assumptions, ...offsetEvents] });
  };

  const setOffset = (patch: Partial<SimOffset>) => change({ ...sim, offsets: sim.offsets.map((o, i) => (i === 0 ? { ...o, ...patch } : o)) });
  const setFundingSource = (key: string | null) => propose({
    ...sim,
    offsets: sim.offsets.map((item) => ({ ...item, fundScheduledRepayments: item.key === key })),
  });
  const setFundingStart = (date: string) => change({
    ...sim,
    offsets: sim.offsets.map((item) => item.key === fundingOffset?.key ? { ...item, fundScheduledRepaymentsFrom: date || null } : item),
  });
  /** The starting offset balance moves with the offset's start date. */
  const setOffsetFrom = (date: string) => {
    if (!offset || !date) return;
    change({
      ...sim,
      offsets: sim.offsets.map((o, i) => (i === 0 ? { ...o, effectiveFrom: date } : o)),
      assumptions: sim.assumptions.map((a) => (startingBalance && a.key === startingBalance.key ? { ...a, effectiveFrom: date } : a)),
    });
  };
  const setStartingBalance = (minor: number | null) => {
    if (!offset || !startingBalance) return;
    change({ ...sim, assumptions: sim.assumptions.map((a) => (a.key === startingBalance.key ? { ...a, amountMinor: minor ?? 0 } : a)) });
  };

  const toggleFees = (on: boolean) => {
    if (!on) {
      setStash((s) => ({ ...s, components: sim.components }));
      change({ ...sim, components: [] });
      return;
    }
    change({ ...sim, components: stash.components.length ? stash.components : [{ key: simKey("cost"), economicKind: "fee", amountRule: "fixed", fixedAmountMinor: null, treatment: "cash-paid" }] });
    setFeesOpen(true);
  };

  const balloon = sim.contractTermMonths !== null;
  const toggleBalloon = (on: boolean) => change({
    ...sim,
    contractTermMonths: on ? Math.min(sim.termMonths ?? 60, 60) : null,
    profile: { ...sim.profile, finalPayment: on ? "contractual-balloon" : sim.profile.finalPayment === "contractual-balloon" ? "true-up-to-zero" : sim.profile.finalPayment },
  });
  const setContractualPayment = (amount: number | null) => {
    if (amount !== null) {
      if (sim.profile.repaymentDerivation !== "contractual-fixed" && sim.profile.repaymentDerivation !== "lender-provided") {
        derivedRepayment.current = sim.profile.repaymentDerivation;
      }
      change({ ...sim, contractualPaymentMinor: amount, profile: { ...sim.profile, repaymentDerivation: "contractual-fixed", presetId: null } });
      return;
    }
    change({
      ...sim,
      contractualPaymentMinor: null,
      profile: {
        ...sim.profile,
        repaymentDerivation: sim.profile.repaymentDerivation === "contractual-fixed" || sim.profile.repaymentDerivation === "lender-provided" ? derivedRepayment.current : sim.profile.repaymentDerivation,
        presetId: null,
      },
    });
  };
  const cashPaidEachRepayment = sim.components.reduce((total, component) => total + (component.treatment === "capitalized" ? 0 : (component.fixedAmountMinor ?? 0)), 0);
  const addedToLoanEachRepayment = sim.components.reduce((total, component) => total + (component.treatment === "capitalized" ? (component.fixedAmountMinor ?? 0) : 0), 0);
  return (
    <>
      <ConfigurationSection
        title="Repayments"
        helpDescription="The contractual payment schedule and any lender-provided anchors."
        help={[{ items: [
          { term: "Frequency", description: "Generates the regular contractual repayment dates. New simulations default to Monthly." },
          { term: "Contract repayment amount", description: "Optional. When entered, the lender-provided amount is used instead of a derived regular repayment." },
          { term: "First repayment date", description: "Optional. Leave blank to use the existing automatically derived first date; clearing a saved date restores that default." },
          { term: "Contract maturity date", description: "Optional lender-stated final contractual date. It does not replace the amortization or final-payment settings." },
          { term: "Line of credit fields", description: "For revolving credit, the credit limit and minimum-payment rule replace fixed-term repayment inputs where applicable." },
        ] }]}
      >
        <SelectField label="Frequency" value={sim.profile.repaymentFrequency} options={REPAYMENT_FREQUENCY_OPTIONS} onChange={(repaymentFrequency) => change({ ...sim, profile: { ...sim.profile, repaymentFrequency: repaymentFrequency as SimulationState["profile"]["repaymentFrequency"] } })} />
        {sim.shape === "term-loan" ? <MoneyField label="Contract repayment amount (optional)" valueMinor={sim.contractualPaymentMinor} minorDigits={sim.minorDigits} onChange={setContractualPayment} /> : null}
        <DateField label="First repayment date (optional)" value={sim.firstPaymentDate ?? ""} onChange={(firstPaymentDate) => propose({ ...sim, firstPaymentDate: firstPaymentDate || null })} />
        {sim.shape === "term-loan" ? <DateField label="Contract maturity date (optional)" value={sim.maturityDate ?? ""} onChange={(maturityDate) => change({ ...sim, maturityDate: maturityDate || null })} /> : null}
        {sim.shape === "revolving-credit" ? (
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <MoneyField className="col-span-2" label="Credit limit" valueMinor={sim.creditLimitMinor} minorDigits={sim.minorDigits} onChange={(creditLimitMinor) => change({ ...sim, creditLimitMinor })} />
            <SelectField className="col-span-2" label="Minimum payment" value={sim.revolving?.paymentModel ?? ""} options={REVOLVING_MODEL_OPTIONS} onChange={(paymentModel) => change({ ...sim, revolving: { paymentModel: paymentModel as NonNullable<SimulationState["revolving"]>["paymentModel"], percentOfBalanceBps: sim.revolving?.percentOfBalanceBps ?? null, minimumFloorMinor: sim.revolving?.minimumFloorMinor ?? null } })} />
            {sim.revolving?.paymentModel === "percent-of-balance" ? <>
              <PercentField label="Share of balance" valueFraction={sim.revolving.percentOfBalanceBps === null ? null : bpsToFraction(sim.revolving.percentOfBalanceBps)} onChange={(fraction) => change({ ...sim, revolving: { ...sim.revolving!, percentOfBalanceBps: fractionToBps(fraction) } })} />
              <MoneyField label="Minimum amount" valueMinor={sim.revolving.minimumFloorMinor} minorDigits={sim.minorDigits} onChange={(minimumFloorMinor) => change({ ...sim, revolving: { ...sim.revolving!, minimumFloorMinor } })} />
            </> : null}
          </div>
        ) : null}
      </ConfigurationSection>

      <InterestOnlyControl sim={sim} propose={propose} />

      <ConfigurationSection
        title="Balloon payment"
        enabled={balloon}
        onEnabledChange={toggleBalloon}
        collapsedSummary="End the contract before full amortization"
        helpDescription="An optional contractual end before the balance is fully amortized."
        help={[{ items: [
          { term: "Contract term", description: "The number of months until the contractual balloon event. The section defaults off; when first enabled it uses up to 60 months from the amortization term." },
          { term: "Final balance", description: "The remaining debt is handled by the existing contractual-balloon calculation method; this section does not change its allocation or rounding." },
          { term: "Disabled", description: "The ordinary final-payment setting applies and no contractual balloon is generated." },
        ] }]}
      >
        <IntegerField label="Contract term" suffix="months" min={1} value={sim.contractTermMonths} onChange={(contractTermMonths) => change({ ...sim, contractTermMonths })} />
      </ConfigurationSection>

      <ConfigurationSection
        title="Offset account"
        enabled={sim.offsets.length > 0}
        onEnabledChange={toggleOffset}
        collapsedSummary="Reduce eligible debt with an offset balance"
        helpDescription="Controls the simulated offset balance used by the configured interest calculation."
        help={[{ title: "Balance and eligibility", items: [
          { term: "Starting balance", description: "Defaults to zero when the section is first enabled. It is the opening simulated offset balance; add later deposits and withdrawals under Events." },
          { term: "Offset share", description: "Defaults to 100%. It is the percentage of the offset balance eligible to reduce the configured debt basis." },
          { term: "Balance used", description: "Defaults to Total balance and selects which outstanding debt balance is eligible for the offset." },
          { term: "Cap", description: "Optionally limits the eligible offset amount without changing the account balance itself." },
          { term: "Offset start/end", description: "A new offset starts on the loan date with no end date. These fields control the effective interval without introducing new date synchronization or calculation rules." },
        ] }, { title: "Repayment funding", items: [
          { term: "Draw repayments", description: "When enabled, available funds in the selected offset account simulate funding regular scheduled repayments and the final true-up." },
          { term: "Start drawing from", description: "Optional. Blank uses the existing default; when set, only eligible repayments on or after that date draw from offset." },
          { term: "Actual transactions", description: "Repayment funding is simulation-only. It does not create, move or match transactions in Actual." },
        ] }]}
      >
        {offset ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
            <MoneyField className="col-span-2" label="Offset account starting balance" valueMinor={startingBalance?.amountMinor ?? 0} minorDigits={sim.minorDigits} onChange={setStartingBalance} />
            <PercentField label="Offset share" valueFraction={bpsToFraction(offset.percentageBps)} onChange={(fraction) => { const bps = fractionToBps(fraction); if (bps && bps >= 1 && bps <= 10_000) setOffset({ percentageBps: bps }); }} />
            <SelectField label="Balance used" value={offset.basis} options={OFFSET_BASIS_OPTIONS} onChange={(basis) => setOffset({ basis: basis as SimOffset["basis"] })} />
            </div>
            <div className="border-t border-border pt-3">
              <button type="button" aria-expanded={offsetAdvancedOpen} onClick={() => setOffsetAdvancedOpen((open) => !open)} className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Advanced offset settings
                <ChevronDown className={cn("size-4 transition-transform", offsetAdvancedOpen && "rotate-180")} aria-hidden="true" />
              </button>
              {offsetAdvancedOpen ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MoneyField className="col-span-2" label="Offset cap (optional)" valueMinor={offset.capMinor} minorDigits={sim.minorDigits} onChange={(capMinor) => setOffset({ capMinor: capMinor && capMinor > 0 ? capMinor : null })} />
                  <DateField label="Offset start date" value={offset.effectiveFrom} onChange={setOffsetFrom} />
                  <DateField label="Offset end date (optional)" value={offset.effectiveTo ?? ""} onChange={(effectiveTo) => setOffset({ effectiveTo: effectiveTo || null })} />
                </div>
              ) : null}
            </div>
            <div className="border-t border-border pt-3">
              {sim.offsets.length === 1 ? (
                <FeatureSwitch
                  label="Draw scheduled repayments from offset"
                  checked={offset.fundScheduledRepayments}
                  onChange={(on) => setFundingSource(on ? offset.key : null)}
                />
              ) : (
                <SelectField
                  label="Scheduled repayment funding account"
                  value={sim.offsets.find((item) => item.fundScheduledRepayments)?.key ?? "none"}
                  options={[
                    { value: "none", label: "Other funds only" },
                    ...sim.offsets.map((item, index) => ({ value: item.key, label: `Offset account ${index + 1}` })),
                  ]}
                  onChange={(value) => setFundingSource(value === "none" ? null : value)}
                />
              )}
              {fundingOffset ? (
                <DateField
                  className="mt-3"
                  label="Start drawing from (optional)"
                  value={fundingOffset.fundScheduledRepaymentsFrom ?? ""}
                  hint={fundingOffset.fundScheduledRepaymentsFrom
                    ? firstEligibleFundingDate
                      ? `First eligible funded repayment: ${firstEligibleFundingDate}. The offset reduces interest before then.`
                      : "No scheduled repayment falls within this funding interval. The offset still reduces interest while active."
                    : undefined}
                  onChange={setFundingStart}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </ConfigurationSection>

      <ConfigurationSection
        title="Fees and other costs"
        enabled={sim.components.length > 0}
        onEnabledChange={toggleFees}
        collapsedSummary="Add recurring fees, insurance or other costs"
        helpDescription="Recurring amounts attached to scheduled repayments. One-off fees remain available under Events."
        help={[{ items: [
          { term: "Recurring costs", description: "The section defaults off. When enabled, add fees, insurance, escrow, tax or other amounts applied with each scheduled repayment." },
          { term: "Paid in cash", description: "Included in the displayed payment cash movement without being added to the loan balance." },
          { term: "Added to loan", description: "Capitalized using the existing fee treatment, increasing debt instead of the cash paid with that repayment." },
          { term: "Disabled", description: "Recurring costs are retained temporarily by the simulator so they can be restored, but they do not affect the projection." },
        ] }]}
      >
        {sim.components.length ? (
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
              <span>{sim.components.length} recurring {sim.components.length === 1 ? "cost" : "costs"}</span>
              {cashPaidEachRepayment > 0 ? <span><strong className="font-medium text-foreground">{formatAmount(cashPaidEachRepayment, sim.minorDigits)}</strong> paid each repayment</span> : null}
              {addedToLoanEachRepayment > 0 ? <span><strong className="font-medium text-foreground">{formatAmount(addedToLoanEachRepayment, sim.minorDigits)}</strong> added to the loan each repayment</span> : null}
            </div>
            <ul className="flex flex-col gap-1">
              {sim.components.map((component) => <li key={component.key}>{labelOfKind(component.economicKind)} · {component.fixedAmountMinor === null ? "Amount not set" : formatAmount(component.fixedAmountMinor, sim.minorDigits)} · {component.treatment === "capitalized" ? "Added to loan" : "Paid in cash"}</li>)}
            </ul>
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setFeesOpen(true)}>Manage costs</Button>
          </div>
        ) : null}
      </ConfigurationSection>

      <FeesDialog open={feesOpen} onClose={() => setFeesOpen(false)} sim={sim} change={change} />
    </>
  );
}

const KIND_OPTIONS = [
  { value: "fee", label: "Fee" },
  { value: "insurance", label: "Insurance" },
  { value: "escrow", label: "Escrow" },
  { value: "tax", label: "Tax" },
  { value: "other", label: "Other cost" },
];
const labelOfKind = (k: string) => KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;

function FeesDialog({ open, onClose, sim, change }: { open: boolean; onClose: () => void; sim: SimulationState; change: (next: SimulationState) => void }) {
  const set = (key: string, patch: Partial<SimComponent>) => change({ ...sim, components: sim.components.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Fees and other costs</DialogTitle>
          <DialogDescription>Amounts paid with each repayment. A fee can instead be added to the loan. One-off fees are added under Events.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {sim.components.map((c, i) => (
            <li key={c.key} className="grid grid-cols-2 gap-2 rounded border border-border p-2">
              <SelectField label={`Cost ${i + 1}`} value={c.economicKind} options={KIND_OPTIONS} onChange={(v) => set(c.key, { economicKind: v as SimComponent["economicKind"], treatment: v === "fee" ? (c.treatment ?? "cash-paid") : null })} />
              <MoneyField label="Amount each repayment" valueMinor={c.fixedAmountMinor} minorDigits={sim.minorDigits} onChange={(v) => set(c.key, { fixedAmountMinor: v })} />
              {c.economicKind === "fee" ? (
                <SelectField
                  label="How it is paid"
                  className="col-span-2"
                  value={c.treatment ?? "cash-paid"}
                  options={[
                    { value: "cash-paid", label: "Paid in cash with the repayment" },
                    { value: "capitalized", label: "Added to the loan" },
                  ]}
                  onChange={(v) => set(c.key, { treatment: v as SimComponent["treatment"] })}
                />
              ) : null}
              <Button type="button" variant="ghost" size="sm" className="col-span-2 justify-self-start" onClick={() => change({ ...sim, components: sim.components.filter((x) => x.key !== c.key) })}>
                Remove cost {i + 1}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => change({ ...sim, components: [...sim.components, { key: simKey("cost"), economicKind: "fee", amountRule: "fixed", fixedAmountMinor: null, treatment: "cash-paid" }] })}>
            Add a cost
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
