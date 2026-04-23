import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Copy,
  Download,
  Loader2,
  PanelRightOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatCellDisplay,
  stringifyRowForClipboard,
} from "../lib/cellFormatters";
import {
  CSV_MEMORY_WARNING_BYTES,
  CSV_UTF8_BOM,
  buildCsvHeader,
  buildCsvRows,
  csvExportFilename,
  estimateCsvBytes,
} from "../lib/csvExport";
import { findRelationship, type Relationship } from "../lib/relationshipMap";
import { getSqliteWorkerClient } from "../lib/sqliteWorkerClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  FetchRowsPayload,
  SchemaObjectDetails,
  SchemaObjectSummary,
} from "../types";
import type { RowDetailsEntry } from "./RowDetailsSheet";
import { SchemaObjectDetails as SchemaObjectDetailsView } from "./SchemaObjectDetails";

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500] as const;
const DEFAULT_PAGE_SIZE = 100;
const SLOW_QUERY_MS = 2000;
const BROWSER_TAB_CLASS =
  "rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-4 py-2 after:hidden focus-visible:ring-0 data-[active]:border-primary data-[active]:text-foreground disabled:pointer-events-none disabled:opacity-40";

type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
type SortDirection = "asc" | "desc";
type ExportState =
  | { status: "idle" }
  | { status: "exporting"; exportedRows: number; rowCount: number | null };

type BrowserState =
  | { status: "idle" | "loading" }
  | {
      status: "ready";
      details: SchemaObjectDetails;
      payload: FetchRowsPayload | null;
      page: number;
      pageSize: PageSize;
      sortColumn: string | null;
      sortDirection: SortDirection | null;
      elapsedMs: number;
    }
  | { status: "error"; message: string };

type TableBrowserProps = {
  object: SchemaObjectSummary;
  onOpenRowDetails: (entry: RowDetailsEntry) => void;
  onFollowRelationship: (relationship: Relationship, value: unknown) => void;
};

function parsePage(value: string | null): number {
  if (!value) return 1;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function parsePageSize(value: string | null): PageSize {
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as PageSize)
    ? (parsed as PageSize)
    : DEFAULT_PAGE_SIZE;
}

function parseDirection(value: string | null): SortDirection | null {
  return value === "asc" || value === "desc" ? value : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unable to fetch rows for this object.";
}

function rowRange(payload: FetchRowsPayload): string {
  if (payload.rowCount === null) {
    if (payload.rows.length === 0 && payload.offset === 0) {
      return "0 rows shown, total unavailable";
    }
    if (payload.rows.length === 0) {
      return "No rows on this page, total unavailable";
    }
    const start = payload.offset + 1;
    const end = payload.offset + payload.rows.length;
    return `${start.toLocaleString("en-US")}-${end.toLocaleString("en-US")} of unknown`;
  }
  if (payload.rowCount === 0) return "0 rows";
  const start = payload.offset + 1;
  const end = payload.offset + payload.rows.length;
  return `${start.toLocaleString("en-US")}-${end.toLocaleString("en-US")} of ${payload.rowCount.toLocaleString("en-US")}`;
}

function SortIcon({
  column,
  sortColumn,
  sortDirection,
}: {
  column: string;
  sortColumn: string | null;
  sortDirection: SortDirection | null;
}) {
  if (column !== sortColumn) {
    return <ChevronsUpDown className="ml-1 h-3 w-3 opacity-30" />;
  }
  return sortDirection === "asc" ? (
    <ChevronUp className="ml-1 h-3 w-3 text-foreground" />
  ) : (
    <ChevronDown className="ml-1 h-3 w-3 text-foreground" />
  );
}

function isNumericCell(value: unknown): boolean {
  return typeof value === "number";
}

function pageCount(rowCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(rowCount / pageSize));
}

