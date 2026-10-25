"use client";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/combobox";
import { useTransactionReference } from "@/components/transactions/useTransactionReference";
import { comparesRecord, describeRule, linkRuleInputSchema, OPERATOR_LABELS, OPERATORS_BY_FIELD, RULE_FIELDS, type LinkRule, type RuleCondition, type RuleField, type RuleOperator } from "@/lib/asset-registry/linkRules";
import { CASHFLOW_GROUPS, CASHFLOW_TYPES, type Asset, type Registry } from "@/lib/asset-registry/models";
import { registryRequest } from "./api";

type Draft = { id?: string; name: string; match: "all" | "any"; conditions: RuleCondition[]; classification: string };
const newCondition = (): RuleCondition => ({ field: "payee", operator: "equals", value: "" });
const blank = (): Draft => ({ name: "", match: "all", conditions: [newCondition()], classification: "" });
const draftOf = (r: LinkRule): Draft => ({ id: r.id, name: r.name, match: r.match, conditions: r.conditions, classification: r.classification ?? "" });

/**
 * Saved link rules for one asset, written like a reconciliation transform: "If [all|any] of these conditions match",
 * each one field → operation → value. A rule only proposes transactions; Apply opens the picker with every match
 * chosen so the owner reviews them before anything is linked.
 */
