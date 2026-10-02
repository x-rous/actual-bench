"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { bpsToFraction, formatAmount, fractionToBps } from "../../lib/money";
import { firstEligibleFundingRepaymentDate, isOffsetAssumptionKind, simKey, type SimComponent, type SimOffset, type SimulationState } from "../../lib/simulatorModel";
import { OFFSET_BASIS_OPTIONS, REPAYMENT_FREQUENCY_OPTIONS, REVOLVING_MODEL_OPTIONS } from "../../lib/vocabulary";
import { DateField, FeatureSwitch, IntegerField, MoneyField, PercentField, SelectField } from "../fields";
import { ConfigurationSection } from "./PrimaryInputs";

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
    const offsets = stash.offsets.length ? stash.offsets : [{ key, placeholderAccountId: key, effectiveFrom: sim.startDate, effectiveTo: null, percentageBps: 10_000, basis: "total" as const, capMinor: null, fundScheduledRepayments: false, fundScheduledRepaymentsFrom: null }];
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
  return (
    <>
      <ConfigurationSection
        title="3. Repayments"
        help="Frequency generates the contractual repayment dates. Contract repayment amount overrides a derived amount; first repayment and maturity anchor lender dates, while Balloon payment ends the contract before the amortization term. Lines of credit use the minimum-payment fields instead."
      >
        <SelectField label="Frequency" value={sim.profile.repaymentFrequency} options={REPAYMENT_FREQUENCY_OPTIONS} onChange={(repaymentFrequency) => change({ ...sim, profile: { ...sim.profile, repaymentFrequency: repaymentFrequency as SimulationState["profile"]["repaymentFrequency"] } })} />
        {sim.shape === "term-loan" ? <MoneyField label="Contract repayment amount (optional)" valueMinor={sim.contractualPaymentMinor} minorDigits={sim.minorDigits} onChange={setContractualPayment} /> : null}

        <div className="border-t border-border pt-3">
          <FeatureSwitch label="Choose first repayment date" description={sim.firstPaymentDate ?? "Derived from the frequency"} checked={sim.firstPaymentDate !== null} onChange={(on) => propose({ ...sim, firstPaymentDate: on ? addMonths(sim.startDate, 1) : null })} />
          {sim.firstPaymentDate !== null ? <DateField className="mt-2 pl-2" label="First repayment date" value={sim.firstPaymentDate} onChange={(firstPaymentDate) => propose({ ...sim, firstPaymentDate })} /> : null}
        </div>

        {sim.shape === "term-loan" ? <DateField label="Contract maturity date (optional)" value={sim.maturityDate ?? ""} onChange={(maturityDate) => change({ ...sim, maturityDate: maturityDate || null })} /> : null}

        <div className="border-t border-border pt-3">
          <FeatureSwitch
            label="Balloon payment"
            description={balloon ? `Contract ends after ${sim.contractTermMonths ?? 0} months` : "End the contract before full amortization"}
            checked={balloon}
            onChange={(on) => change({ ...sim, contractTermMonths: on ? Math.min(sim.termMonths ?? 60, 60) : null, profile: { ...sim.profile, finalPayment: on ? "contractual-balloon" : sim.profile.finalPayment === "contractual-balloon" ? "true-up-to-zero" : sim.profile.finalPayment } })}
          />
          {balloon ? <IntegerField className="mt-2 pl-2" label="Contract term" suffix="months" min={1} value={sim.contractTermMonths} onChange={(contractTermMonths) => change({ ...sim, contractTermMonths })} /> : null}
        </div>

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

      <ConfigurationSection
        title="4. Offset account"
        help="Offset account starting balance is the eligible balance when the offset begins. Offset share controls how much qualifies, Balance used selects the debt basis, and the optional cap and end date limit the amount or period applied. Add later deposits and withdrawals under Events."
      >
        <FeatureSwitch label="Offset account" description={offset ? `Starting balance ${formatAmount(startingBalance?.amountMinor ?? 0, sim.minorDigits)}` : "Reduce interest with an eligible balance"} checked={sim.offsets.length > 0} onChange={toggleOffset} />
        {offset ? (
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <MoneyField className="col-span-2" label="Offset account starting balance" hint="Enter the starting balance of your offset account." valueMinor={startingBalance?.amountMinor ?? 0} minorDigits={sim.minorDigits} onChange={setStartingBalance} />
            <PercentField label="Offset share" valueFraction={bpsToFraction(offset.percentageBps)} onChange={(fraction) => { const bps = fractionToBps(fraction); if (bps && bps >= 1 && bps <= 10_000) setOffset({ percentageBps: bps }); }} />
            <SelectField label="Balance used" value={offset.basis} options={OFFSET_BASIS_OPTIONS} onChange={(basis) => setOffset({ basis: basis as SimOffset["basis"] })} />
            <MoneyField className="col-span-2" label="Offset cap (optional)" valueMinor={offset.capMinor} minorDigits={sim.minorDigits} onChange={(capMinor) => setOffset({ capMinor: capMinor && capMinor > 0 ? capMinor : null })} />
            <DateField label="Offset from" value={offset.effectiveFrom} onChange={setOffsetFrom} />
            <DateField label="Offset until (optional)" value={offset.effectiveTo ?? ""} onChange={(effectiveTo) => setOffset({ effectiveTo: effectiveTo || null })} />
            <div className="col-span-2 border-t border-border pt-3">
              {sim.offsets.length === 1 ? (
                <FeatureSwitch
                  label="Draw scheduled repayments from offset"
                  description="Use available offset funds for regular repayments and the final true-up. Any remainder comes from other funds."
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
                  label="Start drawing repayments (optional)"
                  value={fundingOffset.fundScheduledRepaymentsFrom ?? ""}
                  hint={fundingOffset.fundScheduledRepaymentsFrom
                    ? firstEligibleFundingDate
                      ? `First eligible funded repayment: ${firstEligibleFundingDate}. The offset reduces interest before then.`
                      : "No scheduled repayment falls within this funding interval. The offset still reduces interest while active."
                    : "Leave empty to draw from the first scheduled repayment while this offset link is active."}
                  onChange={setFundingStart}
                />
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Simulation only. This does not create, move, or match transactions in Actual.
              </p>
            </div>
          </div>
        ) : null}
      </ConfigurationSection>

      <ConfigurationSection
        title="5. Fees and other costs"
        help="Enable this section for recurring fees, insurance, escrow, tax, or other costs paid with repayments. Each item has an amount and treatment; one-off fees belong under Events."
      >
        <FeatureSwitch label="Fees and other costs" description={sim.components.length ? `${sim.components.length} recurring cost${sim.components.length === 1 ? "" : "s"}` : "Include recurring fees, insurance or other costs"} checked={sim.components.length > 0} onChange={toggleFees} />
        {sim.components.length ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs">
            {sim.components.map((component) => <span key={component.key}>{labelOfKind(component.economicKind)} · {component.fixedAmountMinor === null ? "Amount not set" : formatAmount(component.fixedAmountMinor, sim.minorDigits)}{component.economicKind === "fee" ? ` · ${component.treatment === "capitalized" ? "Added to loan" : "Paid in cash"}` : ""}</span>)}
            <Button type="button" variant="outline" size="sm" onClick={() => setFeesOpen(true)}>Edit fees and costs</Button>
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
