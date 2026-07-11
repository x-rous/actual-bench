"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Bell, Loader2, Play, Plus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NeedsConnectionsNotice } from "./NeedsConnectionsNotice";
import { FlowEditDialog } from "./FlowEditDialog";
import { FlowHeader } from "./FlowHeader";
import { FlowList } from "./FlowList";
import { PreviewPanel } from "./PreviewPanel";
import { RunHistory } from "./RunHistory";
import { useSyncFlows, useSyncFlowMutations } from "../hooks/useSyncFlows";
import { useSyncConnections, useFlowRuns, useLatestRunByFlow, useSyncRun } from "../hooks/useSyncData";
import { useApplyMutation, usePreviewMutation, useSafeSyncMutation } from "../hooks/useSyncOrchestration";
import { useSyncScheduler } from "../hooks/useSyncScheduler";
import {
  buildFlowPayload,
  emptyFlowForm,
  flowToFormState,
  isSelfSync,
  missingRouteFields,
  type SyncFlowFormState,
} from "../lib/flowForm";
import { selectableRowIds, syncKindOf, toPreviewRow } from "../lib/previewRows";
import { buildReverseFlowForm } from "../lib/reverseFlow";
import { relativeTime, toRunRow } from "../lib/runsView";
import type { SyncFlowRun } from "@/lib/app-db/types";
import type { DryRunError, DryRunSummary } from "@/lib/sync/previewOrchestrator";
import type { ApplyRunResult } from "@/lib/sync/applyOrchestrator";
import type { SafeSyncResult } from "@/lib/sync/safeSyncOrchestrator";

function deriveSummary(run: SyncFlowRun | undefined): DryRunSummary | null {
  const data = run?.summary?.data;
  if (!data) return null;
  const n = (key: string) => (typeof data[key] === "number" ? (data[key] as number) : 0);
  return {
    sourceTransactionsScanned: n("sourceTransactionsScanned"),
    generatedTransactionsExcluded: n("generatedTransactionsExcluded"),
    sourceItemsScanned: n("sourceItemsScanned"),
    sourceItemsFilteredOut: n("sourceItemsFilteredOut"),
    plannedItems: n("plannedItems"),
    createCandidates: n("createCandidates"),
    alreadySynced: n("alreadySynced"),
    duplicatesSkipped: n("duplicatesSkipped"),
    exactDuplicatesAutoMapped: n("exactDuplicatesAutoMapped"),
    sourceChangedWarnings: n("sourceChangedWarnings"),
    targetMarkerMatches: n("targetMarkerMatches"),
    blocked: n("blocked"),
  };
}

