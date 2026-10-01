"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import type { SimulationState } from "../../lib/simulatorModel";
import { RECAST_OPTIONS } from "../../lib/vocabulary";
import { DateField, FeatureSwitch, IntegerField, SelectField } from "../fields";

type Props = {
  sim: SimulationState;
  propose: (next: SimulationState) => void;
};

/** Interest-only is an interest convention phase, edited here rather than among repayment dates. */
export function InterestOnlyControl({ sim, propose }: Props) {
  const [open, setOpen] = useState(false);
  const months = sim.phases[0] ? monthsBetween(sim.phases[0].from, sim.phases[0].to) : 24;
  const toggle = (on: boolean) => {
    const phases = sim.phases.length ? sim.phases : [{ kind: "interest-only" as const, from: sim.startDate, to: addMonths(sim.startDate, 24), recastAtEnd: "on-rate-change" as const }];
    propose({ ...sim, interestOnly: on, phases });
  };

  return (
    <>
      <div className="border-t border-border pt-3">
        <FeatureSwitch label="Interest-only period" description={sim.interestOnly ? `${sim.phases.length || 1} configured period${sim.phases.length === 1 ? "" : "s"}` : "Pay only interest for a defined period"} checked={sim.interestOnly} onChange={toggle} />
        {sim.interestOnly ? (
          <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2 pl-2">
            {sim.phases.length <= 1 ? (
              <IntegerField label="Interest-only for" suffix="months" min={1} value={months} onChange={(value) => value && propose({ ...sim, phases: [{ ...(sim.phases[0] ?? { kind: "interest-only", from: sim.startDate, recastAtEnd: "on-rate-change" }), to: addMonths(sim.phases[0]?.from ?? sim.startDate, value) }] })} />
            ) : <span className="text-xs text-muted-foreground">{sim.phases.length} periods</span>}
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Edit</Button>
          </div>
        ) : null}
      </div>
      <InterestOnlyDialog open={open} onClose={() => setOpen(false)} sim={sim} propose={propose} />
    </>
  );
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm));
}

function InterestOnlyDialog({ open, onClose, sim, propose }: { open: boolean; onClose: () => void; sim: SimulationState; propose: (next: SimulationState) => void }) {
  const setPhase = (index: number, patch: Partial<SimulationState["phases"][number]>) => propose({ ...sim, phases: sim.phases.map((phase, candidate) => (candidate === index ? { ...phase, ...patch } : phase)) });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Interest-only periods</DialogTitle>
          <DialogDescription>During each period only interest is paid. At its end the repayment is recalculated as chosen.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {sim.phases.map((phase, index) => (
            <li key={`${phase.from}:${index}`} className="grid grid-cols-2 gap-2 rounded border border-border p-2">
              <DateField label={`Period ${index + 1} from`} value={phase.from} onChange={(date) => setPhase(index, { from: date })} />
              <DateField label="Until" value={phase.to} onChange={(date) => setPhase(index, { to: date })} />
              <SelectField className="col-span-2" label="At the end" value={phase.recastAtEnd} options={RECAST_OPTIONS} onChange={(value) => setPhase(index, { recastAtEnd: value as typeof phase.recastAtEnd })} />
              <Button type="button" variant="ghost" size="sm" className="col-span-2 justify-self-start" onClick={() => propose({ ...sim, phases: sim.phases.filter((_, candidate) => candidate !== index) })}>
                Remove period {index + 1}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { const last = sim.phases.at(-1); const from = last?.to ?? sim.startDate; propose({ ...sim, phases: [...sim.phases, { kind: "interest-only", from, to: addMonths(from, 12), recastAtEnd: "on-rate-change" }] }); }}>
            Add a period
          </Button>
          <Button type="button" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
