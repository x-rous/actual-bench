"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/combobox";
import { comparesRecord, OPERATOR_LABELS, OPERATORS_BY_FIELD, RULE_FIELDS, type ConditionSet, type RuleCondition, type RuleField, type RuleOperator } from "@/lib/transactions/conditions";
import { useTransactionReference } from "./useTransactionReference";

export const newCondition = (): RuleCondition => ({ field: "payee", operator: "equals", value: "" });

/**
 * "If [all|any] of these match": each condition is field → operation → value, as in Actual's rules and reconciliation
 * transforms. Used by saved link rules and by the transaction picker's Advanced filter, so both read the same.
 */
export function ConditionsEditor({ value, onChange, excludeAccountIds, excludeTransferPayees = true, disabled }: {
  value: ConditionSet; onChange: (next: ConditionSet) => void; excludeAccountIds?: string[]; excludeTransferPayees?: boolean; disabled?: boolean;
}) {
  const ref = useTransactionReference({ excludeAccountIds, excludeTransferPayees });
  const set = (conditions: RuleCondition[]) => onChange({ ...value, conditions });
  const update = (index: number, patch: Partial<RuleCondition>) => set(value.conditions.map((c, i) => i === index ? { ...c, ...patch } : c));
  const changeField = (index: number, field: RuleField) => set(value.conditions.map((c, i) => {
    if (i !== index) return c;
    const allowed = OPERATORS_BY_FIELD[field];
    return { field, operator: allowed.includes(c.operator) ? c.operator : allowed[0], value: "", value2: undefined };
  }));
  const changeOperator = (index: number, operator: RuleOperator) => set(value.conditions.map((c, i) => i === index ? { ...c, operator, value: comparesRecord({ field: c.field, operator }) !== comparesRecord(c) ? "" : c.value } : c));
  const optionsFor = (field: RuleField) => field === "payee" ? ref.payeeOptions : field === "category" ? ref.categoryOptions : ref.accountOptions;
  const valueControl = (c: RuleCondition, index: number) => comparesRecord(c)
    ? <div className="min-w-48 flex-1"><SearchableCombobox allowNone={false} ariaLabel="Condition value" value={c.value} options={optionsFor(c.field)} onChange={(v) => update(index, { value: v })} placeholder={`Choose a ${c.field}…`} /></div>
    : c.field === "amount"
      ? <><Input className="w-32" aria-label="Condition value" inputMode="decimal" placeholder="-350.00" value={c.value} onChange={(e) => update(index, { value: e.target.value })} />
        {c.operator === "between" && <><span className="text-xs text-muted-foreground">and</span><Input className="w-32" aria-label="Condition second value" inputMode="decimal" value={c.value2 ?? ""} onChange={(e) => update(index, { value2: e.target.value })} /></>}</>
      : <Input className="min-w-48 flex-1" aria-label="Condition value" placeholder={c.operator === "hasTag" || c.operator === "doesNotHaveTag" ? "#tag" : "Text"} value={c.value} onChange={(e) => update(index, { value: e.target.value })} />;
  return <section aria-label="Conditions" className="grid gap-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">If <Select size="sm" className="w-20 normal-case" aria-label="Match" disabled={disabled} value={value.match} onValueChange={(v) => onChange({ ...value, match: v as "all" | "any" })} options={[{ value: "all", label: "all" }, { value: "any", label: "any" }]} /> of these match</h3>
      <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" disabled={disabled} onClick={() => set([...value.conditions, newCondition()])}><Plus className="mr-1 size-3.5" aria-hidden />Add a condition</Button>
    </div>
    {value.conditions.map((c, index) => <div key={index} className="flex flex-wrap items-center gap-1.5">
      <Select size="sm" className="w-36 shrink-0 border-indigo-200 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300" aria-label="Field" disabled={disabled} value={c.field} onValueChange={(v) => changeField(index, v as RuleField)} options={RULE_FIELDS.map((f) => ({ value: f.id, label: f.label }))} />
      <Select size="sm" className="w-44 shrink-0" aria-label="Operation" disabled={disabled} value={c.operator} onValueChange={(v) => changeOperator(index, v as RuleOperator)} options={OPERATORS_BY_FIELD[c.field].map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))} />
      {valueControl(c, index)}
      <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove this condition" disabled={disabled || value.conditions.length === 1} onClick={() => set(value.conditions.filter((_, i) => i !== index))}><Trash2 className="size-3.5" aria-hidden /></Button>
    </div>)}
  </section>;
}
