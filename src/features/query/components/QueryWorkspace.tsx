"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore, selectHasChanges } from "@/store/staged";
import { runQuery } from "@/lib/api/query";
import { cn } from "@/lib/utils";
import { QueryEditor } from "./QueryEditor";
import { QueryResults } from "./QueryResults";
import { HistoryPanel, SavedPanel } from "./SavedQueryList";
import { SaveQueryDialog } from "./SaveQueryDialog";
import { QueryExamplesPanel } from "./QueryExamplesPanel";
import { QueryExplanationPanel } from "./QueryExplanationPanel";
import { QueryLintPanel } from "./QueryLintPanel";
import { QueryReferenceDialog } from "./QueryReferenceDialog";
import { parseQuery, lintQuery } from "../lib/queryValidation";
import { formatJson } from "../lib/queryFormatting";
import { explainQuery } from "../lib/queryExplain";
import {
  getHistory,
  addToHistory,
  clearHistory,
  getSavedQueries,
  saveQuery,
  updateSavedQuery,
  deleteSavedQuery,
  duplicateSavedQuery,
} from "../lib/queryStorage";
import type { SavedQuery, QueryHistoryEntry, LintWarning, LastExecutedRequest } from "../types";

const DEFAULT_QUERY = JSON.stringify(
  {
    ActualQLquery: {
      table: "transactions",
      options: { splits: "inline" },
      select: ["date", "payee.name", "category.name", "amount", "notes"],
      orderBy: [{ date: "desc" }],
      limit: 10,
    },
  },
  null,
  2
);

// ─── Left panel tab layout ────────────────────────────────────────────────────

type LeftTab = "examples" | "history" | "saved";

interface LeftPanelProps {
  history: QueryHistoryEntry[];
  savedQueries: SavedQuery[];
  onLoad: (query: string) => void;
  onLoadAndRun: (query: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onClearHistory: () => void;
}

function LeftPanel({
  history,
  savedQueries,
  onLoad,
  onLoadAndRun,
  onDelete,
  onToggleFavorite,
  onRename,
  onDuplicate,
  onClearHistory,
}: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<LeftTab>("examples");

  const tabs: { id: LeftTab; label: string; count?: number }[] = [
    { id: "examples", label: "Examples" },
    { id: "history", label: "History", count: history.length || undefined },
    {
      id: "saved",
      label: "Saved",
      count: savedQueries.length || undefined,
    },
  ];

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-r border-border">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 px-2 py-2 text-[12px] font-medium transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-primary text-foreground"
                : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] leading-none tabular-nums",
                  activeTab === tab.id
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab header (for panels that need an action bar) */}
      {activeTab === "history" && history.length > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground/60">
            {history.length} entr{history.length !== 1 ? "ies" : "y"}
          </span>
          <button
            type="button"
            title="Clear history"
            onClick={onClearHistory}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-destructive"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        </div>
      )}

      {activeTab === "saved" && savedQueries.length > 0 && (
        <div className="flex shrink-0 items-center border-b border-border/60 px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground/60">
            {savedQueries.length} saved · local to this browser
          </span>
        </div>
      )}

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "examples" && (
          <QueryExamplesPanel onInsert={onLoad} />
        )}
        {activeTab === "history" && (
          <HistoryPanel
            history={history}
            onLoad={onLoad}
            onLoadAndRun={onLoadAndRun}
          />
        )}
        {activeTab === "saved" && (
          <SavedPanel
            savedQueries={savedQueries}
            onLoad={onLoad}
            onLoadAndRun={onLoadAndRun}
            onDelete={onDelete}
            onToggleFavorite={onToggleFavorite}
            onRename={onRename}
            onDuplicate={onDuplicate}
          />
        )}
      </div>

      {/* Footer — only shown on Examples tab */}
      {activeTab === "examples" && (
        <div className="shrink-0 border-t border-border px-3 py-2 text-[10px] text-muted-foreground/50">
          Click an example to load it into the editor.
        </div>
      )}
    </aside>
  );
}