function formatExportProgress(state: ExportState): string | null {
  if (state.status !== "exporting") return null;
  const exported = state.exportedRows.toLocaleString("en-US");
  return state.rowCount === null
    ? `Exporting ${exported}`
    : `Exporting ${exported} / ${state.rowCount.toLocaleString("en-US")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024).toLocaleString("en-US")} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function rowKey(
  details: SchemaObjectDetails,
  row: Record<string, unknown>,
  rowNumber: number
): string {
  const keyColumn = details.rowKey?.column;
  const keyValue = keyColumn ? row[keyColumn] : null;
  return `${rowNumber}:${keyColumn ?? "row"}:${String(keyValue ?? "")}`;
}

function sourceLayerForObject(type: SchemaObjectDetails["type"]): RowDetailsEntry["sourceLayer"] {
  return type === "view" ? "view" : "raw";
}

function buildRowDetailsEntry({
  details,
  row,
  rowNumber,
}: {
  details: SchemaObjectDetails;
  row: Record<string, unknown>;
  rowNumber: number;
}): RowDetailsEntry {
  const keyColumn = details.rowKey?.column ?? null;
  return {
    object: details.name,
    objectType: details.type,
    sourceLayer: sourceLayerForObject(details.type),
    columns: Object.keys(row).length > 0 ? details.columns.map((column) => column.name) : [],
    row,
    keyColumn,
    keyValue: keyColumn ? row[keyColumn] : rowNumber,
    rowNumber,
  };
}

export function TableBrowser({
  object,
  onOpenRowDetails,
  onFollowRelationship,
}: TableBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageParam = searchParams.get("p");
  const pageSizeParam = searchParams.get("ps");
  const sortParam = searchParams.get("sort");
  const directionParam = searchParams.get("dir");
  const requestedPage = parsePage(pageParam);
  const pageSize = parsePageSize(pageSizeParam);
  const requestedDirection = parseDirection(directionParam);
  const [state, setState] = useState<BrowserState>({ status: "idle" });
  const [activePanel, setActivePanel] = useState<"data" | "schema">("data");
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);

  const canBrowseRows = object.type === "table" || object.type === "view";
  const isExporting = exportState.status === "exporting";

  useEffect(() => {
    setSelectedRowKey(null);
  }, [object.name, pageParam, pageSizeParam, sortParam, directionParam]);

  const replaceParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    let cancelled = false;

    async function loadObject() {
      setState({ status: "loading" });
      try {
        const client = getSqliteWorkerClient();
        const details = await client.call({ kind: "getSchemaObject", name: object.name });
        if (details.type !== "table" && details.type !== "view") {
          if (cancelled) return;
          setState({
            status: "ready",
            details,
            payload: null,
            page: 1,
            pageSize,
            sortColumn: null,
            sortDirection: null,
            elapsedMs: 0,
          });
          return;
        }

        const columns = new Set(details.columns.map((column) => column.name));
        const sortColumn = sortParam && columns.has(sortParam) ? sortParam : null;
        const sortDirection = sortColumn ? requestedDirection ?? "asc" : null;
        const maxPage =
          details.rowCount === null ? requestedPage : pageCount(details.rowCount, pageSize);
        const page = Math.min(requestedPage, maxPage);
        const offset = (page - 1) * pageSize;
        const startedAt = performance.now();
        const payload = await client.call({
          kind: "fetchRows",
          object: object.name,
          offset,
          limit: pageSize,
          orderBy: sortColumn ?? undefined,
          direction: sortDirection ?? undefined,
        });
        const elapsedMs = performance.now() - startedAt;
        if (cancelled) return;
        setState({
          status: "ready",
          details,
          payload,
          page,
          pageSize,
          sortColumn,
          sortDirection,
          elapsedMs,
        });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", message: getErrorMessage(error) });
      }
    }

    void loadObject();

    return () => {
      cancelled = true;
    };
  }, [
    object.name,
    pageSize,
    requestedDirection,
    requestedPage,
    sortParam,
  ]);

  const slowSortedFetch =
    state.status === "ready" &&
    state.payload !== null &&
    Boolean(state.sortColumn) &&
    state.elapsedMs > SLOW_QUERY_MS;

  const handleSort = (column: string) => {
    replaceParams((params) => {
      params.set("p", "1");
      if (state.status !== "ready" || state.sortColumn !== column) {
        params.set("sort", column);
        params.set("dir", "asc");
      } else if (state.sortDirection === "asc") {
        params.set("sort", column);
        params.set("dir", "desc");
      } else {
        params.delete("sort");
        params.delete("dir");
      }
    });
  };

  const setPage = (page: number) => {
    replaceParams((params) => {
      params.set("p", String(page));
    });
  };

  const setPageSize = (value: PageSize) => {
    replaceParams((params) => {
      params.set("p", "1");
      params.set("ps", String(value));
    });
  };

  const copyRow = (row: Record<string, unknown>) => {
    navigator.clipboard
      .writeText(stringifyRowForClipboard(row))
      .then(() => toast.success("Row JSON copied"))
      .catch(() => toast.error("Failed to copy row JSON"));
  };

  const exportCsv = async () => {
    if (state.status !== "ready" || !state.payload || isExporting) return;

    const client = getSqliteWorkerClient();
    let cursorId: string | null = null;

    try {
      const begin = await client.call(
        {
          kind: "exportRowsBegin",
          object: state.details.name,
          orderBy: state.sortColumn ?? undefined,
          direction: state.sortDirection ?? undefined,
        },
        { timeoutMs: null }
      );
      cursorId = begin.cursorId;
      setExportState({ status: "exporting", exportedRows: 0, rowCount: begin.rowCount });

      const chunks: string[] = [`${CSV_UTF8_BOM}${buildCsvHeader(begin.columns)}`];
      let exportedRows = 0;
      let needsWarningCheck = true;
      let done = begin.rowCount === 0;

      while (!done) {
        const next = await client.call(
          { kind: "exportRowsNext", cursorId: begin.cursorId },
          { timeoutMs: null }
        );

        if (needsWarningCheck) {
          needsWarningCheck = false;
          const estimatedBytes =
            begin.rowCount === null
              ? 0
              : estimateCsvBytes(begin.rowCount, next.rows, begin.columns);
          if (
            estimatedBytes > CSV_MEMORY_WARNING_BYTES &&
            !window.confirm(
              `This export is estimated at about ${formatBytes(estimatedBytes)}. Continue?`
            )
          ) {
            toast.info("CSV export cancelled");
            return;
          }
        }

        const csvRows = buildCsvRows(next.rows, begin.columns);
        if (csvRows) chunks.push("\r\n", csvRows);
        exportedRows += next.rows.length;
        setExportState({
          status: "exporting",
          exportedRows,
          rowCount: begin.rowCount,
        });
        done = next.done;
      }

      downloadCsv(chunks.join(""), csvExportFilename(begin.object));
      toast.success("CSV exported");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      if (cursorId) {
        void client.call({ kind: "exportRowsEnd", cursorId }, { timeoutMs: null }).catch(() => {
          // Cursor cleanup is best-effort; the worker also expires idle cursors.
        });
      }
      setExportState({ status: "idle" });
    }
  };

  const pageTotal =
    state.status === "ready" && state.payload
      ? state.payload.rowCount === null
        ? null
        : pageCount(state.payload.rowCount, state.pageSize)
      : null;

  const rows = useMemo(
    () => (state.status === "ready" && state.payload ? state.payload.rows : []),
    [state]
  );

  const tabsValue = canBrowseRows ? activePanel : "schema";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {state.status === "loading" && (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading schema object
        </div>
      )}

      {state.status === "error" && (
        <div className="m-4 rounded-md border border-destructive/25 bg-destructive/5 p-4">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Object failed to load</p>
              <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
            </div>
          </div>
        </div>
      )}

      {state.status === "ready" && (
        <Tabs
          value={tabsValue}
          onValueChange={(value) => {
            if (value === "data" || value === "schema") setActivePanel(value);
          }}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <TabsList className="flex shrink-0 border-b border-border bg-background">
            <TabsTrigger
              value="data"
              disabled={!canBrowseRows}
              className={BROWSER_TAB_CLASS}
            >
              Data
            </TabsTrigger>
            <TabsTrigger
              value="schema"
              className={BROWSER_TAB_CLASS}
            >
              Schema
            </TabsTrigger>
          </TabsList>
          <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {state.payload ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{rowRange(state.payload)}</span>
                    {state.payload.rowCountError && (
                      <span
                        className="text-amber-600 dark:text-amber-500"
                        title={state.payload.rowCountError}
                      >
                        Total unavailable
                      </span>
                    )}
                    {isExporting && (
                      <span className="text-muted-foreground/70">
                        {formatExportProgress(exportState)}
                      </span>
                    )}
                    {state.sortColumn && (
                      <span className="text-muted-foreground/70">
                        Sorted by <span className="font-mono">{state.sortColumn}</span>{" "}
                        {state.sortDirection}
                      </span>
                    )}
                    {slowSortedFetch && (
                      <span className="text-amber-600 dark:text-amber-500">
                        Slow sorted fetch: {(state.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isExporting}
                      onClick={() => void exportCsv()}
                    >
                      {isExporting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Export CSV
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Rows
                      <select
                        value={state.pageSize}
                        onChange={(event) => setPageSize(Number(event.target.value) as PageSize)}
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                      >
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-xs"
                        disabled={state.page <= 1}
                        onClick={() => setPage(state.page - 1)}
                        title="Previous page"
                      >
                        <ChevronLeft />
                      </Button>
                      <span className="min-w-20 text-center text-xs text-muted-foreground">
                        {state.page} / {pageTotal ?? "?"}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-xs"
                        disabled={
                          pageTotal === null
                            ? rows.length < state.pageSize
                            : state.page >= pageTotal
                        }
                        onClick={() => setPage(state.page + 1)}
                        title="Next page"
                      >
                        <ChevronRight />
                      </Button>
                    </div>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
                    No rows found for this page.
                  </div>
                ) : (
                  <RowsTable
                    details={state.details}
                    payload={state.payload}
                    rows={rows}
                    sortColumn={state.sortColumn}
                    sortDirection={state.sortDirection}
                    slowSortedFetch={slowSortedFetch}
                    objectName={object.name}
                    selectedRowKey={selectedRowKey}
                    onSort={handleSort}
                    onCopyRow={copyRow}
                    onOpenRowDetails={(entry, key) => {
                      setSelectedRowKey(key);
                      onOpenRowDetails(entry);
                    }}
                    onFollowRelationship={onFollowRelationship}
                  />
                )}
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-sm text-muted-foreground">
                Indexes and triggers are schema-only objects. Row browsing is available for
                tables and views.
              </div>
            )}
          </TabsContent>
          <TabsContent value="schema" className="flex min-h-0 flex-1 overflow-hidden">
            <SchemaObjectDetailsView details={state.details} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function RowsTable({
  details,
  payload,
  rows,
  sortColumn,
  sortDirection,
  slowSortedFetch,
  objectName,
  selectedRowKey,
  onSort,
  onCopyRow,
  onOpenRowDetails,
  onFollowRelationship,
}: {
  details: SchemaObjectDetails;
  payload: FetchRowsPayload;
  rows: Record<string, unknown>[];
  sortColumn: string | null;
  sortDirection: SortDirection | null;
  slowSortedFetch: boolean;
  objectName: string;
  selectedRowKey: string | null;
  onSort: (column: string) => void;
  onCopyRow: (row: Record<string, unknown>) => void;
  onOpenRowDetails: (entry: RowDetailsEntry, key: string) => void;
  onFollowRelationship: (relationship: Relationship, value: unknown) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-muted">
            {payload.columns.map((column) => (
              <th
                key={column}
                aria-sort={
                  sortColumn !== column
                    ? "none"
                    : sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                }
                className="whitespace-nowrap px-0 py-0 text-left font-medium text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => onSort(column)}
                  className="inline-flex w-full cursor-pointer items-center px-3 py-1.5 transition-colors select-none hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                >
                  {column}
                  <SortIcon
                    column={column}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                  />
                  {slowSortedFetch && sortColumn === column && (
                    <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-500">
                      slow
                    </span>
                  )}
                </button>
              </th>
            ))}
            <th className="w-20 whitespace-nowrap px-3 py-1.5 text-right font-medium text-muted-foreground">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowNumber = payload.offset + index + 1;
            const key = rowKey(details, row, rowNumber);
            const rowDetailsEntry = buildRowDetailsEntry({ details, row, rowNumber });
            const selected = key === selectedRowKey;
            return (
              <tr
                key={key}
                onClick={() => onOpenRowDetails(rowDetailsEntry, key)}
                className={cn(
                  "cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/20",
                  selected && "bg-primary/8 hover:bg-primary/10"
                )}
                aria-selected={selected}
              >
                {payload.columns.map((column) => {
                  const display = formatCellDisplay(column, row[column]);
                  const relationship = findRelationship(objectName, column);
                  const linked =
                    relationship &&
                    row[column] !== null &&
                    row[column] !== undefined &&
                    !(typeof row[column] === "string" && row[column] === "");
                  return (
                    <td
                      key={column}
                      title={display.title}
                      className={cn(
                        "max-w-48 truncate px-3 py-1.5 font-mono text-foreground",
                        display.kind === "null" && "text-muted-foreground/50",
                        display.kind === "binary" && "text-amber-700 dark:text-amber-400",
                        (display.kind === "number" || isNumericCell(row[column])) &&
                          "text-right tabular-nums"
                      )}
                    >
                      {linked ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onFollowRelationship(relationship, row[column]);
                          }}
                          className="max-w-full truncate text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {display.text}
                        </button>
                      ) : (
                        display.text
                      )}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCopyRow(row);
                      }}
                      title="Copy row JSON"
                    >
                      <Copy />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenRowDetails(rowDetailsEntry, key);
                      }}
                      title="Open row details"
                    >
                      <PanelRightOpen />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