export function SyncView() {
  const connections = useSyncConnections();
  const flowsQuery = useSyncFlows();
  const flowIds = useMemo(() => (flowsQuery.data ?? []).map((f) => f.id), [flowsQuery.data]);
  const latestRunsQuery = useLatestRunByFlow(flowIds);
  const flowMutations = useSyncFlowMutations();
  const previewMutation = usePreviewMutation();
  const applyMutation = useApplyMutation();
  const safeSyncMutation = useSafeSyncMutation();

  // Client-side interval auto-sync (RD-054): only acts on flows whose policy is
  // `auto_sync_on_interval`, and only while their connections are unlocked here.
  useSyncScheduler({
    flows: flowsQuery.data ?? [],
    connections,
    latestRuns: latestRunsQuery.data ?? new Map(),
    onRunComplete: (flowId, result) => handleAutoRunComplete(flowId, result),
    onFlowPaused: (flowId) => pauseFlowForHealth(flowId),
  });

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [form, setForm] = useState<SyncFlowFormState>(() => emptyFlowForm());
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(emptyFlowForm()));
  const [editorOpen, setEditorOpen] = useState(false);
  const [view, setView] = useState<"flow" | "history">("flow");
  const [runId, setRunId] = useState<string | null>(null);
  const [historyRunId, setHistoryRunId] = useState<string | null>(null);
  const [isLivePreview, setIsLivePreview] = useState(false);
  const [previewError, setPreviewError] = useState<DryRunError | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyRunResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoNotice, setAutoNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // In history view we show the run the user picked; otherwise the live preview.
  const activeRunId = view === "history" ? historyRunId : runId;
  const runQuery = useSyncRun(activeRunId);
  const runsQuery = useFlowRuns(selectedFlowId);

  const flows = flowsQuery.data ?? [];
  const selectedFlow = flows.find((f) => f.id === selectedFlowId);
  const kind = syncKindOf(selectedFlow?.flowType ?? "transaction_sync");
  useEffect(() => {
    if (!selectedFlowId) return;
    const flow = flows.find((f) => f.id === selectedFlowId);
    if (!flow) return;
    const next = flowToFormState(flow, connections);
    setForm(next);
    setSavedSnapshot(JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlowId, flowsQuery.data]);

  const rows = useMemo(() => (runQuery.data?.items ?? []).map(toPreviewRow), [runQuery.data]);

  // Only a fresh, still-draft preview is appliable; runs opened from history are read-only.
  const runStatus = runQuery.data?.run.status;
  const readOnly = view === "history" ? true : !(isLivePreview && runStatus === "draft_preview");

  const seededRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (runId && runQuery.data && isLivePreview && !readOnly && seededRunRef.current !== runId) {
      seededRunRef.current = runId;
      setSelectedIds(new Set(selectableRowIds(rows)));
    }
  }, [runId, runQuery.data, rows, isLivePreview, readOnly]);

  const dirty = JSON.stringify(form) !== savedSnapshot;
  // Prefer the exact connection the form is bound to, but fall back to any live
  // connection reaching the same budget - so a flow keeps working after the mode
  // or server URL changes (a budget's id is stable across both).
  const resolveConn = (endpoint: SyncFlowFormState["source"]) =>
    connections.find((c) => c.id === endpoint.connectionId) ??
    (endpoint.budgetSyncId ? connections.find((c) => c.budgetSyncId === endpoint.budgetSyncId) : undefined);
  const sourceConn = resolveConn(form.source);
  const targetConn = resolveConn(form.target);
  const routeReady = missingRouteFields(form).length === 0 && !isSelfSync(form);
  const canPreview = !!selectedFlowId && !dirty && !!sourceConn && !!targetConn && routeReady;

  function previewBlockReason(): string | null {
    if (!selectedFlowId) return null;
    if (!sourceConn || !targetConn) return "Connect the source and target budgets to run a preview.";
    if (!routeReady) return "Finish configuring the route before previewing.";
    if (dirty) return "Save your changes before previewing.";
    return null;
  }

  function resetPreview() {
    setRunId(null);
    setHistoryRunId(null);
    setIsLivePreview(false);
    setPreviewError(null);
    setApplyResult(null);
    setActionError(null);
    setSelectedIds(new Set());
    seededRunRef.current = null;
    setView("flow");
  }

  function handleCreate() {
    setSelectedFlowId(null);
    const empty = emptyFlowForm();
    setForm(empty);
    setSavedSnapshot(JSON.stringify(empty));
    resetPreview();
    setEditorOpen(true);
  }

  function handleSelect(flowId: string) {
    setSelectedFlowId(flowId);
    resetPreview();
  }

  function closeEditor() {
    setForm(JSON.parse(savedSnapshot));
    setEditorOpen(false);
  }

  function handleSave() {
    const payload = buildFlowPayload(form, connections);
    if (selectedFlowId) {
      flowMutations.update.mutate(
        { flowId: selectedFlowId, payload },
        { onSuccess: () => { setSavedSnapshot(JSON.stringify(form)); setEditorOpen(false); } }
      );
    } else {
      flowMutations.create.mutate(payload, {
        onSuccess: ({ flow }) => { setSelectedFlowId(flow.id); setSavedSnapshot(JSON.stringify(form)); setEditorOpen(false); },
      });
    }
  }

  function handleToggleEnabled() {
    if (!selectedFlowId) return;
    const enabling = !form.enabled;
    // Re-enabling clears any health auto-pause so the scheduler can resume.
    const next = {
      ...form,
      enabled: enabling,
      automation: { ...form.automation, autoPausedAt: enabling ? null : form.automation.autoPausedAt },
    };
    setForm(next);
    flowMutations.update.mutate(
      { flowId: selectedFlowId, payload: buildFlowPayload(next, connections) },
      { onSuccess: () => { setSavedSnapshot(JSON.stringify(next)); latestRunsQuery.refetch(); } }
    );
  }

  function handleCreateReverse() {
    const reverse = buildReverseFlowForm(form, connections);
    flowMutations.create.mutate(buildFlowPayload(reverse, connections), {
      onSuccess: ({ flow }) => {
        setSelectedFlowId(flow.id);
        setForm(reverse);
        setSavedSnapshot(JSON.stringify(reverse));
        resetPreview();
      },
    });
  }

  function handleDelete() {
    if (!selectedFlowId) return;
    flowMutations.remove.mutate(selectedFlowId);
    setEditorOpen(false);
    setSelectedFlowId(null);
    const empty = emptyFlowForm();
    setForm(empty);
    setSavedSnapshot(JSON.stringify(empty));
    resetPreview();
  }

  function handlePreview() {
    if (!selectedFlowId || !sourceConn || !targetConn) return;
    resetPreview();
    previewMutation.mutate(
      { flowId: selectedFlowId, sourceConnection: sourceConn, targetConnection: targetConn, allowDisabled: true },
      {
        onSuccess: (result) => {
          if (result.status === "draft_preview") { setRunId(result.runId); setIsLivePreview(true); }
          else setPreviewError(result.error);
        },
        onError: (err) => setActionError(err instanceof Error ? err.message : "Preview could not be run."),
      }
    );
  }

  function flowName(flowId: string): string {
    return (flowsQuery.data ?? []).find((f) => f.id === flowId)?.name ?? "a flow";
  }

  // Notify on automated (scheduler) run outcomes: failures/partials, or items
  // left in the review queue. Successful, empty-queue runs stay quiet.
  function handleAutoRunComplete(flowId: string, result: SafeSyncResult) {
    latestRunsQuery.refetch();
    flowsQuery.refetch();
    const name = flowName(flowId);
    if (result.status === "failed" || result.status === "partial") {
      setAutoNotice(`Auto-sync for “${name}” ${result.status === "partial" ? "partially applied - some items failed" : "failed"}.`);
    } else if (result.status === "preview_failed") {
      setAutoNotice(`Auto-sync preview for “${name}” failed: ${result.error.message}`);
    } else if (result.status === "applied" || result.status === "no_safe_items") {
      const s = result.preview;
      const queued = s.duplicatesSkipped + s.sourceChangedWarnings + s.blocked;
      if (queued > 0) setAutoNotice(`Auto-sync for “${name}” left ${queued} item${queued === 1 ? "" : "s"} to review.`);
    }
  }

  // Flow health: persist an auto-pause (disable + timestamp) after repeated
  // automated failures, so the scheduler stops until the user re-enables it.
  function pauseFlowForHealth(flowId: string) {
    const flow = (flowsQuery.data ?? []).find((f) => f.id === flowId);
    if (!flow) return;
    const paused = flowToFormState(flow, connections);
    paused.enabled = false;
    paused.automation = { ...paused.automation, autoPausedAt: new Date().toISOString() };
    flowMutations.update.mutate(
      { flowId, payload: buildFlowPayload(paused, connections) },
      { onSuccess: () => { flowsQuery.refetch(); latestRunsQuery.refetch(); } }
    );
    setAutoNotice(`Auto-sync paused for “${flow.name}” after repeated failures. Re-enable it when you're ready.`);
  }

  function handleRunSafeSyncNow() {
    if (!selectedFlowId || !sourceConn || !targetConn) return;
    setActionError(null);
    safeSyncMutation.mutate(
      { flowId: selectedFlowId, sourceConnection: sourceConn, targetConnection: targetConn, allowDisabled: true },
      {
        onSuccess: (result) => {
          runsQuery.refetch();
          flowsQuery.refetch();
          latestRunsQuery.refetch();
          if (result.status === "skipped_manual_policy") {
            setActionError("This flow is set to manual review, so safe sync did not run. Switch its policy to auto to enable it.");
            return;
          }
          if (result.status === "preview_failed") {
            setActionError(`Safe sync preview failed: ${result.error.message}`);
            return;
          }
          // Show the resulting (already-applied) run read-only, including its review queue.
          setView("history");
          setHistoryRunId(result.runId);
        },
        onError: (err) => setActionError(err instanceof Error ? err.message : "Safe sync could not be run."),
      }
    );
  }

  function handleRetryFailed() {
    if (!historyRunId || !targetConn) return;
    setActionError(null);
    applyMutation.mutate(
      { runId: historyRunId, targetConnection: targetConn, selection: { selection: "retry_failed" } },
      {
        onSuccess: () => { runQuery.refetch(); runsQuery.refetch(); latestRunsQuery.refetch(); flowsQuery.refetch(); },
        onError: (err) => setActionError(err instanceof Error ? err.message : "Retry could not be completed."),
      }
    );
  }

  function handleApply() {
    if (!runId || !targetConn) return;
    setActionError(null);
    applyMutation.mutate(
      { runId, targetConnection: targetConn, selection: { selectedItemIds: [...selectedIds] } },
      {
        onSuccess: (result) => { setApplyResult(result); runQuery.refetch(); runsQuery.refetch(); flowsQuery.refetch(); latestRunsQuery.refetch(); },
        onError: (err) => setActionError(err instanceof Error ? err.message : "Sync could not be completed."),
      }
    );
  }

  const summary = deriveSummary(runQuery.data?.run);
  const previewedAt = runQuery.data?.run.startedAt ?? null;
  const blockReason = previewBlockReason();

  // One connection is enough for a same-budget flow (account → account); a
  // second budget is only needed for cross-budget sync.
  if (connections.length < 1) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="p-6"><NeedsConnectionsNotice /></div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border">
        <FlowList
          flows={flows}
          selectedFlowId={selectedFlowId}
          latestRuns={latestRunsQuery.data ?? new Map()}
          connections={connections}
          onSelect={handleSelect}
          onCreate={handleCreate}
        />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!selectedFlowId ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/50">
              <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Budget File Sync</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Copy transactions, payees, or categories from one budget to another - preview first, apply what you choose. Pick a flow on the left, or create one.
              </p>
            </div>
            <Button size="sm" onClick={handleCreate}><Plus className="h-4 w-4" /> New sync flow</Button>
          </div>
        ) : (
          <>
            <FlowHeader
              form={form}
              connections={connections}
              previewing={previewMutation.isPending}
              canPreview={canPreview}
              previewDisabledReason={blockReason}
              showRunSafeSync={form.automation.reviewPolicy !== "manual_preview_required"}
              canRunSafeSync={!!sourceConn && !!targetConn && routeReady && !dirty}
              runningSafeSync={safeSyncMutation.isPending}
              onToggleEnabled={handleToggleEnabled}
              onRunPreview={handlePreview}
              onRunSafeSyncNow={handleRunSafeSyncNow}
              onEdit={() => setEditorOpen(true)}
              onCreateReverse={handleCreateReverse}
              onShowHistory={() => { setView("history"); setHistoryRunId(null); }}
            />

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {(actionError || autoNotice) && (
                <div className="flex shrink-0 flex-col gap-3 px-5 pt-5">
                  {actionError && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <span>{actionError}</span>
                    </div>
                  )}
                  {autoNotice && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/70 px-3.5 py-2.5 text-sm dark:bg-amber-950/20">
                      <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="flex-1">{autoNotice}</span>
                      <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setAutoNotice(null)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}
              {view === "history" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
                    <h3 className="text-[15px] font-semibold">Run history</h3>
                    <Button size="sm" variant="outline" onClick={() => { setView("flow"); setHistoryRunId(null); }}>
                      <ArrowLeft className="h-4 w-4" /> Back to flow
                    </Button>
                  </div>
                  {historyRunId && runQuery.data ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      <div className="flex shrink-0 flex-col gap-3 px-5 pb-3">
                      <button
                        type="button"
                        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setHistoryRunId(null)}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" /> All runs
                      </button>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{toRunRow(runQuery.data.run).statusLabel}</Badge>
                        <span className="text-xs text-muted-foreground" title={new Date(toRunRow(runQuery.data.run).when).toLocaleString()}>{relativeTime(toRunRow(runQuery.data.run).when)}</span>
                        {(runQuery.data.run.status === "partial" || runQuery.data.run.status === "failed") && !!targetConn && (
                          <Button size="sm" variant="outline" className="ml-auto text-xs" onClick={handleRetryFailed} disabled={applyMutation.isPending}>
                            {applyMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {applyMutation.isPending ? "Retrying…" : "Retry failed"}
                          </Button>
                        )}
                      </div>
                      </div>
                      <PreviewPanel
                        kind={kind}
                        summary={summary}
                        previewError={null}
                        rows={rows}
                        selectedIds={new Set()}
                        readOnly
                        previewedAt={previewedAt}
                        onToggle={() => {}}
                        onSelectAllSafeNew={() => {}}
                        onClearSelection={() => {}}
                        onApply={() => {}}
                        applying={false}
                        applyResult={null}
                        runId={historyRunId}
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5">
                      <RunHistory runs={runsQuery.data ?? []} onSelectRun={(id) => setHistoryRunId(id)} />
                    </div>
                  )}
                </div>
              ) : previewMutation.isPending ? (
                <div className="m-5 flex flex-col items-center gap-3 rounded-md border border-border bg-background px-6 py-16 text-center shadow-sm">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <h3 className="text-base font-semibold">Previewing…</h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Reading the source budget, then switching to the target to compare. This can take a moment on large budgets.
                  </p>
                </div>
              ) : runId || previewError ? (
                <PreviewPanel
                  kind={kind}
                  summary={summary}
                  previewError={previewError}
                  rows={rows}
                  selectedIds={selectedIds}
                  readOnly={readOnly}
                  previewedAt={previewedAt}
                  onToggle={(id) => setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                  onSelectAllSafeNew={() => setSelectedIds(new Set(selectableRowIds(rows)))}
                  onClearSelection={() => setSelectedIds(new Set())}
                  onApply={handleApply}
                  applying={applyMutation.isPending}
                  applyResult={applyResult}
                  runId={activeRunId}
                />
              ) : (
                <div className="m-5 flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-background px-6 py-16 text-center">
                  <Play className="h-6 w-6 text-muted-foreground" />
                  <h3 className="text-base font-semibold">See what will change first</h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    <strong>Preview</strong> (top right) builds a change plan - every {kind === "transaction" ? "transaction" : kind} that would be created in{" "}
                    <strong>{form.target.budgetName || "the target"}</strong> from{" "}
                    <strong>{form.source.budgetName || "the source"}</strong> - with nothing written to Actual until you review and sync.
                  </p>
                  {blockReason && <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{blockReason}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <FlowEditDialog
        open={editorOpen}
        onOpenChange={(open) => (open ? setEditorOpen(true) : closeEditor())}
        form={form}
        connections={connections}
        onChange={setForm}
        onSave={handleSave}
        onDelete={handleDelete}
        saving={flowMutations.create.isPending || flowMutations.update.isPending}
        isNew={!selectedFlowId}
      />
    </div>
  );
}
