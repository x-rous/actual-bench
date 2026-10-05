"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { crossesBudgetBoundary } from "@/lib/assets-debt/actual/ledgerPort";
import type { SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { reconcileTrackingComponents, type SaveIssue, type SimulationState, type TrackingComponent, type TrackingState } from "../../lib/simulatorModel";
import { DEBT_TYPE_OPTIONS, DESTINATION_OPTIONS, SIGN_CONVENTION_OPTIONS } from "../../lib/vocabulary";
import { IntegerField, MoneyField, SelectField, TextField } from "../fields";

export { strategyAdvice, type StrategyAdvice } from "../../lib/strategyAdvice";

/**
 * The loan's Settings tab (rev 2, owner-approved mockup 2026-10-05; P1.3b T214/T215, FR-225).
 * Two columns: the loan and its Actual accounts on the left (Advanced collapsed under them), how
 * repayments are recorded on the right, edited in place in one small table. Repayment matching
 * spans the bottom (the `matching` slot). "Who owes the money" is the kind of loan ("Loan I made");
 * the lender's interest pattern is one compact switch with no pre-selected answer (owner decision).
 * The calculation engine is not a choice and is shown on Schedule. Nothing here writes to Actual.
 */

const RECEIVABLE = "loan-receivable";

/** A bordered group with its heading on the border, the same as the Schedule panel's groups. */
function Section({ title, children, className }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <fieldset aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-border px-4 pb-4 pt-2", className)}>
      <legend className="px-1">
        <h2 id={id} className="text-sm font-semibold">{title}</h2>
      </legend>
      {children}
    </fieldset>
  );
}

/** Two answers as one compact segmented control; nothing is pre-selected until the user answers. */
function Choice({ label, value, options, onChange, hint, issue }: { label: string; value: string | null; options: { value: string; label: string }[]; onChange: (v: string) => void; hint?: string; issue?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-xs font-medium text-muted-foreground">{label}</span>
      <div role="group" aria-labelledby={id} className="inline-flex w-fit flex-wrap gap-0.5 rounded-lg border border-border p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("rounded-md px-3 py-1.5 text-xs transition-colors", value === o.value ? "bg-foreground text-background" : "text-foreground hover:bg-muted")}>
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      {issue ? <p className="text-[11px] font-medium text-destructive">{issue}</p> : null}
    </div>
  );
}

const PART: Record<string, string> = { principal: "Principal", interest: "Interest", fee: "Fees" };
const partLabel = (c: TrackingComponent) => PART[c.economicKind] ?? (c.economicKind.charAt(0).toUpperCase() + c.economicKind.slice(1));

