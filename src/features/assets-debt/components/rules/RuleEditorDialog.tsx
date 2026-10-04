"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DebtMatchPurpose } from "@/lib/app-db/types";
import type { DirectoryAccount, DirectoryCategory } from "@/lib/assets-debt/actual/ledgerPort";
import type { MatchRuleSave, MatchRuleView } from "@/lib/assets-debt/services/matchingService";
import { IntegerField, MoneyField, SelectField, TextField } from "../fields";
import {
  conditionsToSettings,
  defaultActions,
  describeSettings,
  recommendedSettings,
  settingsToConditions,
  type AmountFilter,
  type MatchingSettings,
  type RecommendationInput,
} from "../../lib/matchingRuleBuilder";

/**
 * Matching rule setup (RD-084 P1.4/P1.6 T280; FR-075a, FR-206).
 *
 * People choose a Recommended setup built from Tracking setup and, only if they
 * want, adjust it with structured controls. The rule is still stored as the
 * Bench-owned matching DSL v1 and evaluated by the existing engine; nobody
 * edits its JSON. The generated rule can be shown read-only for support.
 */

const PURPOSES: { value: DebtMatchPurpose; label: string }[] = [
  { value: "repayment", label: "Scheduled repayment" },
  { value: "interest-charge", label: "Lender interest charge" },
  { value: "lender-repayment-row", label: "Lender's repayment row" },
];

const AMOUNT_MODES = [
  { value: "approximate", label: "About this amount" },
  { value: "exact", label: "Exactly this amount" },
  { value: "between", label: "Between two amounts" },
  { value: "any", label: "Any amount" },
];

export type RecommendationContext = Omit<RecommendationInput, "purpose">;

