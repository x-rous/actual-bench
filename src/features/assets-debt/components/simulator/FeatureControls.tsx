"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { bpsToFraction, formatMinor, fractionToBps } from "../../lib/money";
import { needsContractualPayment, simKey, type SimComponent, type SimOffset, type SimulationState } from "../../lib/simulatorModel";
import { OFFSET_BASIS_OPTIONS, RECAST_OPTIONS, REVOLVING_MODEL_OPTIONS } from "../../lib/vocabulary";
import { DateField, FeatureSwitch, IntegerField, MoneyField, PercentField, SelectField } from "../fields";

/**
 * Optional features (P1.3b T206; FR-220). Each appears only when switched on
 * or relevant. A feature switched off keeps its values here (UI state) so
 * switching it back restores them, but contributes nothing to the model.
 * Anything the period-by-period calculation cannot represent goes through
 * `propose`, which asks before switching to day-by-day (O1).
 */

type Props = { sim: SimulationState; change: (next: SimulationState) => void; propose: (next: SimulationState) => void };


export function FeatureControls({ sim, change, propose }: Props) {
  const [stash, setStash] = useState<{ offsets: SimOffset[]; offsetBalances: SimulationState["assumptions"]; components: SimComponent[] }>({ offsets: [], offsetBalances: [], components: [] });
  const [moreOpen, setMoreOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const [phasesOpen, setPhasesOpen] = useState(false);
  const offset = sim.offsets[0];
  const startingBalance = offset ? sim.assumptions.find((a) => a.kind === "offset-balance" && a.offsetAccountId === offset.placeholderAccountId && a.effectiveFrom <= offset.effectiveFrom) : undefined;
  const ioMonths = sim.phases[0] ? monthsBetween(sim.phases[0].from, sim.phases[0].to) : 24;

  const toggleOffset = (on: boolean) => {
    if (!on) {
      setStash((s) => ({ ...s, offsets: sim.offsets, offsetBalances: sim.assumptions.filter((a) => a.kind === "offset-balance") }));
      change({ ...sim, offsets: [], assumptions: sim.assumptions.filter((a) => a.kind !== "offset-balance") });
      return;
    }
    const key = simKey("offset");
    const offsets = stash.offsets.length ? stash.offsets : [{ key, placeholderAccountId: key, effectiveFrom: sim.startDate, effectiveTo: null, percentageBps: 10_000, basis: "total" as const, capMinor: null }];
    const balances = stash.offsets.length ? stash.offsetBalances : [{ key: simKey("offset-balance"), kind: "offset-balance" as const, effectiveFrom: sim.startDate, recurrence: null, amountMinor: 0, feeTreatment: null, offsetAccountId: offsets[0].placeholderAccountId, note: null }];
    propose({ ...sim, offsets, assumptions: [...sim.assumptions, ...balances] });
  };

  const setOffset = (patch: Partial<SimOffset>) => change({ ...sim, offsets: sim.offsets.map((o, i) => (i === 0 ? { ...o, ...patch } : o)) });
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

  const toggleInterestOnly = (on: boolean) => {
    const phases = sim.phases.length ? sim.phases : [{ kind: "interest-only" as const, from: sim.startDate, to: addMonths(sim.startDate, 24), recastAtEnd: "on-rate-change" as const }];
    propose({ ...sim, interestOnly: on, phases });
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
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Features</h3>

      <FeatureSwitch label="Interest-only period" description="Pay only interest for a while, then repay the loan over the rest of the term." checked={sim.interestOnly} onChange={toggleInterestOnly} />
      {sim.interestOnly ? (
        <div className="ml-6 flex flex-col gap-2">
          {sim.phases.length <= 1 ? (
            <IntegerField
              label="Interest-only for"
              suffix="months"
              min={1}
              value={ioMonths}
              onChange={(m) => m && propose({ ...sim, phases: [{ ...(sim.phases[0] ?? { kind: "interest-only", from: sim.startDate, recastAtEnd: "on-rate-change" }), to: addMonths(sim.phases[0]?.from ?? sim.startDate, m) }] })}
            />
          ) : (
            <p className="text-xs">{sim.phases.length} interest-only periods</p>
          )}
          <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setPhasesOpen(true)}>
            Edit periods
          </Button>
        </div>
      ) : null}

      <FeatureSwitch label="Offset account" description="A savings balance that reduces the interest charged." checked={sim.offsets.length > 0} onChange={toggleOffset} />
      {offset ? (
        <div className="ml-6 grid grid-cols-2 gap-2">
          <MoneyField className="col-span-2" label="Offset balance" hint="Change it over time with Offset balance changes." valueMinor={startingBalance?.amountMinor ?? 0} minorDigits={sim.minorDigits} suffix={sim.currency} onChange={setStartingBalance} />
          <PercentField label="Offset share" valueFraction={bpsToFraction(offset.percentageBps)} onChange={(f) => { const bps = fractionToBps(f); if (bps && bps >= 1 && bps <= 10_000) setOffset({ percentageBps: bps }); }} />
          <SelectField label="Balance used" value={offset.basis} options={OFFSET_BASIS_OPTIONS} onChange={(v) => setOffset({ basis: v as SimOffset["basis"] })} />
          <MoneyField className="col-span-2" label="Offset cap" hint="Blank for no cap." valueMinor={offset.capMinor} minorDigits={sim.minorDigits} onChange={(v) => setOffset({ capMinor: v && v > 0 ? v : null })} />
          <DateField label="Offset from" value={offset.effectiveFrom} onChange={setOffsetFrom} />
          <DateField label="Offset until" hint="Blank while it continues." value={offset.effectiveTo ?? ""} onChange={(d) => setOffset({ effectiveTo: d || null })} />
        </div>
      ) : null}

      <FeatureSwitch label="Fees and other costs" description="Account fees, insurance or other amounts paid with each repayment." checked={sim.components.length > 0} onChange={toggleFees} />
      {sim.components.length ? (
        <div className="ml-6 flex flex-col gap-1 text-xs">
          {sim.components.map((c) => (
            <span key={c.key}>
              {labelOfKind(c.economicKind)}: {c.fixedAmountMinor === null ? "amount not set" : formatMinor(c.fixedAmountMinor, sim.minorDigits, sim.currency)}
              {c.economicKind === "fee" ? ` · ${c.treatment === "capitalized" ? "added to the loan" : "paid in cash"}` : ""}
            </span>
          ))}
          <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setFeesOpen(true)}>
            Edit fees and costs
          </Button>
        </div>
      ) : null}

      {sim.shape === "revolving-credit" ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <MoneyField label="Credit limit" valueMinor={sim.creditLimitMinor} minorDigits={sim.minorDigits} suffix={sim.currency} onChange={(v) => change({ ...sim, creditLimitMinor: v })} />
          <SelectField label="Minimum payment" value={sim.revolving?.paymentModel ?? ""} options={REVOLVING_MODEL_OPTIONS} onChange={(v) => change({ ...sim, revolving: { paymentModel: v as NonNullable<SimulationState["revolving"]>["paymentModel"], percentOfBalanceBps: sim.revolving?.percentOfBalanceBps ?? null, minimumFloorMinor: sim.revolving?.minimumFloorMinor ?? null } })} />
          {sim.revolving?.paymentModel === "percent-of-balance" ? (
            <>
              <PercentField label="Share of the balance" valueFraction={sim.revolving.percentOfBalanceBps === null ? null : bpsToFraction(sim.revolving.percentOfBalanceBps)} onChange={(f) => change({ ...sim, revolving: { ...sim.revolving!, percentOfBalanceBps: fractionToBps(f) } })} />
              <MoneyField label="But at least" valueMinor={sim.revolving.minimumFloorMinor} minorDigits={sim.minorDigits} onChange={(v) => change({ ...sim, revolving: { ...sim.revolving!, minimumFloorMinor: v } })} />
            </>
          ) : null}
        </div>
      ) : null}

      <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} className="self-start text-xs font-medium text-primary">
        {moreOpen ? "Fewer options" : "More options"}
      </button>
      {moreOpen ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <FeatureSwitch label="Choose the first repayment date" description="Otherwise it is one repayment period after the start." checked={sim.firstPaymentDate !== null} onChange={(on) => propose({ ...sim, firstPaymentDate: on ? addMonths(sim.startDate, 1) : null })} />
          {sim.firstPaymentDate !== null ? <DateField label="First repayment" value={sim.firstPaymentDate} onChange={(d) => propose({ ...sim, firstPaymentDate: d })} /> : null}
          <FeatureSwitch
            label="Balloon: the contract ends before the loan is repaid"
            checked={balloon}
            onChange={(on) =>
              change({
                ...sim,
                contractTermMonths: on ? Math.min(sim.termMonths ?? 60, 60) : null,
                maturityDate: on ? sim.maturityDate : null,
                profile: { ...sim.profile, finalPayment: on ? "contractual-balloon" : sim.profile.finalPayment === "contractual-balloon" ? "true-up-to-zero" : sim.profile.finalPayment },
              })
            }
          />
          {balloon ? <IntegerField label="Contract term" suffix="months" min={1} value={sim.contractTermMonths} onChange={(m) => change({ ...sim, contractTermMonths: m })} hint="The loan is repaid over the main term; the rest is due at the end of the contract." /> : null}
          {balloon ? <DateField label="Contract ends on" hint="Optional: the maturity date the contract states." value={sim.maturityDate ?? ""} onChange={(d) => change({ ...sim, maturityDate: d || null })} /> : null}
          {needsContractualPayment(sim.profile) ? <MoneyField label="Contract repayment" hint="The repayment the contract states." valueMinor={sim.contractualPaymentMinor} minorDigits={sim.minorDigits} suffix={sim.currency} onChange={(v) => change({ ...sim, contractualPaymentMinor: v })} /> : null}
        </div>
      ) : null}

      <FeesDialog open={feesOpen} onClose={() => setFeesOpen(false)} sim={sim} change={change} />
      <PhasesDialog open={phasesOpen} onClose={() => setPhasesOpen(false)} sim={sim} propose={propose} />
    </div>
  );
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm));
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fees and other costs</DialogTitle>
          <DialogDescription>Amounts paid with each repayment. A fee can instead be added to the loan. One-off fees are extra transactions.</DialogDescription>
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

