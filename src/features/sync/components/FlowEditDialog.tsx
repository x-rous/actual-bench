"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFlowAccounts } from "../hooks/useSyncData";
import { isSameBudget, missingRouteFields, type SyncEndpointForm, type SyncFlowFormState } from "../lib/flowForm";
import type { BrowserApiConnection } from "@/store/connection";

type FlowEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SyncFlowFormState;
  connections: BrowserApiConnection[];
  onChange: (next: SyncFlowFormState) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  isNew: boolean;
};

const selectClass = "rounded-md border border-border bg-background px-2 py-1.5 text-sm min-w-0";

function InlineEndpoint({
  label,
  endpoint,
  connections,
  onChange,
}: {
  label: string;
  endpoint: SyncEndpointForm;
  connections: BrowserApiConnection[];
  onChange: (next: SyncEndpointForm) => void;
}) {
  const accounts = useFlowAccounts(endpoint.connectionId);
  return (
    <div className="flex min-w-0 gap-2">
      <select
        aria-label={`${label} connection`}
        className={`${selectClass} flex-1`}
        value={endpoint.connectionId}
        onChange={(e) => {
          const c = connections.find((x) => x.id === e.target.value);
          onChange({ connectionId: c?.id ?? "", budgetSyncId: c?.budgetSyncId ?? "", budgetName: c?.label ?? "", accountId: "", accountName: "" });
        }}
      >
        <option value="">{label} budget…</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <select
        aria-label={`${label} account`}
        className={`${selectClass} flex-1`}
        value={endpoint.accountId}
        disabled={!endpoint.connectionId || accounts.isLoading}
        onChange={(e) => {
          const a = (accounts.data ?? []).find((x) => x.id === e.target.value);
          onChange({ ...endpoint, accountId: a?.id ?? "", accountName: a?.name ?? "" });
        }}
      >
        <option value="">{accounts.isLoading ? "Loading…" : "account…"}</option>
        {(accounts.data ?? []).map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    </div>
  );
}

export function FlowEditDialog({
  open,
  onOpenChange,
  form,
  connections,
  onChange,
  onSave,
  onDelete,
  saving,
  isNew,
}: FlowEditDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  function handleOpenChange(next: boolean) {
    if (!next) setConfirmingDelete(false);
    onOpenChange(next);
  }

  const routeMissing = missingRouteFields(form);
  const sameBudget = isSameBudget(form);
  const canSave = routeMissing.length === 0 && !sameBudget;

  const set = (patch: Partial<SyncFlowFormState>) => onChange({ ...form, ...patch });
  const setFilter = (patch: Partial<SyncFlowFormState["filter"]>) => onChange({ ...form, filter: { ...form.filter, ...patch } });
  const setTransform = (patch: Partial<SyncFlowFormState["transform"]>) => onChange({ ...form, transform: { ...form.transform, ...patch } });
  const setAutomation = (patch: Partial<SyncFlowFormState["automation"]>) => onChange({ ...form, automation: { ...form.automation, ...patch } });

  const automationHelp: Record<SyncFlowFormState["automation"]["reviewPolicy"], string> = {
    manual_preview_required: "Preview only. You review and apply every change yourself.",
    auto_apply_safe_only:
      "When you run a preview, safe new transactions and mapping repairs are applied automatically. Duplicates, changed, and other uncertain items still wait in the review queue.",
    auto_sync_on_interval:
      "Re-runs safe sync on a schedule while Actual Bench is open and this connection is unlocked. Applies only safe items; uncertain items go to the review queue. It does not run in the background when the app is closed.",
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[92vw] sm:max-w-[1080px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "New sync flow" : "Edit sync flow"}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[72vh] overflow-y-auto pr-1">
          {/* Name */}
          <div className="flex max-w-md flex-col gap-1 pb-4">
            <span className="text-[11px] font-semibold uppercase text-muted-foreground">Sync flow name</span>
            <Input aria-label="Flow name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Joint card → Personal budget" />
          </div>

          {/* Route (full width) */}
          <section className="flex flex-col gap-2 border-t border-border py-4">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">Route</h4>
              {!sameBudget && routeMissing.length === 0 && (
                <span className="rounded-full border border-green-500/30 bg-green-50 px-2 py-0.5 text-[11px] text-green-700 dark:bg-green-950/20 dark:text-green-400">Cross-budget OK</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1"><InlineEndpoint label="Source" endpoint={form.source} connections={connections} onChange={(source) => set({ source })} /></div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><InlineEndpoint label="Target" endpoint={form.target} connections={connections} onChange={(target) => set({ target })} /></div>
            </div>
            {sameBudget && <p className="text-xs text-destructive">Source and target must be different budgets (cross-budget only).</p>}
            <p className="text-xs text-muted-foreground">Source budget · account → target budget · account.</p>
          </section>

          {/* Automation policy (RD-054 / PR-020) */}
          <section className="flex flex-col gap-2 border-t border-border py-4">
            <h4 className="text-sm font-semibold">Automation</h4>
            <label className="flex max-w-md flex-col gap-1 text-xs text-muted-foreground">
              Review policy
              <select
                aria-label="Review policy"
                className={selectClass}
                value={form.automation.reviewPolicy}
                onChange={(e) => setAutomation({ reviewPolicy: e.target.value as SyncFlowFormState["automation"]["reviewPolicy"] })}
              >
                <option value="manual_preview_required">Manual — preview &amp; apply yourself (default)</option>
                <option value="auto_apply_safe_only">Auto-apply safe items on preview</option>
                <option value="auto_sync_on_interval">Auto-sync on a schedule (while app is open)</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">{automationHelp[form.automation.reviewPolicy]}</p>
            {form.automation.reviewPolicy === "auto_sync_on_interval" && (
              <label className="flex max-w-md flex-col gap-1 text-xs text-muted-foreground">
                Run every (minutes)
                <Input
                  type="number"
                  min={15}
                  step={5}
                  aria-label="Auto-sync interval in minutes"
                  value={form.automation.intervalMinutes}
                  onChange={(e) => setAutomation({ intervalMinutes: e.target.value })}
                />
                <span className="text-[11px]">Minimum 15 minutes. Each run re-opens and syncs the whole budget.</span>
              </label>
            )}
            {form.automation.reviewPolicy !== "manual_preview_required" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="Auto-map exact duplicates"
                  checked={form.automation.exactDuplicateAutoMap}
                  onChange={(e) => setAutomation({ exactDuplicateAutoMap: e.target.checked })}
                />
                Auto-map exact duplicates to the existing transaction
              </label>
            )}
            {form.automation.reviewPolicy !== "manual_preview_required" && (
              <p className="text-xs text-muted-foreground">
                When on, a transaction that already exists on the target with the same date, amount, payee and category is linked to it (no new transaction). Uncertain (fuzzy) duplicates still go to the review queue.
              </p>
            )}
          </section>

          {/* Transform + Filters, side by side at wide widths */}
          <div className="grid gap-6 border-t border-border pt-4 lg:grid-cols-2">
            <section className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Transform</h4>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Amount direction
                <select aria-label="Amount direction" className={selectClass} value={form.transform.amountDirection} onChange={(e) => setTransform({ amountDirection: e.target.value as "reverse" | "same" })}>
                  <option value="reverse">Reverse sign (default)</option>
                  <option value="same">Same sign</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Missing payee
                <select aria-label="Missing payee policy" className={selectClass} value={form.transform.missingPayee} onChange={(e) => setTransform({ missingPayee: e.target.value as "create" | "leave_empty" })}>
                  <option value="create">Create payee (default)</option>
                  <option value="leave_empty">Leave empty</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" aria-label="Add notes marker" checked={form.transform.notesMarkerEnabled} onChange={(e) => setTransform({ notesMarkerEnabled: e.target.checked })} />
                Add visible notes marker
              </label>
              <p className="text-xs text-muted-foreground">Categories match by name; missing categories are left empty. Eligible split lines are copied as separate transactions.</p>
            </section>

            <section className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Transactions Filters</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Start date<Input type="date" aria-label="Start date" value={form.filter.startDate} onChange={(e) => setFilter({ startDate: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">End date<Input type="date" aria-label="End date" value={form.filter.endDate} onChange={(e) => setFilter({ endDate: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Amount sign
                  <select aria-label="Amount sign" className={selectClass} value={form.filter.amountSign} onChange={(e) => setFilter({ amountSign: e.target.value as "any" | "inflow" | "outflow" })}>
                    <option value="any">Both</option><option value="inflow">Inflow only</option><option value="outflow">Outflow only</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Cleared
                  <select aria-label="Cleared filter" className={selectClass} value={form.filter.cleared} onChange={(e) => setFilter({ cleared: e.target.value as "any" | "cleared" | "uncleared" })}>
                    <option value="any">Any</option><option value="cleared">Cleared</option><option value="uncleared">Uncleared</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Payee include<Input aria-label="Payee include" value={form.filter.payeeInclude} onChange={(e) => setFilter({ payeeInclude: e.target.value })} placeholder="comma-separated" /></label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Category include<Input aria-label="Category include" value={form.filter.categoryInclude} onChange={(e) => setFilter({ categoryInclude: e.target.value })} placeholder="comma-separated" /></label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">Notes contains<Input aria-label="Notes contains" value={form.filter.notesContains} onChange={(e) => setFilter({ notesContains: e.target.value })} /></label>
              </div>
              <p className="text-xs text-muted-foreground">Sync-generated transactions are always excluded to prevent loops.</p>
            </section>
          </div>
        </div>

        <DialogFooter className="flex-row items-center gap-2">
          {!isNew && !confirmingDelete && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
          {confirmingDelete && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Delete this flow?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>Keep</Button>
              <Button size="sm" className="bg-destructive text-white hover:bg-destructive/90" onClick={onDelete}>Delete flow</Button>
            </div>
          )}
          <span className="flex-1" />
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={!canSave || saving}>{saving ? "Saving…" : "Save flow"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
