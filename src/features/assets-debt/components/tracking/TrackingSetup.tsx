"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { crossesBudgetBoundary } from "@/lib/assets-debt/actual/ledgerPort";
import { evaluateStrategyEligibility } from "@/lib/financial-models/loan/eligibility";
import type { SelectOption } from "@/components/ui/select";
import { reconcileTrackingComponents, simulationToModel, type SaveIssue, type SimulationState, type TrackingComponent, type TrackingState } from "../../lib/simulatorModel";
import { DEBT_TYPE_OPTIONS, DESTINATION_OPTIONS, SIGN_CONVENTION_OPTIONS } from "../../lib/vocabulary";
import { IntegerField, MoneyField, SelectField, TextField } from "../fields";

/**
 * Tracking setup (P1.3b T214, T215; FR-225). The Actual side of a loan, asked
 * for only after the user chooses to set up tracking. Nothing here changes the
 * calculation or repeats a calculation setting. The lender's interest pattern
 * is an explicit question with no pre-selected answer. Nothing here writes to
 * Actual: accounts and categories come from the directory read through the
 * ledger port.
 */

export type StrategyAdvice = { recommended: "bench-periodic" | "bench-daily" | null; lines: { strategy: string; label: string; available: boolean; reasons: string[] }[] };

const CAPABILITY_REASON = /^The connected Actual (does not support|cannot read)/;

/** The Bench strategy the loan's calculation fits; the formula-rule strategy waits for P1.7's capability check. */
export function strategyAdvice(sim: SimulationState): StrategyAdvice {
  const built = simulationToModel(sim);
  if (!built.ok) return { recommended: null, lines: [] };
  const e = evaluateStrategyEligibility(built.model, { formulaRules: false, splitActions: false, transferPayees: false, ruleReadback: false });
  const label = { "actual-formula-rule": "An Actual formula rule", "bench-periodic": "Actual Bench, period by period", "bench-daily": "Actual Bench, day by day" } as const;
  const lines = e.options.map((o) => ({
    strategy: o.strategy,
    label: label[o.strategy],
    available: o.strategy !== "actual-formula-rule" && o.eligible,
    reasons: o.strategy === "actual-formula-rule" ? [...o.reasons.filter((r) => !CAPABILITY_REASON.test(r)), "Available once Actual Bench has checked what the connected Actual supports (a later step)."] : o.reasons,
  }));
  const recommended = (lines.find((l) => l.available)?.strategy ?? null) as StrategyAdvice["recommended"];
  return { recommended, lines };
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 border-b border-border py-4">
      <div>
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function RadioQuestion({ legend, name, value, options, onChange, issue }: { legend: string; name: string; value: string | null; options: { value: string; label: string; example: string }[]; onChange: (v: string) => void; issue?: string }) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={issue ? `${id}-issue` : undefined}>
      <legend className="text-sm font-medium">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex items-start gap-2 rounded border border-border p-2 text-sm">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1" />
          <span>
            <span className="font-medium">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.example}</span>
          </span>
        </label>
      ))}
      {issue ? (
        <p id={`${id}-issue`} className="text-[11px] font-medium text-destructive">
          {issue}
        </p>
      ) : null}
    </fieldset>
  );
}

