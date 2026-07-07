"use client";

import { ArrowLeftRight, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EndpointPicker } from "./EndpointPicker";
import { isSameBudget, missingRouteFields, type SyncFlowFormState } from "../lib/flowForm";
import type { BrowserApiConnection } from "@/store/connection";

type FlowEditorProps = {
  form: SyncFlowFormState;
  connections: BrowserApiConnection[];
  onChange: (next: SyncFlowFormState) => void;
  onSave: () => void;
  onPreview: () => void;
  onCreateReverse: () => void;
  saving: boolean;
  previewing: boolean;
  dirty: boolean;
  canPreview: boolean;
  canCreateReverse: boolean;
};

const selectClass = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";

export function FlowEditor({
  form,
  connections,
  onChange,
  onSave,
  onPreview,
  onCreateReverse,
  saving,
  previewing,
  dirty,
  canPreview,
  canCreateReverse,
}: FlowEditorProps) {
  const routeMissing = missingRouteFields(form);
  const sameBudget = isSameBudget(form);
  const canSave = routeMissing.length === 0 && !sameBudget;

  const set = (patch: Partial<SyncFlowFormState>) => onChange({ ...form, ...patch });
  const setFilter = (patch: Partial<SyncFlowFormState["filter"]>) =>
    onChange({ ...form, filter: { ...form.filter, ...patch } });
  const setTransform = (patch: Partial<SyncFlowFormState["transform"]>) =>
    onChange({ ...form, transform: { ...form.transform, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Flow name</span>
          <Input
            aria-label="Flow name"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Joint card → Personal budget"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Enabled"
            checked={form.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>

      {/* Route */}
      <div className="grid gap-3 sm:grid-cols-2">
        <EndpointPicker
          label="Source"
          endpoint={form.source}
          connections={connections}
          onChange={(source) => set({ source })}
        />
        <EndpointPicker
          label="Target"
          endpoint={form.target}
          connections={connections}
          onChange={(target) => set({ target })}
        />
      </div>

      {/* Transform */}
      <section className="flex flex-col gap-2 rounded-md border border-border p-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Transform</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Amount direction</span>
            <select
              aria-label="Amount direction"
              className={selectClass}
              value={form.transform.amountDirection}
              onChange={(e) => setTransform({ amountDirection: e.target.value as "reverse" | "same" })}
            >
              <option value="reverse">Reverse sign (default)</option>
              <option value="same">Same sign</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Missing payee</span>
            <select
              aria-label="Missing payee policy"
              className={selectClass}
              value={form.transform.missingPayee}
              onChange={(e) => setTransform({ missingPayee: e.target.value as "create" | "leave_empty" })}
            >
              <option value="create">Create payee (default)</option>
              <option value="leave_empty">Leave empty</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              aria-label="Add notes marker"
              checked={form.transform.notesMarkerEnabled}
              onChange={(e) => setTransform({ notesMarkerEnabled: e.target.checked })}
            />
            Add visible notes marker
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Categories match by name; missing categories are left empty. Eligible split lines are
          copied as separate transactions (no target split is created).
        </p>
      </section>

      {/* Filter */}
      <section className="flex flex-col gap-2 rounded-md border border-border p-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Filter</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Start date</span>
            <Input type="date" aria-label="Start date" value={form.filter.startDate} onChange={(e) => setFilter({ startDate: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">End date</span>
            <Input type="date" aria-label="End date" value={form.filter.endDate} onChange={(e) => setFilter({ endDate: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Amount sign</span>
            <select aria-label="Amount sign" className={selectClass} value={form.filter.amountSign} onChange={(e) => setFilter({ amountSign: e.target.value as "any" | "inflow" | "outflow" })}>
              <option value="any">Both</option>
              <option value="inflow">Inflow only</option>
              <option value="outflow">Outflow only</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Cleared</span>
            <select aria-label="Cleared filter" className={selectClass} value={form.filter.cleared} onChange={(e) => setFilter({ cleared: e.target.value as "any" | "cleared" | "uncleared" })}>
              <option value="any">Any</option>
              <option value="cleared">Cleared</option>
              <option value="uncleared">Uncleared</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Payee include (comma-separated)</span>
            <Input aria-label="Payee include" value={form.filter.payeeInclude} onChange={(e) => setFilter({ payeeInclude: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Category include (comma-separated)</span>
            <Input aria-label="Category include" value={form.filter.categoryInclude} onChange={(e) => setFilter({ categoryInclude: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className="text-muted-foreground">Notes contains</span>
            <Input aria-label="Notes contains" value={form.filter.notesContains} onChange={(e) => setFilter({ notesContains: e.target.value })} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Sync-generated transactions are always excluded to prevent loops.</p>
      </section>

      {/* Validation + actions */}
      {sameBudget && (
        <p className="text-sm text-destructive">Source and target must be different budgets/accounts (cross-budget only).</p>
      )}
      {routeMissing.length > 0 && (
        <p className="text-sm text-muted-foreground">Complete required fields to save: {routeMissing.join(", ")}.</p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={onSave} disabled={!canSave || saving}>
          <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save flow"}
        </Button>
        <Button variant="outline" onClick={onPreview} disabled={!canPreview || previewing}>
          <Play className="h-4 w-4" /> {previewing ? "Running preview…" : "Run preview"}
        </Button>
        <Button variant="ghost" onClick={onCreateReverse} disabled={!canCreateReverse} title="Create a mirror flow with source and target swapped">
          <ArrowLeftRight className="h-4 w-4" /> Create reverse flow
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes — save before previewing.</span>}
      </div>
    </div>
  );
}
