"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import type { SimulationState } from "../../lib/simulatorModel";
import { RECAST_OPTIONS } from "../../lib/vocabulary";
import { DateField, SelectField } from "../fields";
import { formatChartDate } from "../chart/chartMeta";
import { ConfigurationSection } from "./ConfigurationSection";

type Props = {
  sim: SimulationState;
  propose: (next: SimulationState) => void;
};

/** Interest-only is an interest convention phase, edited here rather than among repayment dates. */
export function InterestOnlyControl({ sim, propose }: Props) {
  const [open, setOpen] = useState(false);
  const toggle = (on: boolean) => {
    const phases = sim.phases.length ? sim.phases : [{ kind: "interest-only" as const, from: sim.startDate, to: addMonths(sim.startDate, 24), recastAtEnd: "on-rate-change" as const }];
    propose({ ...sim, interestOnly: on, phases });
  };
  const first = sim.phases[0];
  const last = sim.phases.at(-1);
  const summary = first && last
    ? `${sim.phases.length} ${sim.phases.length === 1 ? "period" : "periods"} · ${formatChartDate(first.from)} – ${formatChartDate(last.to)}`
    : "No periods configured";

  return (
    <>
      <ConfigurationSection
        title="Interest-only periods"
        enabled={sim.interestOnly}
        onEnabledChange={toggle}
        collapsedSummary="Pay only interest during configured periods"
        helpDescription="Optional periods where scheduled repayments follow the existing interest-only rules."
        help={[{ items: [
          { term: "Periods", description: "Each period has an effective start and end date. The section defaults off; enabling it creates a 24-month period only when none already exists." },
          { term: "At the end", description: "Controls whether and when the scheduled repayment is recalculated after that period. Existing calculation-method semantics are unchanged." },
          { term: "Disabled", description: "The periods remain available in the simulator so they can be restored, but they do not affect the projection while this section is off." },
        ] }]}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-muted-foreground">{summary}</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>Edit periods</Button>
        </div>
      </ConfigurationSection>
      <InterestOnlyDialog open={open} onClose={() => setOpen(false)} sim={sim} propose={propose} />
    </>
  );
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
