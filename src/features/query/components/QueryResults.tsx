"use client";

import { useState, useMemo } from "react";
import { Copy, ChevronUp, ChevronDown, ChevronsUpDown, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CopyCurlButton } from "./CopyCurlButton";
import { JsonTreeView } from "./JsonTreeView";
import { colorizeJson } from "../lib/jsonColorize";
import { formatIsoDate, formatCents } from "../lib/queryFormatting";
import type { QueryResultMode, LastExecutedRequest, ActualQLQuery } from "../types";

const TABLE_ROW_CAP = 500;

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatTime(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// ─── Type guards ──────────────────────────────────────────────────────────────

function isArrayOfObjects(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    !Array.isArray(value[0])
  );
}

/** Returns the union of all keys across the first N rows. */
function getColumns(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

/** Raw cell value used for the title/tooltip — never transformed. */
function rawCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Hard-coded column names that are always stored in cents (÷ 100 = dollar value).
 * Aggregate aliases are handled separately via deriveCentColumns().
 */
const BASE_CENT_COLS = new Set(["amount", "balance"]);

/**
 * Aggregate operators that, when applied to a cent field, produce a cent result.
 * $count is deliberately excluded — it counts rows, not amounts.
 */
const CENT_AGG_OPS = new Set(["$sum", "$avg", "$min", "$max"]);

/**
 * The $ -prefixed field references that represent cent-valued columns in
 * aggregate expressions (e.g. { "$sum": "$amount" }).
 */
const CENT_SOURCE_REFS = new Set(["$amount", "$balance"]);

/**
 * Derives the full set of cent-valued column names from a query's select array.
 *
 * Starts from BASE_CENT_COLS, then inspects each aggregate entry in select:
 *   { alias: { "$sum" | "$avg" | "$min" | "$max": "$amount" | "$balance" } }
 * Any alias matching this pattern is added to the returned set.
 *
 * $count is excluded — it produces row counts, not monetary values.
 * Non-array select (raw object or undefined) falls back to BASE_CENT_COLS only.
 */
function deriveCentColumns(query: ActualQLQuery | undefined): Set<string> {
  const cols = new Set(BASE_CENT_COLS);
  if (!query) return cols;

  const select = query.select;
  if (!Array.isArray(select)) return cols;

  for (const item of select) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    // Each aggregate entry: { alias: { op: sourceField } }
    for (const [alias, aggExpr] of Object.entries(item as Record<string, unknown>)) {
      if (typeof aggExpr !== "object" || aggExpr === null || Array.isArray(aggExpr)) continue;
      for (const [op, sourceRef] of Object.entries(aggExpr as Record<string, unknown>)) {
        if (
          CENT_AGG_OPS.has(op) &&
          typeof sourceRef === "string" &&
          CENT_SOURCE_REFS.has(sourceRef)
        ) {
          cols.add(alias);
        }
      }
    }
  }

  return cols;
}

/**
 * Smart display formatter. Applies:
 *   - ISO date strings → locale-aware date (e.g. "Jan 15, 2024")
 *   - Cent columns → ÷ 100 decimal (e.g. "12.00"). The set of cent columns
 *     includes hard-coded names (amount, balance) PLUS any aliases detected
 *     as aggregates on cent fields by deriveCentColumns().
 * Raw value is always preserved in the cell title tooltip.
 */
function formatCellDisplay(col: string, value: unknown, centCols: Set<string>): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return formatIsoDate(value) ?? value;
  }
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    centCols.has(col)
  ) {
    return formatCents(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isTreeable(data: unknown): boolean {
  return Array.isArray(data) || (data !== null && typeof data === "object");
}

function detectMode(data: unknown): QueryResultMode {
  if (Array.isArray(data)) return "table";
  if (
    typeof data === "number" ||
    typeof data === "string" ||
    typeof data === "boolean"
  ) {
    return "scalar";
  }
  // Plain objects default to Tree view
  if (data !== null && typeof data === "object") return "tree";
  return "raw";
}

function deriveRowCount(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return `${data.length} row${data.length !== 1 ? "s" : ""}`;
  if (typeof data === "number" || typeof data === "string" || typeof data === "boolean") {
    return "1 value";
  }
  if (typeof data === "object") return "1 object";
  return null;
}

// ─── CSV export ───────────────────────────────────────────────────────────────

/**
 * Builds a UTF-8 BOM-prefixed CSV string from an array of row objects.
 * Values are formatted the same way as in the Table view (dates localised,
 * cent columns divided by 100). The BOM ensures Excel opens the file correctly.
 */
function buildCsv(
  rows: Record<string, unknown>[],
  columns: string[],
  centCols: Set<string>
): string {
  const BOM = "\uFEFF";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;

  const header = columns.map(escape).join(",");
  const csvRows = rows.map((row) =>
    columns
      .map((col) => escape(formatCellDisplay(col, row[col], centCols)))
      .join(",")
  );

  return BOM + [header, ...csvRows].join("\r\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function sortRows(
  rows: Record<string, unknown>[],
  col: string,
  dir: SortDir
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return dir === "asc" ? cmp : -cmp;
  });
}

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string | null; sortDir: SortDir | null }) {
  if (col !== sortCol) return <ChevronsUpDown className="ml-1 h-3 w-3 opacity-30" />;
  return sortDir === "asc"
    ? <ChevronUp className="ml-1 h-3 w-3 text-foreground" />
    : <ChevronDown className="ml-1 h-3 w-3 text-foreground" />;
}