export function LinkRulesDialog({ asset, registry, assetAccountIds, onSaved, onApply, onClose }: {
  asset: Asset; registry: Registry; assetAccountIds: string[]; onSaved: (registry: Registry) => Promise<void>; onApply: (rule: LinkRule) => void; onClose: () => void;
}) {
  const rules = (registry.linkRules ?? []).filter((r) => r.assetId === asset.id);
  const ref = useTransactionReference({ excludeAccountIds: assetAccountIds, excludeTransferPayees: true });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function send(operation: object) {
    setBusy(true); setError("");
    try { await onSaved(await registryRequest(asset.budgetSyncId, "PUT", { __path: "rules", assetId: asset.id, operation })); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the rule"); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    const parsed = linkRuleInputSchema.safeParse({ ...(draft.id ? { id: draft.id } : {}), name: draft.name, match: draft.match, classification: draft.classification || null,
      conditions: draft.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, ...(c.operator === "between" ? { value2: c.value2 ?? "" } : {}) })) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (await send({ kind: "save", rule: parsed.data })) setDraft(null);
  }
  const update = (index: number, patch: Partial<RuleCondition>) => setDraft((d) => d && { ...d, conditions: d.conditions.map((c, i) => i === index ? { ...c, ...patch } : c) });
  const changeField = (index: number, field: RuleField) => setDraft((d) => d && { ...d, conditions: d.conditions.map((c, i) => {
    if (i !== index) return c;
    const allowed = OPERATORS_BY_FIELD[field];
    return { field, operator: allowed.includes(c.operator) ? c.operator : allowed[0], value: "", value2: undefined };
  }) });
  const changeOperator = (index: number, operator: RuleOperator) => setDraft((d) => d && { ...d, conditions: d.conditions.map((c, i) => i === index ? { ...c, operator, value: comparesRecord({ field: c.field, operator }) !== comparesRecord(c) ? "" : c.value } : c) });
  const optionsFor = (field: RuleField) => field === "payee" ? ref.payeeOptions : field === "category" ? ref.categoryOptions : ref.accountOptions;
  const valueControl = (c: RuleCondition, index: number) => comparesRecord(c)
    ? <div className="min-w-48 flex-1"><SearchableCombobox allowNone={false} ariaLabel="Condition value" value={c.value} options={optionsFor(c.field)} onChange={(value) => update(index, { value })} placeholder={`Choose a ${c.field}…`} /></div>
    : c.field === "amount"
      ? <><Input className="w-32" aria-label="Condition value" inputMode="decimal" placeholder="-350.00" value={c.value} onChange={(e) => update(index, { value: e.target.value })} />
        {c.operator === "between" && <><span className="text-xs text-muted-foreground">and</span><Input className="w-32" aria-label="Condition second value" inputMode="decimal" value={c.value2 ?? ""} onChange={(e) => update(index, { value2: e.target.value })} /></>}</>
      : <Input className="min-w-48 flex-1" aria-label="Condition value" placeholder={c.operator === "hasTag" || c.operator === "doesNotHaveTag" ? "#tag" : "Text"} value={c.value} onChange={(e) => update(index, { value: e.target.value })} />;
  if (draft) return <Dialog open onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}><DialogContent className="sm:max-w-3xl">
    <DialogHeader><DialogTitle>{draft.id ? "Edit link rule" : "New link rule"}</DialogTitle><DialogDescription>{asset.name} · saving a rule links nothing; you review the matches first.</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="grid gap-4">
      <FormField label="Rule name" htmlFor="rule-name" required><Input id="rule-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Rent from tenant" /></FormField>
      <section aria-label="Conditions" className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">If <Select size="sm" className="w-20 normal-case" aria-label="Match" value={draft.match} onValueChange={(v) => setDraft({ ...draft, match: v as "all" | "any" })} options={[{ value: "all", label: "all" }, { value: "any", label: "any" }]} /> of these match</h3>
          <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, newCondition()] })}><Plus className="mr-1 size-3.5" aria-hidden />Add a condition</Button>
        </div>
        {draft.conditions.map((c, index) => <div key={index} className="flex flex-wrap items-center gap-1.5">
          <Select size="sm" className="w-36 shrink-0 border-indigo-200 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300" aria-label="Field" value={c.field} onValueChange={(v) => changeField(index, v as RuleField)} options={RULE_FIELDS.map((f) => ({ value: f.id, label: f.label }))} />
          <Select size="sm" className="w-44 shrink-0" aria-label="Operation" value={c.operator} onValueChange={(v) => changeOperator(index, v as RuleOperator)} options={OPERATORS_BY_FIELD[c.field].map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))} />
          {valueControl(c, index)}
          <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove this condition" disabled={draft.conditions.length === 1} onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) })}><Trash2 className="size-3.5" aria-hidden /></Button>
        </div>)}
      </section>
      <section aria-label="Then" className="grid gap-2 border-t pt-3">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Then</h3>
        <FormField label="Link as" htmlFor="rule-type" help="Applied to the matches when you confirm. You can still change it per row afterwards."><Select id="rule-type" className="sm:w-80" value={draft.classification} onValueChange={(v) => setDraft({ ...draft, classification: v })} options={[{ value: "", label: "Unclassified" }]} groups={CASHFLOW_GROUPS.map((g) => ({ label: g.label, options: g.types.map((value) => ({ value, label: CASHFLOW_TYPES[value] })) }))} /></FormField>
      </section>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>Back</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save rule"}</Button></DialogFooter>
  </DialogContent></Dialog>;
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Link rules</DialogTitle><DialogDescription>{asset.name} · a rule proposes matching Actual transactions. Apply it whenever new ones arrive, review the matches, then link.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <ul aria-label="Saved link rules" className="max-h-80 divide-y overflow-auto rounded-md border text-sm">
      {rules.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">No rules yet. Create one to find rent, dividends or recurring bills without searching each time.</li>}
      {rules.map((r) => <li key={r.id} className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-muted-foreground" title={describeRule(r, ref.names)}>{describeRule(r, ref.names)}{r.classification ? ` → ${CASHFLOW_TYPES[r.classification]}` : ""}</p></div>
        <Button size="xs" onClick={() => onApply(r)}>Apply</Button>
        <Button size="icon-xs" variant="ghost" aria-label={`Edit rule ${r.name}`} onClick={() => setDraft(draftOf(r))}><Pencil className="size-3.5" /></Button>
        <Button size="icon-xs" variant="ghost" aria-label={`Delete rule ${r.name}`} disabled={busy} onClick={() => void send({ kind: "delete", id: r.id })}><Trash2 className="size-3.5" /></Button>
      </li>)}
    </ul>
    <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => { setError(""); setDraft(blank()); }}><Plus className="size-3.5" aria-hidden />New rule</Button></DialogFooter>
  </DialogContent></Dialog>;
}
