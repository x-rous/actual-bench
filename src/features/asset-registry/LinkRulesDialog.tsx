"use client";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ConditionsEditor, newCondition } from "@/components/transactions/ConditionsEditor";
import { useTransactionReference } from "@/components/transactions/useTransactionReference";
import { describeRule, linkRuleInputSchema, type LinkRule, type RuleCondition } from "@/lib/asset-registry/linkRules";
import { type Asset, type Registry } from "@/lib/asset-registry/models";
import { registryRequest } from "./api";

type Draft = { id?: string; name: string; match: "all" | "any"; conditions: RuleCondition[] };
const blank = (): Draft => ({ name: "", match: "all", conditions: [newCondition()] });
const draftOf = (r: LinkRule): Draft => ({ id: r.id, name: r.name, match: r.match, conditions: r.conditions });

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
    const parsed = linkRuleInputSchema.safeParse({ ...(draft.id ? { id: draft.id } : {}), name: draft.name, match: draft.match,
      conditions: draft.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, ...(c.operator === "between" ? { value2: c.value2 ?? "" } : {}) })) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (await send({ kind: "save", rule: parsed.data })) setDraft(null);
  }
  if (draft) return <Dialog open onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}><DialogContent className="sm:max-w-3xl">
    <DialogHeader><DialogTitle>{draft.id ? "Edit link rule" : "New link rule"}</DialogTitle><DialogDescription>{asset.name} · saving a rule links nothing; you review the matches first.</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="grid gap-4">
      <FormField label="Rule name" htmlFor="rule-name" required><Input id="rule-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Rent from tenant" /></FormField>
      <ConditionsEditor value={{ match: draft.match, conditions: draft.conditions }} onChange={(next) => setDraft({ ...draft, ...next })} excludeAccountIds={assetAccountIds} />
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
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-muted-foreground" title={describeRule(r, ref.names)}>{describeRule(r, ref.names)}</p></div>
        <Button size="xs" onClick={() => onApply(r)}>Apply</Button>
        <Button size="icon-xs" variant="ghost" aria-label={`Edit rule ${r.name}`} onClick={() => setDraft(draftOf(r))}><Pencil className="size-3.5" /></Button>
        <Button size="icon-xs" variant="ghost" aria-label={`Delete rule ${r.name}`} disabled={busy} onClick={() => void send({ kind: "delete", id: r.id })}><Trash2 className="size-3.5" /></Button>
      </li>)}
    </ul>
    <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => { setError(""); setDraft(blank()); }}><Plus className="size-3.5" aria-hidden />New rule</Button></DialogFooter>
  </DialogContent></Dialog>;
}
