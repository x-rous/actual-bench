"use client";

import { useRef, useState } from "react";
import { ArrowRight, Download, Info, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clampSyncInterval } from "@/lib/sync/flowConfig";
import { buildSyncNotesMarker } from "@/lib/sync/notesMarker";
import { useFlowAccounts } from "../hooks/useSyncData";
import { isEntityFlow, isSameBudget, isSelfSync, missingRouteFields, type SyncEndpointForm, type SyncFlowFormState } from "../lib/flowForm";
import { exportFlowDefinition, importFlowDefinition, FlowImportError } from "../lib/flowPortability";
import { UnattendedEnrollment } from "./UnattendedEnrollment";
import type { ConnectionInstance } from "@/store/connection";

type FlowEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SyncFlowFormState;
  connections: ConnectionInstance[];
  onChange: (next: SyncFlowFormState) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  isNew: boolean;
  /** Saved flow id + its last run time, for the unattended status/Run now. */
  flowId?: string;
  lastRunAtMs?: number | null;
  onRan?: () => void;
};

const selectClass = "rounded-md border border-border bg-background px-2 py-1.5 text-sm min-w-0";

/** A tooltip-bearing info dot, for inline field/option explanations. */
function InfoDot({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help text-muted-foreground/70 hover:text-foreground">
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

function InlineEndpoint({
  label,
  endpoint,
  connections,
  entityMode,
  onChange,
}: {
  label: string;
  endpoint: SyncEndpointForm;
  connections: ConnectionInstance[];
  /** Entity (payee/category) flows pick a budget only - no account. */
  entityMode?: boolean;
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
      {entityMode ? null : (
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
      )}
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
  flowId,
  lastRunAtMs = null,
  onRan,
}: FlowEditDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const json = exportFlowDefinition(form);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sync-flow-${(form.name || "flow").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    try {
      onChange(importFlowDefinition(await file.text()));
    } catch (err) {
      setImportError(err instanceof FlowImportError ? err.message : "Could not import that file.");
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setConfirmingDelete(false);
      setImportError(null);
    }
    onOpenChange(next);
  }

  const routeMissing = missingRouteFields(form);
  const entityMode = isEntityFlow(form.flowType);
  // Entity flows are budget-level, so they must target two different budgets.
  // Transaction flows allow same budget with different accounts (RD-057 §3), so
  // only a true self-sync (same account) is blocked.
  const sameBudget = isSameBudget(form);
  const blockedRoute = entityMode ? sameBudget : isSelfSync(form);

  // Unattended (server) sync needs both endpoints on HTTP API mode (Hybrid, RD-058).
  const sourceConn = connections.find((c) => c.id === form.source.connectionId);
  const targetConn = connections.find((c) => c.id === form.target.connectionId);
  const unattendedEligible = sourceConn?.mode === "http-api" && targetConn?.mode === "http-api";
  // Block saving an unattended flow whose endpoints are no longer HTTP API - the
  // option is disabled in that case but the stored policy can go stale.
  const invalidUnattended = form.automation.reviewPolicy === "auto_sync_unattended" && !unattendedEligible;

  const canSave = routeMissing.length === 0 && !blockedRoute && !invalidUnattended;

  const set = (patch: Partial<SyncFlowFormState>) => onChange({ ...form, ...patch });
  const setFilter = (patch: Partial<SyncFlowFormState["filter"]>) => onChange({ ...form, filter: { ...form.filter, ...patch } });
  const setTransform = (patch: Partial<SyncFlowFormState["transform"]>) => onChange({ ...form, transform: { ...form.transform, ...patch } });
  const setAutomation = (patch: Partial<SyncFlowFormState["automation"]>) => onChange({ ...form, automation: { ...form.automation, ...patch } });
  const setEntity = (patch: Partial<SyncFlowFormState["entity"]>) => onChange({ ...form, entity: { ...form.entity, ...patch } });

  const automationHelp: Record<SyncFlowFormState["automation"]["reviewPolicy"], string> = {
    manual_preview_required: "You review and apply every change.",
    auto_apply_safe_only: "Safe items apply on preview; uncertain ones wait in the review queue.",
    auto_sync_on_interval: "Runs on a schedule while the app is open. Safe items only; nothing runs in the background.",
    auto_sync_unattended: "Runs on a server schedule with the app closed. Safe items only. HTTP API mode; requires storing the credential in the vault.",
  };

  // The default notes marker for this flow's route, shown as the editable
  // placeholder so the user can see - and override - what will be written.
  const defaultNotesMarker = buildSyncNotesMarker({
    sourceBudgetName: form.source.budgetName || "budget",
    sourceAccountName: form.source.accountName || "account",
  });

  // Which transaction filters carry a non-default value, for the active-state
  // highlight, the active count, and "Clear filters".
  const filterActive = {
    startDate: !!form.filter.startDate,
    endDate: !!form.filter.endDate,
    amountSign: form.filter.amountSign !== "any",
    cleared: form.filter.cleared !== "any",
    payeeInclude: !!form.filter.payeeInclude.trim(),
    categoryInclude: !!form.filter.categoryInclude.trim(),
    notesContains: !!form.filter.notesContains.trim(),
  };
  const activeFilterCount = Object.values(filterActive).filter(Boolean).length;
  const clearFilters = () =>
    setFilter({ startDate: "", endDate: "", amountSign: "any", cleared: "any", payeeInclude: "", categoryInclude: "", notesContains: "" });
  const activeRing = "border-primary/60 ring-1 ring-primary/40";

  // The advanced "what a sync may do" toggles, each with a plain-language detail
  // shown via an inline (i). Kept as data so the markup stays a simple map.
  const syncToggles: { key: keyof SyncFlowFormState["automation"]; label: string; detail: string }[] = [
    { key: "exactDuplicateAutoMap", label: "Link exact duplicates instead of creating them", detail: "When a transaction with the same date, amount, payee and category already exists on the target, link to it instead of creating a copy. Fuzzy (near) matches still go to review." },
    { key: "updateMappedTargets", label: "Update the target when the source changes", detail: "If a source transaction is edited after it was synced, push the change to its mapped target. A target you edited by hand is never overwritten." },
    { key: "detectDeletedSource", label: "Delete the target when the source is deleted", detail: "If a synced source transaction is later deleted, offer to delete its mapped target. Review-first: never automatic, never in bulk, and only for whole-account flows (no date range)." },
    { key: "createTargetSplits", label: "Keep split transactions grouped", detail: "Recreate a split transaction as one grouped split on the target (parent + child lines) instead of separate transactions." },
  ];


  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[92vw] sm:max-w-[1080px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "New sync flow" : "Edit sync flow"}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-1">
          {/* Type + name on one line — the type reshapes the rest of the form */}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">What to sync</span>
              <div className="inline-flex w-fit rounded-md border border-border p-0.5">
                {([["transaction_sync", "Transactions"], ["payee_sync", "Payees"], ["category_sync", "Categories"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={form.flowType === value}
                    onClick={() => set({ flowType: value })}
                    className={cn(
                      "rounded px-3 py-1 text-xs font-medium transition-colors",
                      form.flowType === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Name</span>
              <Input aria-label="Flow name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={entityMode ? "e.g. Shared payees" : "e.g. Joint card → Personal"} />
            </div>
          </div>

          {/* Route */}
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">From → to</h4>
              {blockedRoute ? (
                <span className="text-xs text-destructive">{entityMode ? "Pick two different budgets." : "Pick two different accounts."}</span>
              ) : routeMissing.length === 0 ? (
                <span className="text-xs text-muted-foreground">{entityMode ? "budget → budget" : "budget · account → budget · account"}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1"><InlineEndpoint label="Source" endpoint={form.source} connections={connections} entityMode={entityMode} onChange={(source) => set({ source })} /></div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><InlineEndpoint label="Target" endpoint={form.target} connections={connections} entityMode={entityMode} onChange={(target) => set({ target })} /></div>
            </div>
          </section>

          {/* Automation: policy on the left, the toggles that shape a sync on the
              right (each with an inline (i) explanation). */}
          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">Automation</h4>
            <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Review policy
                  <select
                    aria-label="Review policy"
                    className={selectClass}
                    value={form.automation.reviewPolicy}
                    onChange={(e) => setAutomation({ reviewPolicy: e.target.value as SyncFlowFormState["automation"]["reviewPolicy"] })}
                  >
                    <option value="manual_preview_required">Manual - preview &amp; apply yourself (default)</option>
                    <option value="auto_apply_safe_only">Auto-apply safe items on preview</option>
                    <option value="auto_sync_on_interval">Auto-sync on a schedule (while app is open)</option>
                    <option value="auto_sync_unattended" disabled={!unattendedEligible}>
                      Auto-sync on a server schedule (unattended){unattendedEligible ? "" : " - HTTP API only"}
                    </option>
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">{automationHelp[form.automation.reviewPolicy]}</p>
                {(form.automation.reviewPolicy === "auto_sync_on_interval" || form.automation.reviewPolicy === "auto_sync_unattended") && (
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Run every (minutes)
                    <Input
                      type="number"
                      min={15}
                      step={5}
                      aria-label="Auto-sync interval in minutes"
                      value={form.automation.intervalMinutes}
                      onChange={(e) => setAutomation({ intervalMinutes: e.target.value })}
                      onBlur={(e) => setAutomation({ intervalMinutes: String(clampSyncInterval(e.target.value)) })}
                    />
                    <span className="text-[11px]">Minimum 15 minutes. Each run re-opens and syncs the whole budget.</span>
                  </label>
                )}
                {form.automation.reviewPolicy === "auto_sync_unattended" && (
                  <UnattendedEnrollment
                    sourceConnection={sourceConn}
                    targetConnection={targetConn}
                    flowId={flowId}
                    intervalMinutes={clampSyncInterval(form.automation.intervalMinutes)}
                    flowEnabled={form.enabled}
                    autoPaused={!!form.automation.autoPausedAt}
                    lastRunAtMs={lastRunAtMs}
                    onRan={onRan}
                  />
                )}
              </div>

              {!entityMode && (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase text-muted-foreground">What a sync may do</span>
                  {syncToggles.map((t) => (
                    <label key={t.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        aria-label={t.label}
                        checked={!!form.automation[t.key]}
                        onChange={(e) => setAutomation({ [t.key]: e.target.checked } as Partial<SyncFlowFormState["automation"]>)}
                      />
                      <span className="flex items-center gap-1">{t.label} <InfoDot text={t.detail} /></span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Master-data (entity) options */}
          {entityMode && (
            <section className="flex flex-col gap-2.5 border-t border-border pt-4">
              <h4 className="text-sm font-semibold">{form.flowType === "payee_sync" ? "Payees" : "Categories"}</h4>
              <p className="text-xs text-muted-foreground">
                Creates missing {form.flowType === "payee_sync" ? "payees" : "categories"}, matches existing ones by name, and never renames or deletes.
              </p>
              {form.flowType === "category_sync" && (
                <>
                  <label className="flex max-w-xs flex-col gap-1 text-xs text-muted-foreground">
                    Default group
                    <Input
                      aria-label="Default target group"
                      value={form.entity.defaultGroupName}
                      onChange={(e) => setEntity({ defaultGroupName: e.target.value })}
                      placeholder="e.g. Uncategorized"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm" title="Create the source group on the target when it doesn't exist there.">
                    <input
                      type="checkbox"
                      aria-label="Create missing groups"
                      checked={form.entity.createMissingGroup}
                      onChange={(e) => setEntity({ createMissingGroup: e.target.checked })}
                    />
                    Create missing groups too
                  </label>
                  <p className="text-xs text-muted-foreground">
                    A category with no group match - and no default or group creation - is held for review.
                  </p>
                </>
              )}
            </section>
          )}

          {/* Transform + Filters (transactions only), side by side at wide widths */}
          {!entityMode && (
          <div className="grid gap-6 border-t border-border pt-4 lg:grid-cols-2">
            <section className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Transform</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">Amount direction <InfoDot text="Reverse flips the sign (an expense in one budget becomes income in the other) - the usual choice for cross-budget. Same keeps the sign." /></span>
                  <select aria-label="Amount direction" className={selectClass} value={form.transform.amountDirection} onChange={(e) => setTransform({ amountDirection: e.target.value as "reverse" | "same" })}>
                    <option value="same">Same sign (default)</option>
                    <option value="reverse">Reverse sign</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">Missing payee <InfoDot text="When the source payee has no match on the target: create it, or leave the payee empty." /></span>
                  <select aria-label="Missing payee policy" className={selectClass} value={form.transform.missingPayee} onChange={(e) => setTransform({ missingPayee: e.target.value as "create" | "leave_empty" })}>
                    <option value="create">Create payee (default)</option>
                    <option value="leave_empty">Leave empty</option>
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" aria-label="Add notes marker" checked={form.transform.notesMarkerEnabled} onChange={(e) => setTransform({ notesMarkerEnabled: e.target.checked })} />
                Add a note to synced transactions
              </label>
              {form.transform.notesMarkerEnabled && (
                <div className="flex flex-col gap-1 pl-6">
                  <Input
                    aria-label="Notes marker text"
                    value={form.transform.notesMarker}
                    onChange={(e) => setTransform({ notesMarker: e.target.value })}
                    placeholder={defaultNotesMarker}
                  />
                  <span className="text-[11px] text-muted-foreground">Leave blank to use the default.</span>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm" title="Copy the source transaction's own notes onto the target, before the marker.">
                <input type="checkbox" aria-label="Copy source notes" checked={form.transform.copySourceNotes} onChange={(e) => setTransform({ copySourceNotes: e.target.checked })} />
                Also copy the source transaction&apos;s notes
              </label>
              <p className="text-xs text-muted-foreground">Payees and categories are matched by name on the target.</p>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  Source Filters <InfoDot text="Only source transactions matching these filters are synced. Leave a field blank to include everything." />
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{activeFilterCount} active</span>
                  )}
                </h4>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground">Clear filters</button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={cn("flex flex-col gap-1 text-xs", filterActive.startDate ? "text-foreground" : "text-muted-foreground")}>Start date<Input type="date" aria-label="Start date" className={cn(filterActive.startDate && activeRing)} value={form.filter.startDate} onChange={(e) => setFilter({ startDate: e.target.value })} /></label>
                <label className={cn("flex flex-col gap-1 text-xs", filterActive.endDate ? "text-foreground" : "text-muted-foreground")}>End date<Input type="date" aria-label="End date" className={cn(filterActive.endDate && activeRing)} value={form.filter.endDate} onChange={(e) => setFilter({ endDate: e.target.value })} /></label>
                <label className={cn("flex flex-col gap-1 text-xs", filterActive.amountSign ? "text-foreground" : "text-muted-foreground")}>Amount sign
                  <select aria-label="Amount sign" className={cn(selectClass, filterActive.amountSign && activeRing)} value={form.filter.amountSign} onChange={(e) => setFilter({ amountSign: e.target.value as "any" | "inflow" | "outflow" })}>
                    <option value="any">Both</option><option value="inflow">Inflow only</option><option value="outflow">Outflow only</option>
                  </select>
                </label>
                <label className={cn("flex flex-col gap-1 text-xs", filterActive.cleared ? "text-foreground" : "text-muted-foreground")}>Cleared
                  <select aria-label="Cleared filter" className={cn(selectClass, filterActive.cleared && activeRing)} value={form.filter.cleared} onChange={(e) => setFilter({ cleared: e.target.value as "any" | "cleared" | "uncleared" })}>
                    <option value="any">Any</option><option value="cleared">Cleared</option><option value="uncleared">Uncleared</option>
                  </select>
                </label>
                <label className={cn("flex flex-col gap-1 text-xs", filterActive.payeeInclude ? "text-foreground" : "text-muted-foreground")}>Payee include<Input aria-label="Payee include" className={cn(filterActive.payeeInclude && activeRing)} value={form.filter.payeeInclude} onChange={(e) => setFilter({ payeeInclude: e.target.value })} placeholder="comma-separated" /></label>
                <label className={cn("flex flex-col gap-1 text-xs", filterActive.categoryInclude ? "text-foreground" : "text-muted-foreground")}>Category include<Input aria-label="Category include" className={cn(filterActive.categoryInclude && activeRing)} value={form.filter.categoryInclude} onChange={(e) => setFilter({ categoryInclude: e.target.value })} placeholder="comma-separated" /></label>
                <label className={cn("flex flex-col gap-1 text-xs sm:col-span-2", filterActive.notesContains ? "text-foreground" : "text-muted-foreground")}>Notes contains<Input aria-label="Notes contains" className={cn(filterActive.notesContains && activeRing)} value={form.filter.notesContains} onChange={(e) => setFilter({ notesContains: e.target.value })} /></label>
              </div>
              <p className="text-xs text-muted-foreground">Sync-generated transactions are always excluded to prevent loops.</p>
            </section>
          </div>
          )}
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
          {importError && <span className="text-xs text-destructive">{importError}</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = "";
            }}
          />
          <Button variant="ghost" size="sm" title="Import a flow definition" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <Button variant="ghost" size="sm" title="Export this flow definition" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={!canSave || saving}>{saving ? "Saving…" : "Save flow"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
