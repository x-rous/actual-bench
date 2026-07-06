"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { DirectOnlyNotice } from "./DirectOnlyNotice";
import { FlowEditor } from "./FlowEditor";
import { FlowList } from "./FlowList";
import { PreviewPanel } from "./PreviewPanel";
import { RunHistory } from "./RunHistory";
import { useSyncFlows, useSyncFlowMutations } from "../hooks/useSyncFlows";
import { useDirectConnections, useFlowRuns, useSyncRun } from "../hooks/useSyncData";
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
  const flowMutations = useSyncFlowMutations();
  const previewMutation = usePreviewMutation();
  const applyMutation = useApplyMutation();

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [form, setForm] = useState<SyncFlowFormState>(() => emptyFlowForm());
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(emptyFlowForm()));
  const [runId, setRunId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<DryRunError | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyRunResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const runQuery = useSyncRun(runId);
  const runsQuery = useFlowRuns(selectedFlowId);

  // Load editor form when a saved flow is selected.
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

  const rows = useMemo(
    () => (runQuery.data?.items ?? []).map(toPreviewRow),
    [runQuery.data]
  );

  // Default-select all safe new rows once per loaded run.
  const seededRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (runId && runQuery.data && seededRunRef.current !== runId) {
      seededRunRef.current = runId;
      setSelectedIds(new Set(selectableRowIds(rows)));
    }
  }, [runId, runQuery.data, rows]);

  const dirty = JSON.stringify(form) !== savedSnapshot;
  const sourceConn = connections.find((c) => c.id === form.source.connectionId);
  const targetConn = connections.find((c) => c.id === form.target.connectionId);
  const canPreview =
    !!selectedFlowId &&
    !dirty &&
    !!sourceConn &&
    !!targetConn &&
    !isSameBudget(form) &&
    missingRouteFields(form).length === 0;

  function resetPreview() {
    setRunId(null);
    setPreviewError(null);
    setApplyResult(null);
    setSelectedIds(new Set());
    seededRunRef.current = null;
  }

  function handleCreate() {
    setSelectedFlowId(null);
    const empty = emptyFlowForm();
    setForm(empty);
    setSavedSnapshot(JSON.stringify(empty));
    resetPreview();
  }

  function handleSelect(flowId: string) {
    setSelectedFlowId(flowId);
    resetPreview();
  }

  function handleDelete(flowId: string) {
    flowMutations.remove.mutate(flowId);
    if (flowId === selectedFlowId) handleCreate();
  }

  function handleSave() {
    const payload = buildFlowPayload(form, connections);
    if (selectedFlowId) {
      flowMutations.update.mutate(
        { flowId: selectedFlowId, payload },
        { onSuccess: () => setSavedSnapshot(JSON.stringify(form)) }
      );
    } else {
      flowMutations.create.mutate(payload, {
        onSuccess: ({ flow }) => {
          setSelectedFlowId(flow.id);
          setSavedSnapshot(JSON.stringify(form));
        },
      });
    }
  }

  function handlePreview() {
    if (!selectedFlowId || !sourceConn || !targetConn) return;
    resetPreview();
    previewMutation.mutate(
      { flowId: selectedFlowId, sourceConnection: sourceConn, targetConnection: targetConn, allowDisabled: true },
      {
        onSuccess: (result) => {
          if (result.status === "draft_preview") {
            setRunId(result.runId);
          } else {
            setPreviewError(result.error);
          }
        },
      }
    );
  }

  function handleApply() {
    if (!runId || !targetConn) return;
    applyMutation.mutate(
      { runId, targetConnection: targetConn, selection: { selectedItemIds: [...selectedIds] } },
      {
        onSuccess: (result) => {
          setApplyResult(result);
          runQuery.refetch();
          runsQuery.refetch();
          flowsQuery.refetch();
        },
      }
    );
  }

  const summary = deriveSummary(runQuery.data?.run);

  return (
    <PageLayout title="Budget File Sync" count={`${flows.length} flow${flows.length === 1 ? "" : "s"}`}>
      {connections.length < 2 ? (
        <div className="p-4">
          <DirectOnlyNotice />
        </div>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-[18rem_1fr]">
          <aside className="flex flex-col gap-4">
            <FlowList
              flows={flows}
              selectedFlowId={selectedFlowId}
              onSelect={handleSelect}
              onCreate={handleCreate}
              onDelete={handleDelete}
            />
            <div>
              <h2 className="mb-2 text-sm font-semibold">Run history</h2>
              <RunHistory runs={runsQuery.data ?? []} onSelectRun={(id) => { setRunId(id); seededRunRef.current = id; }} />
            </div>
          </aside>

          <main className="flex min-w-0 flex-col gap-6">
            <FlowEditor
              form={form}
              connections={connections}
              onChange={setForm}
              onSave={handleSave}
              onPreview={handlePreview}
              saving={flowMutations.create.isPending || flowMutations.update.isPending}
              previewing={previewMutation.isPending}
              dirty={dirty}
              canPreview={canPreview}
            />
            <PreviewPanel
              summary={summary}
              previewError={previewError}
              rows={rows}
              selectedIds={selectedIds}
              onToggle={(id) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onSelectAllSafeNew={() => setSelectedIds(new Set(selectableRowIds(rows)))}
              onApply={handleApply}
              applying={applyMutation.isPending}
              applyResult={applyResult}
            />
          </main>
        </div>
      )}
    </PageLayout>
  );
}
