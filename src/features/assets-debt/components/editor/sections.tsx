"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { SelectOption } from "@/components/ui/select";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { crossesBudgetBoundary } from "@/lib/assets-debt/actual/ledgerPort";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";
import { applyPreset, emptyRate, newKey, sectionOf, type EditorIssue, type EditorState } from "../../lib/editorModel";
import {
  ACCRUAL_OPTIONS,
  AMORTIZATION_OPTIONS,
  AMOUNT_RULE_OPTIONS,
  BALANCE_PRECISION_OPTIONS,
  BEHAVIOR_OPTIONS,
  CAPITALIZATION_OPTIONS,
  CHARGE_FREQUENCY_OPTIONS,
  DAY_COUNT_OPTIONS,
  DEBT_TYPE_OPTIONS,
  DESTINATION_OPTIONS,
  ECONOMIC_KIND_OPTIONS,
  EVENT_TIMING_OPTIONS,
  FEE_TREATMENT_OPTIONS,
  FINAL_PAYMENT_OPTIONS,
  LENDER_PATTERN_OPTIONS,
  OFFSET_BASIS_OPTIONS,
  PER_RATE_RECAST_OPTIONS,
  PROFILE_PRESETS,
  RATE_QUOTE_OPTIONS,
  RECAST_OPTIONS,
  REPAYMENT_DERIVATION_OPTIONS,
  REPAYMENT_FREQUENCY_OPTIONS,
  REVOLVING_MODEL_OPTIONS,
  ROUNDING_OPTIONS,
  SIGN_CONVENTION_OPTIONS,
  STRATEGY_OPTIONS,
} from "../../lib/vocabulary";
import { DateField, issueFor, Section, SelectField, TextField } from "./fields";

/**
 * The loan editor's sections (RD-084 P1.3; FR-035, FR-050, FR-011a, FR-055,
 * FR-065, FR-094a). Each edits one slice of the editor state; none of them
 * reads or writes Actual. Accounts and categories come from the directory the
 * page read through the ledger port, and only existing categories can be
 * chosen: there is no way to create one here.
 */

export type SectionProps = {
  state: EditorState;
  update: (change: (s: EditorState) => EditorState) => void;
  issues: EditorIssue[];
  directory: AccountDirectory | undefined;
};

const inSection = (issues: EditorIssue[], section: ReturnType<typeof sectionOf>) => issues.filter((i) => sectionOf(i.field) === section);

/**
 * The issues a section lists at its top: everything except those shown next to
 * a field. A row issue is shown in place only when that row is on screen, so
 * an issue about a row the editor does not show is never lost.
 */