export function TrackingSetup({ sim, tracking, setTracking, directory, issues }: { sim: SimulationState; tracking: TrackingState; setTracking: (t: TrackingState) => void; directory: AccountDirectory | undefined; issues: SaveIssue[] }) {
  const [componentsOpen, setComponentsOpen] = useState(false);
  const set = (patch: Partial<TrackingState>) => setTracking({ ...tracking, ...patch });
  const issue = (field: string) => issues.find((i) => i.field === field)?.message;
  const accounts: SelectOption[] = [{ value: "", label: "Not chosen yet" }, ...(directory?.accounts ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.offBudget ? "off budget" : "on budget"}${a.closed ? ", closed" : ""})`, disabled: a.closed }))];
  const categories: SelectOption[] = [{ value: "", label: "None" }, ...(directory?.categories ?? []).filter((c) => !c.isIncome && !c.hidden).map((c) => ({ value: c.id, label: c.groupName ? `${c.groupName}: ${c.name}` : c.name }))];
  const liability = directory?.accounts.find((a) => a.id === tracking.liabilityAccountId);
  const payment = directory?.accounts.find((a) => a.id === tracking.paymentAccountId);
  const crosses = !!(liability && payment && crossesBudgetBoundary(liability, payment));
  const draws = sim.shape === "revolving-credit" || sim.assumptions.some((a) => a.kind === "draw");
  const advice = strategyAdvice(sim);
  const isTermOwed = sim.shape === "term-loan" && tracking.direction === "owed-by-me";
  const components = reconcileTrackingComponents(sim, tracking);

  return (
    <div className="flex flex-col px-4">
      <Group title="The loan">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField label="Name" value={tracking.name} onChange={(v) => set({ name: v })} issue={issue("name")} placeholder="Home loan" />
          <SelectField label="Kind of loan" value={tracking.debtType} options={DEBT_TYPE_OPTIONS} onChange={(v) => set({ debtType: v as TrackingState["debtType"] })} />
        </div>
        {sim.shape === "term-loan" ? (
          <RadioQuestion
            legend="Who owes the money?"
            name="direction"
            value={tracking.direction}
            options={[
              { value: "owed-by-me", label: "I owe it", example: "A mortgage, car loan or personal loan." },
              { value: "owed-to-me", label: "Someone owes it to me", example: "A loan I made to someone else." },
            ]}
            onChange={(v) => set({ direction: v as TrackingState["direction"], lenderPattern: v === "owed-to-me" ? null : tracking.lenderPattern })}
          />
        ) : null}
      </Group>

      {isTermOwed ? (
        <Group title="How does your lender record interest?" description="This decides how interest will be recorded in Actual later. Check a recent lender statement if you are not sure.">
          <RadioQuestion
            legend="Interest on your lender statement"
            name="lenderPattern"
            value={tracking.lenderPattern}
            issue={issue("lenderPattern")}
            options={[
              { value: "embedded-interest", label: "Interest is part of each repayment", example: "The statement shows one repayment, split into principal and interest." },
              { value: "separate-interest", label: "Interest appears as a separate lender transaction", example: "The statement shows interest charged on its own date, and repayments separately." },
            ]}
            onChange={(v) => set({ lenderPattern: v as TrackingState["lenderPattern"] })}
          />
        </Group>
      ) : null}

      <Group title="Actual accounts" description="Accounts in the connected budget. Choosing them changes nothing in Actual.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SelectField label={tracking.direction === "owed-to-me" ? "Receivable account" : "Loan account"} value={tracking.liabilityAccountId ?? ""} options={accounts} onChange={(v) => set({ liabilityAccountId: v || null })} issue={issue("liabilityAccountId")} />
          <SelectField label="Repayments come from" value={tracking.paymentAccountId ?? ""} options={accounts} onChange={(v) => set({ paymentAccountId: v || null })} issue={issue("paymentAccountId")} />
          <SelectField label="Balance sign in Actual" value={tracking.signConvention} options={SIGN_CONVENTION_OPTIONS} onChange={(v) => set({ signConvention: v as TrackingState["signConvention"] })} />
        </div>
        {sim.offsets.map((o, i) => (
          <SelectField
            key={o.key}
            label={sim.offsets.length > 1 ? `Offset account ${i + 1}` : "Offset account"}
            value={tracking.offsetAccountMap[o.placeholderAccountId] ?? ""}
            options={accounts.filter((a) => a.value !== tracking.liabilityAccountId)}
            onChange={(v) => set({ offsetAccountMap: { ...tracking.offsetAccountMap, [o.placeholderAccountId]: v } })}
            issue={issue(`offset:${o.key}`)}
            hint="The account whose balance you simulated as the offset. Required even for a draft."
          />
        ))}
      </Group>

      <Group title="How repayments are recorded" description="Where each part of a repayment goes in Actual. The economic kind is Actual Bench's; the category is Actual's.">
        <ul className="text-xs">
          {components.map((c) => (
            <li key={c.key}>
              {c.label}: {DESTINATION_OPTIONS.find((d) => d.value === c.destination)?.label ?? c.destination}
              {c.categoryId ? ` (${categories.find((x) => x.value === c.categoryId)?.label ?? "category"})` : ""}
            </li>
          ))}
        </ul>
        <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setComponentsOpen(true)}>
          Edit how repayments are recorded
        </Button>
        {crosses ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField label="Loan payment category" value={tracking.loanPaymentCategoryId ?? ""} options={categories} onChange={(v) => set({ loanPaymentCategoryId: v || null })} issue={issue("loanPaymentCategoryId")} hint="Repayments cross the budget boundary, so the on-budget side needs an existing category." />
            {draws ? <SelectField label="Draw category" value={tracking.drawCategoryId ?? ""} options={categories} onChange={(v) => set({ drawCategoryId: v || null })} issue={issue("drawCategoryId")} /> : null}
          </div>
        ) : null}
      </Group>

      <Group title="Calculation engine" description="Which engine will reproduce this loan. The simulator's calculation method decides this.">
        <ul className="flex flex-col gap-1 text-xs">
          {advice.lines.map((l) => (
            <li key={l.strategy}>
              <span className="font-medium">{l.label}</span>: {l.available ? (advice.recommended === l.strategy ? "fits (recommended)" : "fits") : "not available"}
              {l.reasons.length ? <span className="block text-muted-foreground">{l.reasons.join(" ")}</span> : null}
            </li>
          ))}
        </ul>
        {issue("executionStrategy") ? <p className="text-[11px] font-medium text-destructive">{issue("executionStrategy")}</p> : null}
      </Group>

      <Group title="Monitoring">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MoneyField label="Drift tolerance" hint="Blank uses one minor amount unit." valueMinor={tracking.driftToleranceMinor} minorDigits={sim.minorDigits} onChange={(v) => set({ driftToleranceMinor: v })} />
          <IntegerField label="Lender charge grace" suffix="days" value={tracking.lenderChargeGraceDays} onChange={(v) => set({ lenderChargeGraceDays: v ?? 0 })} />
          <IntegerField label="Expected statement every" suffix="days" min={1} value={tracking.expectedObservationIntervalDays} onChange={(v) => set({ expectedObservationIntervalDays: v })} hint="Optional." />
        </div>
      </Group>

      <ComponentsDialog open={componentsOpen} onClose={() => setComponentsOpen(false)} components={components} categories={categories} onChange={(next) => set({ components: next })} />
    </div>
  );
}

function ComponentsDialog({ open, onClose, components, categories, onChange }: { open: boolean; onClose: () => void; components: TrackingComponent[]; categories: SelectOption[]; onChange: (next: TrackingComponent[]) => void }) {
  const set = (key: string, patch: Partial<TrackingComponent>) => onChange(components.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>How repayments are recorded</DialogTitle>
          <DialogDescription>Labels can appear on the split lines Actual Bench records later. Only existing categories can be chosen.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {components.map((c) => (
            <li key={c.key} className="grid grid-cols-1 gap-2 rounded border border-border p-2 md:grid-cols-3">
              <TextField label={`${c.economicKind} label`} value={c.label} onChange={(v) => set(c.key, { label: v })} />
              <SelectField label="Goes to" value={c.destination} options={DESTINATION_OPTIONS} onChange={(v) => set(c.key, { destination: v as TrackingComponent["destination"] })} />
              <SelectField label="Category" value={c.categoryId ?? ""} options={categories} onChange={(v) => set(c.key, { categoryId: v || null })} />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