export function RuleEditorDialog({
  open,
  rule,
  recommendation,
  accounts,
  categories,
  currency,
  minorDigits,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  rule: MatchRuleView | null;
  recommendation: RecommendationContext;
  accounts: readonly DirectoryAccount[];
  categories: readonly DirectoryCategory[];
  currency: string;
  minorDigits: number;
  onOpenChange: (open: boolean) => void;
  onSave: (value: MatchRuleSave) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState<DebtMatchPurpose>("repayment");
  const [settings, setSettings] = useState<MatchingSettings | null>(null);
  const [unrepresentable, setUnrepresentable] = useState<string | null>(null);
  const [customize, setCustomize] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const recommended = (p: DebtMatchPurpose) => recommendedSettings({ ...recommendation, purpose: p });

  // Reset the form each time the dialog opens; it holds no state between openings.
  useEffect(() => {
    if (!open) return;
    const initialPurpose = rule && typeof rule.record.purpose === "string" ? rule.record.purpose : "repayment";
    setPurpose(initialPurpose);
    setError(null);
    setShowRule(false);
    if (rule?.conditions) {
      const read = conditionsToSettings(rule.conditions);
      setSettings(read.ok ? read.settings : null);
      setUnrepresentable(read.ok ? null : read.reason);
      setCustomize(read.ok);
    } else {
      setSettings(recommendedSettings({ ...recommendation, purpose: initialPurpose }));
      setUnrepresentable(null);
      setCustomize(false);
    }
  }, [open, rule, recommendation]);

  const generated = useMemo(() => {
    if (!settings) return { ok: false as const, message: "" };
    try {
      return { ok: true as const, conditions: settingsToConditions(settings) };
    } catch (cause) {
      return { ok: false as const, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [settings]);

  const update = (patch: Partial<MatchingSettings>) => setSettings((current) => (current ? { ...current, ...patch } : current));
  const setAmount = (amount: AmountFilter) => update({ amount });

  const save = async (enabled: boolean) => {
    if (!generated.ok) return;
    try {
      setSaving(true);
      setError(null);
      await onSave({ purpose, conditions: generated.conditions, actions: rule?.actions ?? defaultActions(), enabled });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const accountOptions = accounts.filter((a) => !a.closed).map((a) => ({ value: a.id, label: `${a.name}${a.offBudget ? " (off-budget)" : ""}` }));
  const categoryOptions = [{ value: "", label: "Any category" }, { value: "__empty", label: "Uncategorized only" }, ...categories.filter((c) => !c.hidden).map((c) => ({ value: c.id, label: `${c.groupName}: ${c.name}` }))];
  const amount = settings?.amount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit matching" : "Set up matching"}</DialogTitle>
          <DialogDescription>Tells Bench which Actual transactions belong to this loan. Matching only reads Actual; it never creates or runs an Actual rule. Proposed changes use enabled matching only; enabling first backtests the history range on the Rules page.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <SelectField
            label="What to match"
            value={purpose}
            options={PURPOSES}
            onChange={(value) => {
              const next = value as DebtMatchPurpose;
              setPurpose(next);
              if (!rule) setSettings(recommended(next));
            }}
          />

          {unrepresentable ? (
            <div role="alert" className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <p>{unrepresentable}</p>
              <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => { setSettings(recommended(purpose)); setUnrepresentable(null); }}>Replace with the recommended setup</Button>
            </div>
          ) : null}

          {settings ? (
            <section aria-labelledby="recommended-heading" className="grid gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="recommended-heading" className="text-sm font-semibold">{customize ? "Matching" : "Recommended matching"}</h3>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSettings(recommended(purpose))}>Reset to recommended</Button>
              </div>
              <p role="status" className="text-sm">{describeSettings(settings, accounts, categories, minorDigits, currency)}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <IntegerField label="Days early" value={settings.daysEarly} onChange={(value) => update({ daysEarly: value ?? 0 })} suffix="days" />
                <IntegerField label="Days late" value={settings.daysLate} onChange={(value) => update({ daysLate: value ?? 0 })} suffix="days" />
                {amount?.mode === "approximate" && amount.tolerance.kind === "absolute" ? (
                  <MoneyField label="Amount tolerance" valueMinor={amount.tolerance.amountMinor} minorDigits={minorDigits} suffix={currency} onChange={(value) => setAmount({ ...amount, tolerance: { kind: "absolute", amountMinor: value ?? 0 } })} />
                ) : null}
              </div>
              <Button type="button" size="sm" variant="outline" className="justify-self-start" aria-expanded={customize} onClick={() => setCustomize((value) => !value)}>
                {customize ? "Hide matching details" : "Customize matching"}
              </Button>
            </section>
          ) : null}

          {settings && customize ? (
            <section aria-label="Customize matching" className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
              <SelectField label="Account" value={settings.sourceAccountId} options={accountOptions} onChange={(value) => update({ sourceAccountId: value })} />
              <SelectField label="Direction" value={settings.direction} options={[{ value: "outflow", label: "Money out" }, { value: "inflow", label: "Money in" }, { value: "either", label: "Either" }]} onChange={(value) => update({ direction: value as MatchingSettings["direction"] })} />
              <SelectField
                label="Amount"
                value={settings.amount.mode}
                options={AMOUNT_MODES}
                onChange={(value) => {
                  const previous = settings.amount;
                  const known = previous.mode === "exact" || previous.mode === "approximate" ? previous.amountMinor : recommendation.expectedPaymentMinor ?? 0;
                  setAmount(value === "exact" ? { mode: "exact", amountMinor: known }
                    : value === "approximate" ? { mode: "approximate", amountMinor: known, tolerance: { kind: "absolute", amountMinor: recommendation.toleranceMinor } }
                      : value === "between" ? { mode: "between", minMinor: known, maxMinor: known }
                        : { mode: "any" });
                }}
              />
              {amount?.mode === "exact" || amount?.mode === "approximate" ? (
                <MoneyField label="Expected amount" valueMinor={amount.amountMinor} minorDigits={minorDigits} suffix={currency} onChange={(value) => setAmount({ ...amount, amountMinor: value ?? 0 })} />
              ) : null}
              {amount?.mode === "approximate" ? (
                <>
                  <SelectField label="Tolerance as" value={amount.tolerance.kind} options={[{ value: "absolute", label: "An amount" }, { value: "percent", label: "A percentage" }]} onChange={(value) => setAmount({ ...amount, tolerance: value === "percent" ? { kind: "percent", bps: 100 } : { kind: "absolute", amountMinor: recommendation.toleranceMinor } })} />
                  {amount.tolerance.kind === "percent" ? (
                    <MoneyField label="Tolerance" valueMinor={amount.tolerance.bps} minorDigits={2} suffix="%" onChange={(value) => setAmount({ ...amount, tolerance: { kind: "percent", bps: Math.min(10_000, value ?? 0) } })} />
                  ) : null}
                </>
              ) : null}
              {amount?.mode === "between" ? (
                <>
                  <MoneyField label="From amount" valueMinor={amount.minMinor} minorDigits={minorDigits} suffix={currency} onChange={(value) => setAmount({ ...amount, minMinor: value ?? 0 })} />
                  <MoneyField label="To amount" valueMinor={amount.maxMinor} minorDigits={minorDigits} suffix={currency} onChange={(value) => setAmount({ ...amount, maxMinor: value ?? 0 })} />
                </>
              ) : null}
              <IntegerField label="Only on day of month" hint="Leave empty to use the scheduled dates alone." value={settings.dayOfMonth} min={1} onChange={(value) => update({ dayOfMonth: value === null ? null : Math.min(31, Math.max(1, value)) })} />
              <SelectField
                label="Category"
                value={settings.category.mode === "exact" ? settings.category.categoryId : settings.category.mode === "empty" ? "__empty" : ""}
                options={categoryOptions}
                onChange={(value) => update({ category: value === "" ? { mode: "any" } : value === "__empty" ? { mode: "empty" } : { mode: "exact", categoryId: value } })}
              />
              <SelectField label="Transfer" value={settings.transfer} options={[{ value: "any", label: "Either" }, { value: "none", label: "Not a transfer" }, { value: "present", label: "Already a transfer" }]} onChange={(value) => update({ transfer: value as MatchingSettings["transfer"] })} />
              <SelectField label="Split" value={settings.split} options={[{ value: "any", label: "Either" }, { value: "single", label: "Not split" }, { value: "child", label: "A split line" }]} onChange={(value) => update({ split: value as MatchingSettings["split"] })} />
              <SelectField label="Reconciled" value={settings.reconciled} options={[{ value: "any", label: "Either" }, { value: "unreconciled", label: "Not reconciled" }]} onChange={(value) => update({ reconciled: value as MatchingSettings["reconciled"] })} />
              <SelectField label="Cleared" value={settings.cleared} options={[{ value: "any", label: "Either" }, { value: "cleared", label: "Cleared" }, { value: "uncleared", label: "Not cleared" }]} onChange={(value) => update({ cleared: value as MatchingSettings["cleared"] })} />
              <TextField label="Bank text contains" value={settings.importedPayeeContains} onChange={(value) => update({ importedPayeeContains: value })} />
              <TextField label="Notes contain" value={settings.notesContains} onChange={(value) => update({ notesContains: value })} />
              {settings.preserved.length ? (
                <div className="grid gap-1 text-xs sm:col-span-2">
                  <p className="font-medium">Kept from the existing rule</p>
                  <ul className="list-disc pl-4">{settings.preserved.map((item, index) => <li key={index}>{item.kind}</li>)}</ul>
                  <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => update({ preserved: [] })}>Remove these conditions</Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {!generated.ok && generated.message ? <p role="alert" className="text-sm text-destructive">{generated.message}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          {settings || rule?.conditions ? (
            <div className="grid gap-1">
              <Button type="button" size="sm" variant="ghost" className="justify-self-start text-xs" aria-expanded={showRule} onClick={() => setShowRule((value) => !value)}>
                {showRule ? "Hide the generated rule" : "Show the generated rule (advanced)"}
              </Button>
              {showRule ? (
                <pre aria-label="Generated matching rule" className="max-h-60 overflow-auto rounded bg-muted p-2 text-[11px]">
                  {JSON.stringify(generated.ok ? generated.conditions : rule?.conditions ?? null, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="outline" onClick={() => void save(false)} disabled={saving || !generated.ok || !settings?.sourceAccountId}>{saving ? "Saving..." : "Save as draft"}</Button>
          <Button type="button" onClick={() => void save(true)} disabled={saving || !generated.ok || !settings?.sourceAccountId}>{saving ? "Checking history..." : "Save and enable"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