function listed(issues: EditorIssue[], prefix: string, rows: number, inlineFields: string[] = []): EditorIssue[] {
  const rowPattern = new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.(\\d+)\\.`);
  return issues.filter((i) => {
    if (inlineFields.includes(i.field)) return false;
    const m = rowPattern.exec(i.field);
    return !(m && Number(m[1]) < rows);
  });
}

function accountOptions(directory: AccountDirectory | undefined, filter: (a: AccountDirectory["accounts"][number]) => boolean = () => true): SelectOption[] {
  return [
    { value: "", label: "None" },
    ...(directory?.accounts ?? []).filter(filter).map((a) => ({ value: a.id, label: `${a.name} (${a.offBudget ? "off budget" : "on budget"}${a.closed ? ", closed" : ""})`, disabled: a.closed })),
  ];
}

function categoryOptions(directory: AccountDirectory | undefined): SelectOption[] {
  return [{ value: "", label: "None" }, ...(directory?.categories ?? []).filter((c) => !c.isIncome && !c.hidden).map((c) => ({ value: c.id, label: c.groupName ? `${c.groupName}: ${c.name}` : c.name }))];
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} aria-label={label} className="self-end">
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </Button>
  );
}

export function BasicsSection({ state, update, issues, directory }: SectionProps) {
  const own = inSection(issues, "basics");
  const set = <K extends keyof EditorState>(key: K) => (value: EditorState[K]) => update((s) => ({ ...s, [key]: value }));
  return (
    <Section title="Basics" description="What the debt is and which Actual accounts hold it." issues={listed(own, "basics", 0, ["name", "currency", "liabilityAccountId", "paymentAccountId", "lenderPattern", "lenderChargeGraceDays", "driftToleranceMinor"])}>
      <TextField label="Name" value={state.name} onChange={set("name")} issue={issueFor(own, "name")} />
      <SelectField label="Type" value={state.debtType} onChange={(v) => set("debtType")(v as EditorState["debtType"])} options={DEBT_TYPE_OPTIONS} />
      <SelectField
        label="Behaves as"
        value={state.behaviorClass}
        onChange={(v) => update((s) => ({ ...s, behaviorClass: v as EditorState["behaviorClass"], lenderPattern: v === "term-loan" ? s.lenderPattern || "separate-interest" : "" }))}
        options={BEHAVIOR_OPTIONS}
        hint="This drives the calculation and accounting, not only the label."
      />
      <TextField label="Currency" value={state.currency} onChange={(v) => set("currency")(v.toUpperCase())} issue={issueFor(own, "currency")} hint="Three-letter code, such as USD or AUD." />
      <SelectField
        label="Decimal places"
        value={String(state.currencyMinorDigits)}
        onChange={(v) => set("currencyMinorDigits")(Number(v))}
        options={[0, 1, 2, 3, 4].map((d) => ({ value: String(d), label: d === 0 ? "0 (for example JPY)" : String(d) }))}
      />
      <SelectField label="Liability account" value={state.liabilityAccountId} onChange={set("liabilityAccountId")} options={accountOptions(directory)} issue={issueFor(own, "liabilityAccountId")} hint="The Actual account that holds the debt." />
      <SelectField label="Payment account" value={state.paymentAccountId} onChange={set("paymentAccountId")} options={accountOptions(directory)} issue={issueFor(own, "paymentAccountId")} hint="Where repayments come from." />
      <SelectField label="Balance sign in Actual" value={state.signConvention} onChange={(v) => set("signConvention")(v as EditorState["signConvention"])} options={SIGN_CONVENTION_OPTIONS} />
      {state.behaviorClass === "term-loan" ? (
        <SelectField label="How the lender records interest" value={state.lenderPattern} onChange={set("lenderPattern")} options={LENDER_PATTERN_OPTIONS} issue={issueFor(own, "lenderPattern")} />
      ) : null}
      <SelectField label="Calculated by" value={state.executionStrategy} onChange={(v) => set("executionStrategy")(v as EditorState["executionStrategy"])} options={STRATEGY_OPTIONS} hint="See the calculation basis panel for which strategies fit this loan." />
      <TextField label="Lender charge grace (days)" value={state.lenderChargeGraceDays} onChange={set("lenderChargeGraceDays")} inputMode="numeric" issue={issueFor(own, "lenderChargeGraceDays")} />
      <TextField label="Drift tolerance" value={state.driftTolerance} onChange={set("driftTolerance")} inputMode="decimal" issue={issueFor(own, "driftToleranceMinor")} hint="Blank uses one unit of the currency." />
      <SelectField
        label="Status"
        value={state.status}
        onChange={(v) => set("status")(v as EditorState["status"])}
        options={[
          { value: "draft", label: "Draft (incomplete is fine)" },
          { value: "active", label: "Active" },
        ]}
      />
    </Section>
  );
}

export function ContractTermsSection({ state, update, issues }: SectionProps) {
  const own = inSection(issues, "terms");
  const set = (key: keyof EditorState["terms"]) => (value: string) => update((s) => ({ ...s, terms: { ...s.terms, [key]: value } }));
  const f = (k: string) => issueFor(own, `config.terms.${k}`);
  return (
    <Section title="Contract terms" description="Contract term and amortization term are separate; a shorter contract ends in a balloon." issues={own.filter((i) => !i.field.startsWith("config.terms."))}>
      <DateField label="Opening date" value={state.terms.openingDate} onChange={set("openingDate")} issue={f("openingDate")} />
      <TextField label="Opening principal" value={state.terms.openingPrincipal} onChange={set("openingPrincipal")} inputMode="decimal" issue={f("openingPrincipalMinor")} />
      <DateField label="First payment date" value={state.terms.firstPaymentDate} onChange={set("firstPaymentDate")} issue={f("firstPaymentDate")} />
      <TextField label="Contract term (months)" value={state.terms.contractualTermMonths} onChange={set("contractualTermMonths")} inputMode="numeric" issue={f("contractualTermMonths")} />
      <TextField label="Amortization term (months)" value={state.terms.amortizationTermMonths} onChange={set("amortizationTermMonths")} inputMode="numeric" issue={f("amortizationTermMonths")} />
      <DateField label="Maturity date" value={state.terms.maturityDate} onChange={set("maturityDate")} issue={f("maturityDate")} />
      <TextField label="Contractual payment" value={state.terms.contractualPayment} onChange={set("contractualPayment")} inputMode="decimal" issue={f("contractualPaymentMinor")} hint="Leave blank to derive it from the terms." />
      <TextField label="Credit limit" value={state.terms.creditLimit} onChange={set("creditLimit")} inputMode="decimal" issue={f("creditLimitMinor")} />
      <DateField label="First interest charge date" value={state.terms.firstInterestChargeDate} onChange={set("firstInterestChargeDate")} issue={f("firstInterestChargeDate")} />
    </Section>
  );
}

export function ProfileSection({ state, update, issues }: SectionProps) {
  const own = inSection(issues, "profile");
  // Editing a field after a preset keeps every value but no longer claims the preset.
  const setProfile = (patch: Partial<CalculationProfile>) => update((s) => ({ ...s, profile: { ...s.profile, ...patch, presetId: null } }));
  const p = state.profile;
  const preset = PROFILE_PRESETS.find((x) => x.id === p.presetId);
  return (
    <Section title="Interest and calculation" description="How the lender calculates interest. Presets fill these fields; every field stays editable." issues={listed(own, "rates", state.rates.length)}>
      <div className="flex flex-col gap-1 md:col-span-2 xl:col-span-3">
        <SelectField
          label="Start from a preset"
          value={p.presetId ?? ""}
          onChange={(id) => update((s) => ({ ...s, profile: applyPreset(s.profile, id) }))}
          options={[{ value: "", label: "No preset" }, ...PROFILE_PRESETS.map((x) => ({ value: x.id, label: x.label }))]}
          hint={preset ? `${preset.description} A preset describes a calculation shape, not any particular lender.` : "A preset describes a calculation shape, not any particular lender."}
        />
      </div>
      <SelectField label="Amortization" value={p.amortization} onChange={(v) => setProfile({ amortization: v as CalculationProfile["amortization"] })} options={AMORTIZATION_OPTIONS} />
      <SelectField label="Rate quoted as" value={p.rateQuote} onChange={(v) => setProfile({ rateQuote: v as CalculationProfile["rateQuote"] })} options={RATE_QUOTE_OPTIONS} />
      <SelectField label="Day count" value={p.dayCount} onChange={(v) => setProfile({ dayCount: v as CalculationProfile["dayCount"] })} options={DAY_COUNT_OPTIONS} hint="Used when interest accrues daily." />
      <SelectField label="Interest accrues" value={p.accrual} onChange={(v) => setProfile({ accrual: v as CalculationProfile["accrual"], ...(v === "daily-compounded" ? { capitalization: "daily" } : { capitalization: "at-charge" }) })} options={ACCRUAL_OPTIONS} />
      <SelectField label="Interest is charged" value={p.chargeFrequency} onChange={(v) => setProfile({ chargeFrequency: v as CalculationProfile["chargeFrequency"], chargeDay: v === "at-repayment" ? null : (p.chargeDay ?? 1) })} options={CHARGE_FREQUENCY_OPTIONS} />
      {p.chargeFrequency !== "at-repayment" ? (
        <TextField label="Charge day of the month" value={p.chargeDay === null ? "" : String(p.chargeDay)} onChange={(v) => setProfile({ chargeDay: /^\d+$/.test(v) ? Number(v) : null })} inputMode="numeric" />
      ) : null}
      <SelectField label="Interest capitalizes" value={p.capitalization} onChange={(v) => setProfile({ capitalization: v as CalculationProfile["capitalization"] })} options={CAPITALIZATION_OPTIONS} />
      <SelectField label="Payment rounding" value={p.rounding.paymentRounding} onChange={(v) => setProfile({ rounding: { ...p.rounding, paymentRounding: v as CalculationProfile["rounding"]["paymentRounding"] } })} options={ROUNDING_OPTIONS} />
      <SelectField label="Interest rounding" value={p.rounding.interestPostingRounding} onChange={(v) => setProfile({ rounding: { ...p.rounding, interestPostingRounding: v as CalculationProfile["rounding"]["interestPostingRounding"] } })} options={ROUNDING_OPTIONS} />
      <SelectField label="Balance precision" value={p.rounding.balancePrecision} onChange={(v) => setProfile({ rounding: { ...p.rounding, balancePrecision: v as CalculationProfile["rounding"]["balancePrecision"] } })} options={BALANCE_PRECISION_OPTIONS} />
      <SelectField
        label="Same-day events"
        value={"timing" in p.eventOrder ? p.eventOrder.timing : "start-of-day"}
        onChange={(v) => setProfile({ eventOrder: { timing: v as "start-of-day" | "end-of-day" } })}
        options={EVENT_TIMING_OPTIONS}
        hint="Whether a payment made on a day counts before or after that day's interest."
      />
      <SelectField label="Final payment" value={p.finalPayment} onChange={(v) => setProfile({ finalPayment: v as CalculationProfile["finalPayment"] })} options={FINAL_PAYMENT_OPTIONS} />
      <div className="flex items-center gap-2">
        <Checkbox id="neg-am" checked={p.negativeAmortizationAllowed} onCheckedChange={(v) => setProfile({ negativeAmortizationAllowed: v === true })} />
        <Label htmlFor="neg-am">The contract allows negative amortization</Label>
      </div>
      <RatesEditor state={state} update={update} issues={own} />
    </Section>
  );
}

function RatesEditor({ state, update, issues }: Pick<SectionProps, "state" | "update" | "issues">) {
  const setRate = (key: string, patch: Partial<EditorState["rates"][number]>) => update((s) => ({ ...s, rates: s.rates.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  return (
    <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-3">
      <h3 className="text-xs font-semibold">Rates</h3>
      <p className="text-[11px] text-muted-foreground">Each rate starts accruing on its date. A payment change can take effect later, and a payment cap limits the payment, never the rate. Negative rates are not supported.</p>
      {state.rates.map((r, i) => (
        <fieldset key={r.key} className="grid grid-cols-1 gap-2 rounded border border-border p-2 md:grid-cols-3">
          <legend className="px-1 text-[11px] text-muted-foreground">Rate {i + 1}</legend>
          <DateField label="Accrues from" value={r.accrualEffectiveFrom} onChange={(v) => setRate(r.key, { accrualEffectiveFrom: v })} issue={issueFor(issues, `rates.${i}.accrualEffectiveFrom`)} />
          <TextField label="Annual rate (%)" value={r.ratePercent} onChange={(v) => setRate(r.key, { ratePercent: v })} inputMode="decimal" issue={issueFor(issues, `rates.${i}.annualRateDecimal`)} />
          <SelectField label="Payment on this change" value={r.paymentRecalcPolicy} onChange={(v) => setRate(r.key, { paymentRecalcPolicy: v })} options={PER_RATE_RECAST_OPTIONS} issue={issueFor(issues, `rates.${i}.paymentRecalcPolicy`)} />
          <DateField label="Payment changes from" value={r.paymentEffectiveFrom} onChange={(v) => setRate(r.key, { paymentEffectiveFrom: v })} issue={issueFor(issues, `rates.${i}.paymentEffectiveFrom`)} hint="Blank: the accrual date." />
          <SelectField
            label="Payment cap"
            value={r.capKind}
            onChange={(v) => setRate(r.key, { capKind: v as EditorState["rates"][number]["capKind"] })}
            options={[
              { value: "", label: "No cap" },
              { value: "absolute", label: "At most an amount" },
              { value: "previous-payment-factor", label: "At most the previous payment × a factor" },
            ]}
            issue={issueFor(issues, `rates.${i}.paymentCap`)}
          />
          {r.capKind === "absolute" ? <TextField label="Cap amount" value={r.capAmount} onChange={(v) => setRate(r.key, { capAmount: v })} inputMode="decimal" issue={issueFor(issues, `rates.${i}.paymentCap.amountMinor`)} /> : null}
          {r.capKind === "previous-payment-factor" ? <TextField label="Cap factor" value={r.capFactor} onChange={(v) => setRate(r.key, { capFactor: v })} inputMode="decimal" hint="For example 1.075 for at most a 7.5% increase." issue={issueFor(issues, `rates.${i}.paymentCap.factor`)} /> : null}
          <TextField label="Rate cap (%)" value={r.rateCapPercent} onChange={(v) => setRate(r.key, { rateCapPercent: v })} inputMode="decimal" issue={issueFor(issues, `rates.${i}.rateCapDecimal`)} />
          <TextField label="Rate floor (%)" value={r.rateFloorPercent} onChange={(v) => setRate(r.key, { rateFloorPercent: v })} inputMode="decimal" issue={issueFor(issues, `rates.${i}.rateFloorDecimal`)} />
          <TextField label="Source" value={r.source} onChange={(v) => setRate(r.key, { source: v })} hint="For example: loan contract, rate-change letter." />
          <RemoveButton label={`Remove rate ${i + 1}`} onClick={() => update((s) => ({ ...s, rates: s.rates.filter((x) => x.key !== r.key) }))} />
        </fieldset>
      ))}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update((s) => ({ ...s, rates: [...s.rates, emptyRate()] }))}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add a rate
      </Button>
    </div>
  );
}

export function RepaymentsSection({ state, update, issues }: SectionProps) {
  const own = inSection(issues, "repayments");
  const p = state.profile;
  const setProfile = (patch: Partial<CalculationProfile>) => update((s) => ({ ...s, profile: { ...s.profile, ...patch, presetId: null } }));
  return (
    <Section title="Repayments" description="The repayment schedule, how its amount is set, and interest-only phases." issues={own}>
      <SelectField label="Repayment frequency" value={p.repaymentFrequency} onChange={(v) => setProfile({ repaymentFrequency: v as CalculationProfile["repaymentFrequency"] })} options={REPAYMENT_FREQUENCY_OPTIONS} />
      <SelectField label="Repayment amount" value={p.repaymentDerivation} onChange={(v) => setProfile({ repaymentDerivation: v as CalculationProfile["repaymentDerivation"] })} options={REPAYMENT_DERIVATION_OPTIONS} />
      <SelectField label="Recalculate the payment" value={p.recast} onChange={(v) => setProfile({ recast: v as CalculationProfile["recast"] })} options={RECAST_OPTIONS} />
      {state.behaviorClass === "revolving-credit" ? (
        <SelectField
          label="Minimum payment"
          value={state.revolving?.paymentModel ?? ""}
          onChange={(v) => update((s) => ({ ...s, revolving: v ? { paymentModel: v as NonNullable<EditorState["revolving"]>["paymentModel"], percentOfBalanceBps: null, minimumFloorMinor: null } : null }))}
          options={REVOLVING_MODEL_OPTIONS}
        />
      ) : null}
      <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-3">
        <h3 className="text-xs font-semibold">Interest-only periods</h3>
        {state.phases.map((ph, i) => (
          <fieldset key={ph.key} className="grid grid-cols-1 gap-2 rounded border border-border p-2 md:grid-cols-4">
            <legend className="px-1 text-[11px] text-muted-foreground">Interest-only period {i + 1}</legend>
            <DateField label="From" value={ph.from} onChange={(v) => update((s) => ({ ...s, phases: s.phases.map((x) => (x.key === ph.key ? { ...x, from: v } : x)) }))} />
            <DateField label="To" value={ph.to} onChange={(v) => update((s) => ({ ...s, phases: s.phases.map((x) => (x.key === ph.key ? { ...x, to: v } : x)) }))} />
            <SelectField label="At the end" value={ph.recastAtEnd} onChange={(v) => update((s) => ({ ...s, phases: s.phases.map((x) => (x.key === ph.key ? { ...x, recastAtEnd: v } : x)) }))} options={RECAST_OPTIONS} />
            <RemoveButton label={`Remove interest-only period ${i + 1}`} onClick={() => update((s) => ({ ...s, phases: s.phases.filter((x) => x.key !== ph.key) }))} />
          </fieldset>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update((s) => ({ ...s, phases: [...s.phases, { key: newKey(), from: "", to: "", recastAtEnd: "on-rate-change" }] }))}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add an interest-only period
        </Button>
      </div>
      <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-3">
        <h3 className="text-xs font-semibold">Contract recast dates</h3>
        <p className="text-[11px] text-muted-foreground">Dates on which the contract recalculates the payment, whatever the rate does. Needed when payments recalculate on contract dates.</p>
        {state.paymentRecasts.map((r, i) => (
          <div key={r.key} className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <DateField label={`Recast date ${i + 1}`} value={r.date} onChange={(v) => update((s) => ({ ...s, paymentRecasts: s.paymentRecasts.map((x) => (x.key === r.key ? { ...x, date: v } : x)) }))} />
            <TextField label="Note" value={r.note} onChange={(v) => update((s) => ({ ...s, paymentRecasts: s.paymentRecasts.map((x) => (x.key === r.key ? { ...x, note: v } : x)) }))} />
            <RemoveButton label={`Remove recast date ${i + 1}`} onClick={() => update((s) => ({ ...s, paymentRecasts: s.paymentRecasts.filter((x) => x.key !== r.key) }))} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update((s) => ({ ...s, paymentRecasts: [...s.paymentRecasts, { key: newKey(), date: "", note: "" }] }))}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add a recast date
        </Button>
      </div>
    </Section>
  );
}

export function ComponentsSection({ state, update, issues, directory }: SectionProps) {
  const own = inSection(issues, "components");
  const setRow = (key: string, patch: Partial<EditorState["components"][number]>) => update((s) => ({ ...s, components: s.components.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  return (
    <Section title="Payment components" description="What each repayment pays for. The economic kind is Bench's; the category is Actual's, applied only where the account's budget status allows one." issues={listed(own, "config.components", state.components.length)}>
      {state.components.map((c, i) => (
        <fieldset key={c.key} className="grid grid-cols-1 gap-2 rounded border border-border p-2 md:col-span-2 md:grid-cols-4 xl:col-span-3">
          <legend className="px-1 text-[11px] text-muted-foreground">Component {i + 1}</legend>
          <SelectField label="Economic kind" value={c.economicKind} onChange={(v) => setRow(c.key, { economicKind: v, treatment: v === "fee" ? c.treatment || "cash-paid" : "" })} options={ECONOMIC_KIND_OPTIONS} />
          <TextField label="Label" value={c.label} onChange={(v) => setRow(c.key, { label: v })} issue={issueFor(own, `config.components.${i}.label`)} hint="Can appear on posted split lines." />
          <SelectField label="Destination" value={c.destination} onChange={(v) => setRow(c.key, { destination: v })} options={DESTINATION_OPTIONS} />
          <SelectField label="Category" value={c.categoryId} onChange={(v) => setRow(c.key, { categoryId: v })} options={categoryOptions(directory)} issue={issueFor(own, `config.components.${i}.categoryId`)} />
          <SelectField label="Amount" value={c.amountRule} onChange={(v) => setRow(c.key, { amountRule: v })} options={AMOUNT_RULE_OPTIONS} />
          {c.amountRule === "fixed" ? <TextField label="Fixed amount" value={c.fixedAmount} onChange={(v) => setRow(c.key, { fixedAmount: v })} inputMode="decimal" issue={issueFor(own, `config.components.${i}.fixedAmountMinor`)} /> : null}
          {c.economicKind === "fee" ? <SelectField label="Fee treatment" value={c.treatment} onChange={(v) => setRow(c.key, { treatment: v })} options={FEE_TREATMENT_OPTIONS} issue={issueFor(own, `config.components.${i}.treatment`)} /> : null}
          <RemoveButton label={`Remove component ${i + 1}`} onClick={() => update((s) => ({ ...s, components: s.components.filter((x) => x.key !== c.key) }))} />
        </fieldset>
      ))}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update((s) => ({ ...s, components: [...s.components, { key: newKey(), economicKind: "fee", label: "Fee", destination: "category", categoryId: "", amountRule: "fixed", fixedAmount: "", treatment: "cash-paid" }] }))}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add a component
      </Button>
    </Section>
  );
}

export function OffsetsSection({ state, update, issues, directory }: SectionProps) {
  const own = inSection(issues, "offsets");
  // Only this budget's open accounts, never the loan itself: offsets are same-budget (FR-055).
  const options = accountOptions(directory, (a) => !a.closed && a.id !== state.liabilityAccountId);
  const setRow = (key: string, patch: Partial<EditorState["offsets"][number]>) => update((s) => ({ ...s, offsets: s.offsets.map((o) => (o.key === key ? { ...o, ...patch } : o)) }));
  return (
    <Section title="Offset and redraw" description="Cash accounts in this budget whose balance reduces the interest. Balances are read from Actual when needed, never stored here." issues={listed(own, "offsets", state.offsets.length)}>
      {state.offsets.map((o, i) => (
        <fieldset key={o.key} className="grid grid-cols-1 gap-2 rounded border border-border p-2 md:col-span-2 md:grid-cols-4 xl:col-span-3">
          <legend className="px-1 text-[11px] text-muted-foreground">Offset account {i + 1}</legend>
          <SelectField label="Account" value={o.actualAccountId} onChange={(v) => setRow(o.key, { actualAccountId: v })} options={options} issue={issueFor(own, `offsets.${i}.actualAccountId`)} />
          <DateField label="From" value={o.effectiveFrom} onChange={(v) => setRow(o.key, { effectiveFrom: v })} issue={issueFor(own, `offsets.${i}.effectiveFrom`)} />
          <DateField label="Until (not including)" value={o.effectiveTo} onChange={(v) => setRow(o.key, { effectiveTo: v })} issue={issueFor(own, `offsets.${i}.effectiveTo`)} />
          <TextField label="Offset (%)" value={o.percent} onChange={(v) => setRow(o.key, { percent: v })} inputMode="decimal" issue={issueFor(own, `offsets.${i}.offsetPercentageBps`)} />
          <SelectField label="Balance used" value={o.balanceBasis} onChange={(v) => setRow(o.key, { balanceBasis: v as "total" | "cleared" })} options={OFFSET_BASIS_OPTIONS} />
          <TextField label="Offset cap" value={o.cap} onChange={(v) => setRow(o.key, { cap: v })} inputMode="decimal" issue={issueFor(own, `offsets.${i}.capMinor`)} hint="Blank for no cap." />
          <RemoveButton label={`Remove offset account ${i + 1}`} onClick={() => update((s) => ({ ...s, offsets: s.offsets.filter((x) => x.key !== o.key) }))} />
        </fieldset>
      ))}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update((s) => ({ ...s, offsets: [...s.offsets, { key: newKey(), id: null, actualAccountId: "", effectiveFrom: s.terms.openingDate, effectiveTo: "", percent: "100", balanceBasis: "total", cap: "" }] }))}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add an offset account
      </Button>
    </Section>
  );
}

/**
 * Loan payment and draw categories (FR-011a): shown only when the repayment
 * relationship crosses the budget boundary, and only existing categories.
 */
export function CategoriesSection({ state, update, issues, directory }: SectionProps) {
  const own = inSection(issues, "categories");
  const liability = directory?.accounts.find((a) => a.id === state.liabilityAccountId);
  const payment = directory?.accounts.find((a) => a.id === state.paymentAccountId);
  const crosses = !!(liability && payment && crossesBudgetBoundary(liability, payment));
  const draws = state.behaviorClass === "revolving-credit" || state.assumptions.some((a) => a.kind === "draw");
  return (
    <Section title="Categories and reconciliation" description="Repayments between an on-budget and an off-budget account need a category on the on-budget side." issues={own.filter((i) => !["loanPaymentCategoryId", "drawCategoryId", "expectedObservationIntervalDays"].includes(i.field))}>
      {crosses ? (
        <SelectField label="Loan payment category" value={state.loanPaymentCategoryId} onChange={(v) => update((s) => ({ ...s, loanPaymentCategoryId: v }))} options={categoryOptions(directory)} issue={issueFor(own, "loanPaymentCategoryId")} hint="An existing expense category in this budget." />
      ) : null}
      {crosses && draws ? (
        <SelectField label="Draw category" value={state.drawCategoryId} onChange={(v) => update((s) => ({ ...s, drawCategoryId: v }))} options={categoryOptions(directory)} issue={issueFor(own, "drawCategoryId")} hint="May be the same as the loan payment category." />
      ) : null}
      {!crosses ? <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-3">These accounts do not cross the budget boundary, so no loan payment category is needed.</p> : null}
      <TextField
        label="Expected lender statement interval (days)"
        value={state.expectedObservationIntervalDays}
        onChange={(v) => update((s) => ({ ...s, expectedObservationIntervalDays: v }))}
        inputMode="numeric"
        issue={issueFor(own, "expectedObservationIntervalDays")}
        hint="Optional. Blank means reconciliation is never reported as overdue."
      />
    </Section>
  );
}