function TableView({ data, centCols }: { data: unknown; centCols: Set<string> }) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir | null>(null);

  const rows = useMemo(
    () => (isArrayOfObjects(data) ? data : []),
    [data]
  );
  const capped = rows.slice(0, TABLE_ROW_CAP);
  const columns = useMemo(() => getColumns(capped), [capped]);
  const isCapped = rows.length > TABLE_ROW_CAP;

  const sortedRows = useMemo(() => {
    if (!sortCol || !sortDir) return capped;
    return sortRows(capped, sortCol, sortDir);
  }, [capped, sortCol, sortDir]);

  function handleSortClick(col: string) {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      // third click — clear sort
      setSortCol(null);
      setSortDir(null);
    }
  }

  if (Array.isArray(data) && data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No rows matched this query.
      </div>
    );
  }

  if (!isArrayOfObjects(data)) {
    return (
      <pre className="overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {rows.length} row{rows.length !== 1 ? "s" : ""}
        </span>
        {isCapped && (
          <span className="text-amber-600 dark:text-amber-500">
            Showing first {TABLE_ROW_CAP} — add{" "}
            <code className="font-mono">&quot;limit&quot;</code> to control
            result size.
          </span>
        )}
        {sortCol && (
          <span className="text-muted-foreground/60">
            Sorted by <span className="font-mono">{sortCol}</span> {sortDir}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-muted">
              {columns.map((col) => (
                <th
                  key={col}
                  aria-sort={
                    sortCol !== col
                      ? "none"
                      : sortDir === "asc"
                        ? "ascending"
                        : "descending"
                  }
                  className="whitespace-nowrap px-0 py-0 text-left font-medium text-muted-foreground"
                >
                  <button
                    type="button"
                    onClick={() => handleSortClick(col)}
                    className="inline-flex w-full items-center px-3 py-1.5 select-none cursor-pointer transition-colors hover:text-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    {col}
                    <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                {columns.map((col) => (
                  <td
                    key={col}
                    title={rawCellValue(row[col])}
                    className="max-w-48 truncate px-3 py-1.5 font-mono text-foreground"
                  >
                    {formatCellDisplay(col, row[col], centCols)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RawView({ data }: { data: unknown }) {
  const lines = useMemo(
    () => JSON.stringify(data, null, 2).split("\n"),
    [data]
  );

  return (
    <div className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed">
      <table className="border-separate border-spacing-0">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="select-none pr-4 text-right align-top text-muted-foreground/30 w-10">
                {i + 1}
              </td>
              <td
                className="whitespace-pre align-top text-foreground"
                dangerouslySetInnerHTML={{ __html: colorizeJson(line) }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScalarView({ data }: { data: unknown }) {
  const display =
    typeof data === "object"
      ? JSON.stringify(data, null, 2)
      : String(data);

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Calculated result
      </span>
      <div className="rounded-lg border border-border bg-muted/30 px-6 py-4 font-mono text-2xl font-semibold text-foreground">
        {display}
      </div>
    </div>
  );
}

// ─── QueryResults ─────────────────────────────────────────────────────────────

interface QueryResultsProps {
  result: unknown | null;
  isRunning: boolean;
  error: string | null;
  lastRequest?: LastExecutedRequest | null;
  execTime?: number | null;
  payloadBytes?: number | null;
}

export function QueryResults({
  result,
  isRunning,
  error,
  lastRequest,
  execTime,
  payloadBytes,
}: QueryResultsProps) {
  const [mode, setMode] = useState<QueryResultMode>("table");

  // Derive the full set of cent-valued column names from the executed query.
  // Re-derived whenever the request changes (i.e. after each successful run).
  const centCols = useMemo(
    () => deriveCentColumns(lastRequest?.query),
    [lastRequest]
  );

  // Derived state: auto-select the appropriate view mode when the result changes.
  // This is the React-documented getDerivedStateFromProps pattern for hooks —
  // React re-renders immediately with the updated mode, preventing any flicker.
  const [prevResult, setPrevResult] = useState<unknown | null>(null);
  if (result !== prevResult) {
    setPrevResult(result);
    if (result !== null) {
      setMode(detectMode(result));
    }
  }

  function handleCopyResult() {
    if (result === null) return;
    navigator.clipboard
      .writeText(JSON.stringify(result, null, 2))
      .then(() => toast.success("Result JSON copied"))
      .catch(() => toast.error("Failed to copy"));
  }

  function handleExportCsv() {
    if (!isArrayOfObjects(result)) return;
    const rows = result as Record<string, unknown>[];
    const capped = rows.slice(0, TABLE_ROW_CAP);
    const columns = getColumns(capped);
    const csv = buildCsv(capped, columns, centCols);
    downloadCsv(csv, "query-results.csv");
    toast.success("CSV downloaded");
  }

  if (isRunning) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Running query…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Status bar — shown on error too */}
        {execTime !== null && execTime !== undefined && (
          <ResultsActionBar
            hasResult={false}
            isTableResult={false}
            isError
            execTime={execTime}
            rowCount={null}
            payloadBytes={payloadBytes ?? null}
            onCopyResult={handleCopyResult}
            onExportCsv={handleExportCsv}
            lastRequest={lastRequest ?? null}
          />
        )}
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-12 text-sm">
          <span className="text-destructive">{error}</span>
        </div>
      </div>
    );
  }

  if (result === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Run a query to see results here.
      </div>
    );
  }

  const rowCount = deriveRowCount(result);

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => setMode(v as QueryResultMode)}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ResultsActionBar
        hasResult
        isTableResult={isArrayOfObjects(result)}
        isError={false}
        execTime={execTime ?? null}
        rowCount={rowCount}
        payloadBytes={payloadBytes ?? null}
        onCopyResult={handleCopyResult}
        onExportCsv={handleExportCsv}
        lastRequest={lastRequest ?? null}
        tabsList={
          <TabsList className="border-b-0">
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="raw">Raw JSON</TabsTrigger>
            <TabsTrigger value="scalar">Scalar</TabsTrigger>
            {isTreeable(result) && (
              <TabsTrigger value="tree">Tree</TabsTrigger>
            )}
          </TabsList>
        }
      />

      <TabsContent value="table" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableView data={result} centCols={centCols} />
      </TabsContent>
      <TabsContent value="raw" className="overflow-hidden">
        <RawView data={result} />
      </TabsContent>
      <TabsContent value="scalar" className="overflow-hidden">
        <ScalarView data={result} />
      </TabsContent>
      <TabsContent value="tree" className="overflow-hidden">
        <JsonTreeView data={result} />
      </TabsContent>
    </Tabs>
  );
}

// ─── ResultsActionBar ─────────────────────────────────────────────────────────

interface ResultsActionBarProps {
  hasResult: boolean;
  isTableResult: boolean;
  isError: boolean;
  execTime: number | null;
  rowCount: string | null;
  payloadBytes: number | null;
  onCopyResult: () => void;
  onExportCsv: () => void;
  lastRequest: LastExecutedRequest | null;
  tabsList?: React.ReactNode;
}

function ResultsActionBar({
  hasResult,
  isTableResult,
  isError,
  execTime,
  rowCount,
  payloadBytes,
  onCopyResult,
  onExportCsv,
  lastRequest,
  tabsList,
}: ResultsActionBarProps) {
  const showMeta = execTime !== null;

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border">
      {/* Left: tabs (when present) */}
      <div className="flex items-center">
        {tabsList ?? <div className="h-9" />}
      </div>

      {/* Right: metadata + actions */}
      <div className="flex items-center gap-1 pr-2">
        {showMeta && (
          <>
            {/* Status chip */}
            {isError ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-destructive/15 text-destructive">
                Error
              </span>
            ) : (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-700 dark:text-green-400">
                OK
              </span>
            )}
            {/* Execution time */}
            <span className="text-[11px] text-muted-foreground">
              {formatTime(execTime!)}
            </span>
            {/* Row count */}
            {rowCount && (
              <span className="text-[11px] text-muted-foreground">
                {rowCount}
              </span>
            )}
            {/* Payload size */}
            {payloadBytes !== null && (
              <span className="text-[11px] text-muted-foreground">
                {formatBytes(payloadBytes)}
              </span>
            )}
            {/* Divider */}
            <div className="mx-1 h-4 w-px bg-border" />
          </>
        )}

        {/* Export CSV — only for array-of-objects results */}
        {hasResult && isTableResult && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onExportCsv}
            title="Download table as a UTF-8 CSV file"
            className="gap-1.5 text-xs text-muted-foreground"
          >
            <Download className="h-3 w-3" />
            Export CSV
          </Button>
        )}

        {/* Copy JSON result */}
        {hasResult && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCopyResult}
            title="Copy full result as JSON to clipboard"
            className="gap-1.5 text-xs text-muted-foreground"
          >
            <Copy className="h-3 w-3" />
            Copy JSON
          </Button>
        )}

        {/* cURL buttons — safe first, secrets second (amber) */}
        {lastRequest && <CopyCurlButton lastRequest={lastRequest} />}
      </div>
    </div>
  );
}