export function QueryWorkspace() {
  const connection = useConnectionStore(selectActiveInstance);
  const hasChanges = useStagedStore(selectHasChanges);

  // ─── Core state ───────────────────────────────────────────────────────────────
  const [editorValue, setEditorValue] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<unknown | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [lintWarnings, setLintWarnings] = useState<LintWarning[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDefaultName, setSaveDefaultName] = useState("");
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);

  // ─── Phase 2 state ────────────────────────────────────────────────────────────
  const [lastExecutedRequest, setLastExecutedRequest] =
    useState<LastExecutedRequest | null>(null);
  const [execTime, setExecTime] = useState<number | null>(null);
  const [payloadBytes, setPayloadBytes] = useState<number | null>(null);
  const [explainLines, setExplainLines] = useState<string[]>([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);

  // ─── Resizable split ──────────────────────────────────────────────────────────
  const EDITOR_HEIGHT_KEY = "actualql-editor-height";
  const MIN_HEIGHT = 120;
  const DEFAULT_HEIGHT = 220;

  const [editorHeight, setEditorHeight] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_HEIGHT;
    try {
      const stored = sessionStorage.getItem(EDITOR_HEIGHT_KEY);
      if (!stored) return DEFAULT_HEIGHT;
      const parsed = parseInt(stored, 10);
      return isNaN(parsed) ? DEFAULT_HEIGHT : Math.max(MIN_HEIGHT, parsed);
    } catch {
      return DEFAULT_HEIGHT;
    }
  });

  const mainAreaRef = useRef<HTMLDivElement>(null);
  // Mirror editorHeight in a ref so the drag closure always reads the latest value.
  const editorHeightRef = useRef(editorHeight);
  // Snapshot of editor content before a programmatic load — enables toast + Ctrl+Z undo.
  const prevEditorValueRef = useRef<string>("");
  // Guards against overlapping concurrent query executions.
  const isRunningRef = useRef(false);
  // Mirrors the active connection so in-flight callbacks can detect stale responses.
  const connectionRef = useRef(connection);
  useEffect(() => { editorHeightRef.current = editorHeight; }, [editorHeight]);
  useEffect(() => { connectionRef.current = connection; }, [connection]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = editorHeightRef.current;

    function onMove(ev: MouseEvent) {
      const containerH = mainAreaRef.current?.clientHeight ?? 600;
      const next = Math.max(
        MIN_HEIGHT,
        Math.min(startHeight + (ev.clientY - startY), containerH - MIN_HEIGHT)
      );
      setEditorHeight(next);
    }

    function onUp() {
      try {
        sessionStorage.setItem(EDITOR_HEIGHT_KEY, String(editorHeightRef.current));
      } catch {
        // Storage unavailable — height is already correct in state, just don't persist.
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ─── Init ─────────────────────────────────────────────────────────────────────

  // When the connection changes, clear any result/error state that belongs to
  // the previous budget, then load the new budget's history and saved queries.
  useEffect(() => {
    setResult(null);
    setRunError(null);
    setLastExecutedRequest(null);
    setExecTime(null);
    setPayloadBytes(null);
    if (!connection) return;
    setHistory(getHistory(connection.budgetSyncId));
    setSavedQueries(getSavedQueries(connection.budgetSyncId));
  }, [connection]);

  // Lint as the user types; also keeps the inline parse-error banner in sync.
  useEffect(() => {
    const parsed = parseQuery(editorValue);
    if (parsed instanceof Error) {
      setParseError(parsed.message);
      setLintWarnings([]);
      return;
    }
    setParseError(null);
    setLintWarnings(lintQuery(parsed.inner));
  }, [editorValue]);

  // ─── Core execution ──────────────────────────────────────────────────────────

  const executeQuery = useCallback(
    async (queryString: string) => {
      if (!connection) {
        toast.error("No active connection.");
        return;
      }
      // Prevent overlapping concurrent executions.
      if (isRunningRef.current) return;

      const parsed = parseQuery(queryString);
      if (parsed instanceof Error) {
        setParseError(parsed.message);
        return;
      }
      setParseError(null);
      isRunningRef.current = true;
      setIsRunning(true);
      setRunError(null);
      setShowExplanation(false);

      // Snapshot the budget ID before the async gap so we can detect connection
      // changes that occur while the request is in flight.
      const capturedBudgetId = connection.budgetSyncId;

      // Snapshot the current request before the async gap so it is available
      // for cURL generation on both the success and the error path.
      setLastExecutedRequest({
        query: parsed.inner,
        rawQuery: queryString,
        baseUrl: connection.baseUrl,
        budgetSyncId: connection.budgetSyncId,
        apiKey: connection.apiKey,
        encryptionPassword: connection.encryptionPassword,
      });

      const start = Date.now();
      try {
        const response = await runQuery<{ data: unknown }>(
          connection,
          parsed.body
        );
        // Discard the response if the active connection changed mid-flight.
        if (connectionRef.current?.budgetSyncId !== capturedBudgetId) return;

        const elapsed = Date.now() - start;
        setResult(response.data);
        setExecTime(elapsed);
        setPayloadBytes(
          new TextEncoder().encode(JSON.stringify(response.data)).length
        );
        addToHistory(connection.budgetSyncId, queryString, {
          execTime: elapsed,
          rowCount: Array.isArray(response.data) ? response.data.length : undefined,
        });
        setHistory(getHistory(connection.budgetSyncId));
      } catch (err) {
        if (connectionRef.current?.budgetSyncId !== capturedBudgetId) return;
        setExecTime(Date.now() - start);
        setPayloadBytes(null);
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : "Query failed.";
        setRunError(msg);
        setResult(null);
      } finally {
        isRunningRef.current = false;
        setIsRunning(false);
      }
    },
    [connection]
  );

  // ─── Editor actions ──────────────────────────────────────────────────────────

  const handleRun = useCallback(
    () => executeQuery(editorValue),
    [executeQuery, editorValue]
  );

  const handleFormat = useCallback(() => {
    setEditorValue((prev) => formatJson(prev));
  }, []);

  const handleSave = useCallback(() => {
    const parsed = parseQuery(editorValue);
    setSaveDefaultName(
      parsed instanceof Error ? "" : `${parsed.inner.table} query`
    );
    setSaveDialogOpen(true);
  }, [editorValue]);

  const handleExplain = useCallback(() => {
    const parsed = parseQuery(editorValue);
    if (parsed instanceof Error) {
      toast.error("Fix the query error before explaining.");
      return;
    }
    setExplainLines(explainQuery(parsed.inner));
    setShowExplanation(true);
  }, [editorValue]);

  const handleCopyQuery = useCallback(() => {
    navigator.clipboard
      .writeText(editorValue)
      .then(() => toast.success("Query copied to clipboard"))
      .catch(() => toast.error("Failed to copy"));
  }, [editorValue]);

  // Restores the editor to the state it was in before the last programmatic load.
  // Called either by the toast Undo button or the Ctrl+Z intercept in JsonEditor.
  const handleUndo = useCallback((): boolean => {
    const prev = prevEditorValueRef.current;
    if (!prev) return false;
    prevEditorValueRef.current = "";
    setEditorValue(prev);
    setParseError(null);
    toast.dismiss();
    return true;
  }, []);

  function handleSaveConfirm(name: string) {
    if (!connection) return;
    saveQuery(connection.budgetSyncId, name, editorValue);
    setSavedQueries(getSavedQueries(connection.budgetSyncId));
    toast.success(`Saved "${name}"`);
  }

  // ─── Sidebar actions ─────────────────────────────────────────────────────────

  function handleLoad(query: string) {
    prevEditorValueRef.current = editorValue;
    setEditorValue(query);
    setParseError(null);
    setShowExplanation(false);
    toast("Query loaded", {
      action: { label: "Undo", onClick: handleUndo },
      duration: 6000,
    });
  }

  function handleLoadAndRun(query: string) {
    prevEditorValueRef.current = editorValue;
    setEditorValue(query);
    setParseError(null);
    setShowExplanation(false);
    toast("Query loaded", {
      action: { label: "Undo", onClick: handleUndo },
      duration: 6000,
    });
    void executeQuery(query);
  }

  function handleDeleteSaved(id: string) {
    if (!connection) return;
    deleteSavedQuery(connection.budgetSyncId, id);
    setSavedQueries(getSavedQueries(connection.budgetSyncId));
  }

  function handleToggleFavorite(id: string) {
    if (!connection) return;
    const q = savedQueries.find((s) => s.id === id);
    if (!q) return;
    updateSavedQuery(connection.budgetSyncId, id, { isFavorite: !q.isFavorite });
    setSavedQueries(getSavedQueries(connection.budgetSyncId));
  }

  function handleRenameSaved(id: string, name: string) {
    if (!connection) return;
    updateSavedQuery(connection.budgetSyncId, id, { name });
    setSavedQueries(getSavedQueries(connection.budgetSyncId));
  }

  function handleDuplicateSaved(id: string) {
    if (!connection) return;
    duplicateSavedQuery(connection.budgetSyncId, id);
    setSavedQueries(getSavedQueries(connection.budgetSyncId));
  }

  function handleClearHistory() {
    if (!connection) return;
    clearHistory(connection.budgetSyncId);
    setHistory([]);
  }

  // ─── Guard ───────────────────────────────────────────────────────────────────

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No active connection. Connect to a budget first.
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Left panel: tabbed (Examples / History / Saved) ─────────────── */}
      <LeftPanel
        history={history}
        savedQueries={savedQueries}
        onLoad={handleLoad}
        onLoadAndRun={handleLoadAndRun}
        onDelete={handleDeleteSaved}
        onToggleFavorite={handleToggleFavorite}
        onRename={handleRenameSaved}
        onDuplicate={handleDuplicateSaved}
        onClearHistory={handleClearHistory}
      />

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div ref={mainAreaRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Page toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <h1 className="text-sm font-semibold">ActualQL Queries</h1>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
            dev
          </span>
        </div>

        {/* Staged-changes banner */}
        {hasChanges && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-400/30 bg-amber-50/80 px-4 py-2 text-xs text-amber-800 dark:border-amber-600/30 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            You have unsaved staged changes. Query results reflect saved server
            state, not your staged edits.
          </div>
        )}

        {/* ── Editor section (shrink-0, height controlled by drag) ───────── */}
        <div className="flex shrink-0 flex-col">
          <QueryEditor
            value={editorValue}
            onChange={setEditorValue}
            onRun={handleRun}
            onFormat={handleFormat}
            onSave={handleSave}
            onExplain={handleExplain}
            onCopyQuery={handleCopyQuery}
            onOpenReference={() => setReferenceOpen(true)}
            onUndo={handleUndo}
            isRunning={isRunning}
            parseError={parseError}
            editorHeight={editorHeight}
          />

          {/* Lint warnings */}
          <QueryLintPanel warnings={lintWarnings} />

          {/* Explanation panel */}
          {showExplanation && explainLines.length > 0 && (
            <QueryExplanationPanel
              lines={explainLines}
              onClose={() => setShowExplanation(false)}
            />
          )}
        </div>

        {/* ── Drag handle ──────────────────────────────────────────────────── */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor"
          onMouseDown={handleDragStart}
          className="group flex shrink-0 cursor-ns-resize items-center justify-center border-b border-border py-px transition-colors hover:bg-accent/40 select-none"
        >
          <div className="h-px w-8 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/40" />
        </div>

        {/* ── Results (takes remaining space) ──────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <QueryResults
            result={result}
            isRunning={isRunning}
            error={runError}
            lastRequest={lastExecutedRequest}
            execTime={execTime}
            payloadBytes={payloadBytes}
          />
        </div>
      </div>

      {/* Save dialog */}
      <SaveQueryDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSaveConfirm}
        defaultName={saveDefaultName}
      />

      {/* Quick reference dialog */}
      <QueryReferenceDialog
        open={referenceOpen}
        onClose={() => setReferenceOpen(false)}
      />
    </div>
  );
}