export function TrackingSetup({ sim, setSimulation, tracking, setTracking, directory, issues, matching }: { sim: SimulationState; setSimulation?: (sim: SimulationState) => void; tracking: TrackingState; setTracking: (t: TrackingState) => void; directory: AccountDirectory | undefined; issues: SaveIssue[]; /** Repayment matching (saved separately), full width under the two columns. */ matching?: React.ReactNode }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = (patch: Partial<TrackingState>) => setTracking({ ...tracking, ...patch });
  const issue = (field: string) => issues.find((i) => i.field === field)?.message;
  const accounts: SelectOption[] = [{ value: "", label: "Not chosen yet" }, ...(directory?.accounts ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.offBudget ? "off budget" : "on budget"}${a.closed ? ", closed" : ""})`, disabled: a.closed }))];
  const categories: SelectOption[] = [{ value: "", label: "Choose a category" }, ...(directory?.categories ?? []).filter((c) => !c.isIncome && !c.hidden).map((c) => ({ value: c.id, label: c.groupName ? `${c.groupName}: ${c.name}` : c.name }))];
  const liability = directory?.accounts.find((a) => a.id === tracking.liabilityAccountId);
  const payment = directory?.accounts.find((a) => a.id === tracking.paymentAccountId);
  const crosses = !!(liability && payment && crossesBudgetBoundary(liability, payment));
  const draws = sim.shape === "revolving-credit" || sim.assumptions.some((a) => a.kind === "draw");
  const owedToMe = tracking.direction === "owed-to-me";
  const isTermOwed = sim.shape === "term-loan" && !owedToMe;
  const separate = tracking.lenderPattern === "separate-interest";
  const components = reconcileTrackingComponents(sim, tracking);
  const setComponent = (key: string, patch: Partial<TrackingComponent>) => set({ components: components.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const otherDestinations = DESTINATION_OPTIONS.filter((o) => o.value !== "transfer");
  const loanName = liability?.name ?? "the loan account";

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Loan">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField label="Name" value={tracking.name} onChange={(v) => set({ name: v })} issue={issue("name")} placeholder="Home loan" />
              <SelectField
                label="Kind of loan"
                value={owedToMe ? RECEIVABLE : tracking.debtType}
                options={DEBT_TYPE_OPTIONS.map((o) => (o.value === RECEIVABLE ? { ...o, label: "Loan I made (someone owes me)" } : o))}
                onChange={(v) => set(v === RECEIVABLE
                  ? { debtType: v as TrackingState["debtType"], direction: "owed-to-me", lenderPattern: null }
                  : { debtType: v as TrackingState["debtType"], direction: "owed-by-me" })}
              />
            </div>
          </Section>

          <Section title="Accounts in Actual">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField label={owedToMe ? "Receivable account" : "Loan account"} value={tracking.liabilityAccountId ?? ""} options={accounts} onChange={(v) => set({ liabilityAccountId: v || null })} issue={issue("liabilityAccountId")} />
              <SelectField label={owedToMe ? "Repayments arrive in" : "Repayments are paid from"} value={tracking.paymentAccountId ?? ""} options={accounts} onChange={(v) => set({ paymentAccountId: v || null })} issue={issue("paymentAccountId")} />
            </div>
            {sim.offsets.map((o, i) => (
              <div key={o.key} className="flex flex-col gap-2 rounded border border-border p-2">
                <SelectField
                  label={sim.offsets.length > 1 ? `Offset account ${i + 1}` : "Offset account"}
                  value={tracking.offsetAccountMap[o.placeholderAccountId] ?? ""}
                  options={accounts.filter((a) => a.value !== tracking.liabilityAccountId)}
                  onChange={(v) => set({ offsetAccountMap: { ...tracking.offsetAccountMap, [o.placeholderAccountId]: v } })}
                  issue={issue(`offset:${o.key}`)}
                  hint="The account whose balance you simulated as the offset. Required even for a draft."
                />
                <label className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">Track offset balance from Actual</span>
                    <span className="block text-xs text-muted-foreground">Use bounded, read-only historical balances through an explicit observation date. Nothing is written to Actual.</span>
                  </span>
                  <Switch
                    aria-label={`Track ${sim.offsets.length > 1 ? `offset account ${i + 1}` : "offset account"} balance from Actual`}
                    checked={o.useActualBalance}
                    disabled={!setSimulation}
                    onCheckedChange={(checked) => setSimulation?.({ ...sim, offsets: sim.offsets.map((item) => item.key === o.key ? { ...item, useActualBalance: checked } : item) })}
                  />
                </label>
                {issue(`offsets.${i}.useActualBalance`) ? <p className="text-[11px] font-medium text-destructive">{issue(`offsets.${i}.useActualBalance`)}</p> : null}
              </div>
            ))}
          </Section>

          <Section title={
            <Button type="button" variant="ghost" size="sm" className="-ml-2 h-auto gap-1 px-2 py-0 text-sm font-semibold" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((v) => !v)}>
              {advancedOpen ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
              Advanced
            </Button>
          }>
            {advancedOpen ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectField label="Balance sign in Actual" value={tracking.signConvention} options={SIGN_CONVENTION_OPTIONS} onChange={(v) => set({ signConvention: v as TrackingState["signConvention"] })} />
                <MoneyField label="Allowed difference before flagging" hint="Blank uses one minor unit." valueMinor={tracking.driftToleranceMinor} minorDigits={sim.minorDigits} onChange={(v) => set({ driftToleranceMinor: v })} />
                <IntegerField label="Remind me to check a lender statement every" suffix="days" min={1} value={tracking.expectedObservationIntervalDays} onChange={(v) => set({ expectedObservationIntervalDays: v })} hint="Optional. Empty means no reminder." />
                {separate ? <IntegerField label="Wait for the lender's interest row up to" suffix="days" value={tracking.lenderChargeGraceDays} onChange={(v) => set({ lenderChargeGraceDays: v ?? 0 })} /> : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Balance sign, the allowed difference before flagging, statement reminders{separate ? ", and how long to wait for the lender's interest row" : ""}.</p>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title="How repayments are recorded">
            {isTermOwed ? (
              <Choice
                label="Your lender statement shows interest"
                value={tracking.lenderPattern}
                issue={issue("lenderPattern")}
                options={[{ value: "embedded-interest", label: "Inside each repayment" }, { value: "separate-interest", label: "As its own transaction" }]}
                onChange={(v) => set({ lenderPattern: v as TrackingState["lenderPattern"] })}
                hint={tracking.lenderPattern === null
                  ? "Check a recent lender statement. This decides how Bench records interest in Actual."
                  : separate
                    ? "Interest is charged on its own date and repayments are separate. Bench records or links the interest row."
                    : "One repayment on the statement, split into principal and interest. Bench splits each repayment in Actual."}
              />
            ) : null}
            <div className="overflow-x-auto">
              <table aria-label="How each part of a repayment is recorded" className="w-full min-w-[520px] text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pr-2 font-normal">Part</th>
                    <th scope="col" className="px-2 py-1.5 font-normal">Goes to</th>
                    <th scope="col" className="px-2 py-1.5 font-normal">Category</th>
                    <th scope="col" className="py-1.5 pl-2 font-normal">Note on the line</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => {
                    const principal = c.economicKind === "principal";
                    return (
                      <tr key={c.key} className="border-t border-border/60 align-middle">
                        <th scope="row" className="py-2 pr-2 text-left font-medium">{principal && separate ? "Repayment" : partLabel(c)}</th>
                        <td className="px-2 py-2">
                          {principal
                            ? <span>Transfer to {loanName}</span>
                            : <SelectField hideLabel label={`${partLabel(c)} goes to`} value={c.destination} options={otherDestinations} onChange={(v) => setComponent(c.key, { destination: v as TrackingComponent["destination"] })} />}
                        </td>
                        <td className="px-2 py-2">
                          {principal
                            ? crosses
                              ? <SelectField hideLabel label="Loan payment category" value={tracking.loanPaymentCategoryId ?? ""} options={categories} onChange={(v) => set({ loanPaymentCategoryId: v || null })} issue={issue("loanPaymentCategoryId")} />
                              : <span className="text-muted-foreground">Not needed</span>
                            : <SelectField hideLabel label={`${partLabel(c)} category`} value={c.categoryId ?? ""} options={categories} onChange={(v) => setComponent(c.key, { categoryId: v || null })} />}
                        </td>
                        <td className="py-2 pl-2"><TextField hideLabel label={`${partLabel(c)} note on the line`} value={c.label} onChange={(v) => setComponent(c.key, { label: v })} /></td>
                      </tr>
                    );
                  })}
                  {crosses && draws ? (
                    <tr className="border-t border-border/60 align-middle">
                      <th scope="row" className="py-2 pr-2 text-left font-medium">Draws</th>
                      <td className="px-2 py-2">From {loanName}</td>
                      <td className="px-2 py-2"><SelectField hideLabel label="Draw category" value={tracking.drawCategoryId ?? ""} options={categories} onChange={(v) => set({ drawCategoryId: v || null })} issue={issue("drawCategoryId")} /></td>
                      <td className="py-2 pl-2" />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {crosses
                ? `The loan payment category is used whenever a repayment, or its principal part, leaves your budget for ${loanName}: as a whole transfer, a split, or a link to the lender's row.`
                : "Both accounts are on the same side of the budget, so the transfer to the loan needs no category."}
            </p>
          </Section>
        </div>
      </div>
      {matching ? <div className="rounded-lg border border-border p-4">{matching}</div> : null}
    </div>
  );
}
