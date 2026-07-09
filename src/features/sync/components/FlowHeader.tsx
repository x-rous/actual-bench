"use client";

import { ArrowLeftRight, ArrowRight, History, Loader2, Pencil, Play, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BrowserApiConnection } from "@/store/connection";
import type { SyncEndpointForm, SyncFlowFormState } from "../lib/flowForm";

type FlowHeaderProps = {
  form: SyncFlowFormState;
  connections: BrowserApiConnection[];
  previewing: boolean;
  canPreview: boolean;
  /** Shown as a tooltip on the disabled Run preview button. */
  previewDisabledReason: string | null;
  /** Show the "Run safe sync now" action (flow opted into automation). */
  showRunSafeSync: boolean;
  canRunSafeSync: boolean;
  runningSafeSync: boolean;
  onToggleEnabled: () => void;
  onRunPreview: () => void;
  onRunSafeSyncNow: () => void;
  onEdit: () => void;
  onCreateReverse: () => void;
  onShowHistory: () => void;
};

function hostOf(connection: BrowserApiConnection | undefined): string {
  if (!connection) return "connection not available";
  try {
    return new URL(connection.baseUrl).host;
  } catch {
    return connection.baseUrl;
  }
}

function Endpoint({ endpoint, connection }: { endpoint: SyncEndpointForm; connection?: BrowserApiConnection }) {
  return (
    <div className="flex w-[22rem] shrink-0 flex-col gap-0.5 rounded-md border border-border bg-muted/30 px-3 py-2">
      <span className={cn("truncate font-mono text-[11px]", connection ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
        {hostOf(connection)}
      </span>
      <span className="truncate text-[13px] font-semibold">
        {endpoint.budgetName || endpoint.budgetSyncId || "-"}
        <span className="font-medium text-muted-foreground"> / {endpoint.accountName || "-"}</span>
      </span>
    </div>
  );
}

function automationChip(form: SyncFlowFormState): string {
  switch (form.automation.reviewPolicy) {
    case "auto_apply_safe_only":
      return "Auto-apply safe";
    case "auto_sync_on_interval":
      return `Auto-sync ${form.automation.intervalMinutes}m`;
    default:
      return "Manual";
  }
}

function summaryChips(form: SyncFlowFormState): string[] {
  const chips = ["Transactions", automationChip(form)]; // flow type + automation policy
  chips.push(form.transform.amountDirection === "reverse" ? "Reverse sign" : "Same sign");
  chips.push(form.transform.missingPayee === "create" ? "Create missing payees" : "Leave payee empty");
  if (form.transform.notesMarkerEnabled) chips.push("Notes marker on");
  if (form.filter.startDate) chips.push(`From ${form.filter.startDate}`);
  if (form.filter.amountSign === "inflow") chips.push("Inflow only");
  if (form.filter.amountSign === "outflow") chips.push("Outflow only");
  return chips;
}

export function FlowHeader({
  form,
  connections,
  previewing,
  canPreview,
  previewDisabledReason,
  showRunSafeSync,
  canRunSafeSync,
  runningSafeSync,
  onToggleEnabled,
  onRunPreview,
  onRunSafeSyncNow,
  onEdit,
  onCreateReverse,
  onShowHistory,
}: FlowHeaderProps) {
  const sourceConn = connections.find((c) => c.id === form.source.connectionId);
  const targetConn = connections.find((c) => c.id === form.target.connectionId);

  return (
    <header className="flex h-28 shrink-0 flex-col justify-center gap-2 border-b border-border px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Endpoint endpoint={form.source} connection={sourceConn} />
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          <Endpoint endpoint={form.target} connection={targetConn} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="text-xs"
            onClick={onRunPreview}
            disabled={!canPreview || previewing}
            title={!canPreview && previewDisabledReason ? previewDisabledReason : undefined}
          >
            <Play className="h-3.5 w-3.5" /> {previewing ? "Previewing…" : "Sync Preview"}
          </Button>
          {showRunSafeSync && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={onRunSafeSyncNow}
              disabled={!canRunSafeSync || runningSafeSync}
              title="Preview and apply only safe changes now; uncertain items go to the review queue"
            >
              {runningSafeSync ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {runningSafeSync ? "Syncing…" : "Run safe sync now"}
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-xs" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit Flow
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={onCreateReverse} title="Create a mirror flow with source and target swapped">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Create Reverse Flow
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={onShowHistory}>
            <History className="h-3.5 w-3.5" /> History
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          aria-label="Enabled"
          onClick={onToggleEnabled}
          className={cn(
            "relative h-[17px] w-[30px] shrink-0 rounded-full transition-colors",
            form.enabled ? "bg-green-500" : "bg-muted-foreground/50"
          )}
        >
          <span className={cn("absolute top-0.5 h-[13px] w-[13px] rounded-full bg-white transition-all", form.enabled ? "left-[15px]" : "left-0.5")} />
        </button>
        <span className="mr-1 text-xs text-muted-foreground">{form.enabled ? "Enabled" : "Disabled"}</span>
        {!form.enabled && form.automation.autoPausedAt && (
          <Badge variant="status-warning" className="text-[11px] font-normal" title="Auto-sync paused after repeated failures. Re-enable to resume.">
            Auto-paused
          </Badge>
        )}
        {summaryChips(form).map((chip, i) => (
          <Badge key={i} variant="secondary" className="text-[11px] font-normal">
            {chip}
          </Badge>
        ))}
      </div>
    </header>
  );
}
