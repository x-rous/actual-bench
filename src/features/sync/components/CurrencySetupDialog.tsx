"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountPicker } from "@/components/ui/entity-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import { useFlowAccounts } from "../hooks/useSyncData";
import { useSyncFlowMutations } from "../hooks/useSyncFlows";
import { buildCurrencySetupForms, matchAccountsByName, type SetupAccountPair, type SetupBudget } from "../lib/currencySetup";
import { buildFlowPayload, type SyncFlowFormState } from "../lib/flowForm";
import type { SyncFlow } from "@/lib/app-db/types";
import type { ConnectionInstance } from "@/store/connection";

type CurrencySetupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: ConnectionInstance[];
  existingFlows: SyncFlow[];
  /** Called after creating; `flowId` is the first transaction flow, to open next. */
  onCreated: (flowId: string | null) => void;
};

const CURRENCY_CODE = /^[A-Z]{3}$/;

const toBudget = (connection: ConnectionInstance | undefined): SetupBudget | null =>
  connection ? { connectionId: connection.id, budgetSyncId: connection.budgetSyncId, budgetName: connection.label } : null;

/** True when a saved flow already covers this form's type and route. */
function isCovered(form: SyncFlowFormState, flows: SyncFlow[]): boolean {
  return flows.some((flow) => {
    if (flow.flowType !== form.flowType) return false;
    const config = decodeFlowPlanConfig(flow);
    return config.sourceBudgetId === form.source.budgetSyncId &&
      config.targetBudgetId === form.target.budgetSyncId &&
      config.sourceAccountId === form.source.accountId &&
      config.targetAccountId === form.target.accountId;
  });
}