function PhasesDialog({ open, onClose, sim, propose }: { open: boolean; onClose: () => void; sim: SimulationState; propose: (next: SimulationState) => void }) {
  const setPhase = (i: number, patch: Partial<SimulationState["phases"][number]>) => propose({ ...sim, phases: sim.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Interest-only periods</DialogTitle>
          <DialogDescription>During each period only interest is paid. At its end the repayment is recalculated as chosen.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {sim.phases.map((p, i) => (
            <li key={`${p.from}:${i}`} className="grid grid-cols-2 gap-2 rounded border border-border p-2">
              <DateField label={`Period ${i + 1} from`} value={p.from} onChange={(d) => setPhase(i, { from: d })} />
              <DateField label="Until" value={p.to} onChange={(d) => setPhase(i, { to: d })} />
              <SelectField className="col-span-2" label="At the end" value={p.recastAtEnd} options={RECAST_OPTIONS} onChange={(v) => setPhase(i, { recastAtEnd: v as typeof p.recastAtEnd })} />
              <Button type="button" variant="ghost" size="sm" className="col-span-2 justify-self-start" onClick={() => propose({ ...sim, phases: sim.phases.filter((_, j) => j !== i) })}>
                Remove period {i + 1}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { const last = sim.phases.at(-1); const from = last?.to ?? sim.startDate; propose({ ...sim, phases: [...sim.phases, { kind: "interest-only", from, to: addMonths(from, 12), recastAtEnd: "on-rate-change" }] }); }}>
            Add a period
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
