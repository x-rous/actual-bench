"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Play, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DirectOnlyNotice } from "./DirectOnlyNotice";
import { FlowEditDialog } from "./FlowEditDialog";
import { FlowHeader } from "./FlowHeader";
import { FlowList } from "./FlowList";
import { PreviewPanel } from "./PreviewPanel";
import { RunHistory } from "./RunHistory";
import { useSyncFlows, useSyncFlowMutations } from "../hooks/useSyncFlows";
import { useDirectConnections, useFlowRuns, useLatestRunByFlow, useSyncRun } from "../hooks/useSyncData";
import { useApplyMutation, usePreviewMutation } from "../hooks/useSyncOrchestration";
import {
  buildFlowPayload,
  emptyFlowForm,
  flowToFormState,
  isSameBudget,
  missingRouteFields,
  type SyncFlowFormState,
} from "../lib/flowForm";
import { selectableRowIds, toPreviewRow } from "../lib/previewRows";
import { buildReverseFlowForm } from "../lib/reverseFlow";
import { relativeTime, toRunRow } from "../lib/runsView";
import type { SyncFlowRun } from "@/lib/app-db/types";
import type { DryRunError, DryRunSummary } from "@/lib/sync/previewOrchestrator";
import type { ApplyRunResult } from "@/lib/sync/applyOrchestrator";

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
    sourceChangedWarnings: n("sourceChangedWarnings"),
    targetMarkerMatches: n("targetMarkerMatches"),
    blocked: n("blocked"),
  };
}

export function SyncView() {
  const connections = useDirectConnections();
  const flowsQuery = useSyncFlows();
  const latestRunsQuery = useLatestRunByFlow();
  const flowMutations = useSyncFlowMutations();
  const previewMutation = usePreviewMutation();
  const applyMutation = useApplyMutation();

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // In history view we show the run the user picked; otherwise the live preview.
  const activeRunId = view === "history" ? historyRunId : runId;
  const runQuery = useSyncRun(activeRunId);
  const runsQuery = useFlowRuns(selectedFlowId);

  const flows = flowsQuery.data ?? [];
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
  const sourceConn = connections.find((c) => c.id === form.source.connectionId);
  const targetConn = connections.find((c) => c.id === form.target.connectionId);
  const routeReady = missingRouteFields(form).length === 0 && !isSameBudget(form);
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
    const next = { ...form, enabled: !form.enabled };
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
  const blockReason = previewBlockReason();

  if (connections.length < 2) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="p-6"><DirectOnlyNotice /></div>
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
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Budget File Sync - select a sync flow, or create one to get started.
          </div>
        ) : (
          <>
            <FlowHeader
              form={form}
              connections={connections}
              previewing={previewMutation.isPending}
              canPreview={canPreview}
              previewDisabledReason={blockReason}
              onToggleEnabled={handleToggleEnabled}
              onRunPreview={handlePreview}
              onEdit={() => setEditorOpen(true)}
              onCreateReverse={handleCreateReverse}
              onShowHistory={() => { setView("history"); setHistoryRunId(null); }}
            />

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {actionError && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span>{actionError}</span>
                </div>
              )}
              {view === "history" ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold">Run history</h3>
                    <Button size="sm" variant="outline" onClick={() => { setView("flow"); setHistoryRunId(null); }}>
                      <ArrowLeft className="h-4 w-4" /> Back to flow
                    </Button>
                  </div>
                  {historyRunId && runQuery.data ? (
                    <div className="flex flex-col gap-3">
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
                      </div>
                      <PreviewPanel
                        summary={summary}
                        previewError={null}
                        rows={rows}
                        selectedIds={new Set()}
                        readOnly
                        onToggle={() => {}}
                        onSelectAllSafeNew={() => {}}
                        onClearSelection={() => {}}
                        onApply={() => {}}
                        applying={false}
                        applyResult={null}
                      />
                    </div>
                  ) : (
                    <RunHistory runs={runsQuery.data ?? []} onSelectRun={(id) => setHistoryRunId(id)} />
                  )}
                </div>
              ) : previewMutation.isPending ? (
                <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-background px-6 py-16 text-center shadow-sm">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <h3 className="text-base font-semibold">Previewing…</h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Reading the source budget, then switching to the target to compare. This can take a moment on large budgets.
                  </p>
                </div>
              ) : runId || previewError ? (
                <PreviewPanel
                  summary={summary}
                  previewError={previewError}
                  rows={rows}
                  selectedIds={selectedIds}
                  readOnly={readOnly}
                  onToggle={(id) => setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                  onSelectAllSafeNew={() => setSelectedIds(new Set(selectableRowIds(rows)))}
                  onClearSelection={() => setSelectedIds(new Set())}
                  onApply={handleApply}
                  applying={applyMutation.isPending}
                  applyResult={applyResult}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-background px-6 py-14 text-center shadow-sm">
                  <Play className="h-6 w-6 text-muted-foreground" />
                  <h3 className="text-base font-semibold">Preview this flow</h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Use <strong>Sync Preview</strong> (top right) to see exactly which transactions would be created in{" "}
                    <strong>{form.target.budgetName || "the target"} / {form.target.accountName || "account"}</strong> from{" "}
                    <strong>{form.source.budgetName || "the source"} / {form.source.accountName || "account"}</strong>. Nothing is written to Actual until you review and sync.
                  </p>
                  {blockReason && <p className="text-xs text-muted-foreground">{blockReason}</p>}
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