export function CurrencySetupDialog({ open, onOpenChange, connections, existingFlows, onCreated }: CurrencySetupDialogProps) {
  const [mainId, setMainId] = useState("");
  const [foreignId, setForeignId] = useState("");
  const [mainCurrency, setMainCurrency] = useState("");
  const [foreignCurrency, setForeignCurrency] = useState("");
  // Only the user's changes are held; the default pairing is derived from names.
  const [pairOverrides, setPairOverrides] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { create } = useSyncFlowMutations();

  const foreignAccounts = useFlowAccounts(foreignId);
  const mainAccounts = useFlowAccounts(mainId);
  const sourceAccounts = useMemo(() => (foreignAccounts.data ?? []).filter((a) => !a.closed), [foreignAccounts.data]);
  const targetAccounts = useMemo(() => (mainAccounts.data ?? []).filter((a) => !a.closed), [mainAccounts.data]);
  const matches = useMemo(() => matchAccountsByName(sourceAccounts, targetAccounts), [sourceAccounts, targetAccounts]);

  const budgetOptions = connections.map((c) => ({ value: c.id, label: c.label }));
  const main = toBudget(connections.find((c) => c.id === mainId));
  const foreign = toBudget(connections.find((c) => c.id === foreignId));
  const targetFor = (accountId: string) => pairOverrides[accountId] ?? matches.get(accountId) ?? "";

  const pairs: SetupAccountPair[] = sourceAccounts.flatMap((source) => {
    if (excluded.has(source.id)) return [];
    const target = targetAccounts.find((a) => a.id === targetFor(source.id));
    return target ? [{ source: { id: source.id, name: source.name }, target: { id: target.id, name: target.name } }] : [];
  });
  const targetIds = pairs.map((pair) => pair.target.id);
  const duplicateTarget = new Set(targetIds).size !== targetIds.length;
  const sameBudget = !!main && !!foreign && main.budgetSyncId === foreign.budgetSyncId;
  const codesValid = CURRENCY_CODE.test(mainCurrency) && CURRENCY_CODE.test(foreignCurrency) && mainCurrency !== foreignCurrency;

  const forms = main && foreign && codesValid && !sameBudget
    ? buildCurrencySetupForms({ main, foreign, foreignCurrency, mainCurrency, pairs })
    : [];
  const newForms = forms.filter((form) => !isCovered(form, existingFlows));
  const canCreate = pairs.length > 0 && newForms.length > 0 && !duplicateTarget && !saving;

  function reset() {
    setMainId(""); setForeignId(""); setMainCurrency(""); setForeignCurrency("");
    setPairOverrides({}); setExcluded(new Set()); setError(null);
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    let firstTransactionFlow: string | null = null;
    let created = 0;
    try {
      for (const form of newForms) {
        const { flow } = await create.mutateAsync(buildFlowPayload(form, connections));
        created += 1;
        if (!firstTransactionFlow && flow.flowType === "transaction_sync") firstTransactionFlow = flow.id;
      }
      onCreated(firstTransactionFlow);
      reset();
      onOpenChange(false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "A flow could not be created.";
      setError(created > 0 ? `${created} of ${newForms.length} flows were created. ${reason} Run this again to add the rest.` : reason);
      if (created > 0) onCreated(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next); }}>
      <DialogContent className="max-h-[88vh] w-[92vw] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[860px]">
        <DialogHeader><DialogTitle>Add a currency</DialogTitle></DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <p className="text-xs text-muted-foreground">
            Keep each foreign currency in its own budget. This creates the flows that copy payees and categories to it and bring its transactions back converted. Every flow starts manual, so you preview before anything is written.
          </p>

          <div className="grid gap-3 sm:grid-cols-[1fr_6rem_1fr_6rem]">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Main budget
              <Select aria-label="Main budget" size="sm" value={mainId} onValueChange={(value) => { setMainId(value); setPairOverrides({}); }} options={budgetOptions} placeholder="Select budget…" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Currency
              <Input aria-label="Main currency" size="sm" className="uppercase" maxLength={3} placeholder="AED" value={mainCurrency} onChange={(e) => setMainCurrency(e.target.value.toUpperCase())} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Foreign-currency budget
              <Select aria-label="Foreign-currency budget" size="sm" value={foreignId} onValueChange={(value) => { setForeignId(value); setPairOverrides({}); setExcluded(new Set()); }} options={budgetOptions} placeholder="Select budget…" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Currency
              <Input aria-label="Foreign currency" size="sm" className="uppercase" maxLength={3} placeholder="AUD" value={foreignCurrency} onChange={(e) => setForeignCurrency(e.target.value.toUpperCase())} />
            </label>
          </div>
          {sameBudget && <p className="text-xs text-destructive">Choose two different budgets.</p>}
          {mainCurrency.length === 3 && mainCurrency === foreignCurrency && <p className="text-xs text-destructive">The two currencies must differ.</p>}

          {main && foreign && !sameBudget && (
            <section className="flex flex-col gap-2 border-t border-border pt-3">
              <h4 className="text-sm font-semibold">Accounts</h4>
              {foreignAccounts.isLoading || mainAccounts.isLoading ? (
                <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading accounts…</p>
              ) : sourceAccounts.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">The foreign-currency budget has no open accounts.</p>
              ) : (
                <div className="overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium"><th className="w-8"><span className="sr-only">Include</span></th><th>Foreign account</th><th>Syncs to main-budget account</th></tr>
                    </thead>
                    <tbody>
                      {sourceAccounts.map((account) => (
                        <tr key={account.id} className="border-t border-border/60 [&>td]:px-2 [&>td]:py-1">
                          <td><Checkbox aria-label={`Include ${account.name}`} checked={!excluded.has(account.id)} onCheckedChange={(checked) => setExcluded((prev) => { const next = new Set(prev); if (checked) next.delete(account.id); else next.add(account.id); return next; })} /></td>
                          <td className="whitespace-nowrap">{account.name}</td>
                          <td className="w-1/2">
                            <AccountPicker ariaLabel={`Main-budget account for ${account.name}`} size="sm" accounts={targetAccounts} value={targetFor(account.id)} disabled={excluded.has(account.id)} placeholder="Select account…" onChange={(value) => setPairOverrides((prev) => ({ ...prev, [account.id]: value ?? "" }))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {duplicateTarget && <p className="text-xs text-destructive">Two foreign accounts point at the same main-budget account.</p>}
            </section>
          )}

          {forms.length > 0 && pairs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Creates {newForms.length} flow{newForms.length === 1 ? "" : "s"}: {newForms.map((form) => form.name).join(", ") || "none"}.
              {forms.length > newForms.length ? ` ${forms.length - newForms.length} already exist and are kept as they are.` : ""}
            </p>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void handleCreate()} disabled={!canCreate}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create flows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
