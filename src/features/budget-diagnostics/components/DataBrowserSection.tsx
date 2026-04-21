import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, PanelRight, TableProperties, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCellDisplay } from "../lib/cellFormatters";
import { getSqliteWorkerClient } from "../lib/sqliteWorkerClient";
import { defaultSchemaObjectSelection } from "../lib/schemaObjectGroups";
import type { SchemaObjectSummary } from "../types";
import { TableBrowser, type RowDetailsPreview } from "./TableBrowser";
import { TableList, type TableListSortMode } from "./TableList";

type DataBrowserState =
  | { status: "idle"; objects: SchemaObjectSummary[]; error: null }
  | { status: "loading"; objects: SchemaObjectSummary[]; error: null }
  | { status: "ready"; objects: SchemaObjectSummary[]; error: null }
  | { status: "error"; objects: SchemaObjectSummary[]; error: string };

type DataBrowserSectionProps = {
  snapshotStatus: "idle" | "loading" | "ready" | "error";
};

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
  return "Unable to load schema objects.";
}

export function DataBrowserSection({ snapshotStatus }: DataBrowserSectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const objectParam = searchParams.get("obj");
  const [state, setState] = useState<DataBrowserState>({
    status: "idle",
    objects: [],
    error: null,
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [rowDetails, setRowDetails] = useState<RowDetailsPreview | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<TableListSortMode>("name");

  useEffect(() => {
    if (snapshotStatus !== "ready") {
      setState({ status: "idle", objects: [], error: null });
      setSelectedName(null);
      return;
    }

    let cancelled = false;

    async function loadSchemaObjects() {
      setState((current) => ({
        status: "loading",
        objects: current.objects,
        error: null,
      }));

      try {
        const payload = await getSqliteWorkerClient().call({ kind: "listSchemaObjects" });
        if (cancelled) return;
        setState({
          status: "ready",
          objects: payload.objects,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          status: "error",
          objects: current.objects,
          error: getErrorMessage(error),
        }));
      }
    }

    void loadSchemaObjects();

    return () => {
      cancelled = true;
    };
  }, [snapshotStatus]);

  useEffect(() => {
    if (snapshotStatus !== "ready" || state.objects.length === 0) return;
    const urlObject =
      objectParam && state.objects.find((object) => object.name === objectParam);
    setSelectedName((current) => {
      if (urlObject) return urlObject.name;
      if (current && state.objects.some((object) => object.name === current)) return current;
      return defaultSchemaObjectSelection(state.objects)?.name ?? null;
    });
  }, [objectParam, snapshotStatus, state.objects]);

  useEffect(() => {
    setRowDetails(null);
  }, [selectedName]);

  useEffect(() => {
    if (!selectedName || objectParam === selectedName) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("obj", selectedName);
    params.set("p", "1");
    params.delete("sort");
    params.delete("dir");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [objectParam, pathname, router, searchParams, selectedName]);

  const selectedObject = useMemo(
    () => state.objects.find((object) => object.name === selectedName) ?? null,
    [selectedName, state.objects]
  );
  const tablesAndViews = state.objects.filter(
    (object) => object.type === "table" || object.type === "view"
  ).length;
  const schemaOnly = state.objects.length - tablesAndViews;

  const selectObject = (object: SchemaObjectSummary) => {
    setSelectedName(object.name);
    const params = new URLSearchParams(searchParams.toString());
    params.set("obj", object.name);
    params.set("p", "1");
    params.delete("sort");
    params.delete("dir");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 lg:px-5">
        <div className="flex items-start gap-3">
          <TableProperties className="mt-1 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Data Browser</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse schema objects and paginated rows from the exported snapshot.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-right text-xs">
          <div>
            <div className="font-semibold text-foreground">{state.objects.length}</div>
            <div className="text-muted-foreground">Objects</div>
          </div>
          <div>
            <div className="font-semibold text-foreground">{tablesAndViews}</div>
            <div className="text-muted-foreground">Tables/views</div>
          </div>
          <div>
            <div className="font-semibold text-foreground">{schemaOnly}</div>
            <div className="text-muted-foreground">Schema only</div>
          </div>
        </div>
      </div>

      {snapshotStatus !== "ready" && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-sm text-muted-foreground">
          {snapshotStatus === "error"
            ? "Open the snapshot successfully before browsing schema objects."
            : "Schema objects will load after the snapshot opens."}
        </div>
      )}

      {snapshotStatus === "ready" && state.status === "loading" && state.objects.length === 0 && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading schema objects
        </div>
      )}

      {snapshotStatus === "ready" && state.status === "error" && state.objects.length === 0 && (
        <div className="m-4 rounded-md border border-destructive/25 bg-destructive/5 p-4 lg:m-5">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">
                Schema objects failed to load
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
            </div>
          </div>
        </div>
      )}

      {snapshotStatus === "ready" &&
        state.status !== "loading" &&
        state.objects.length === 0 &&
        state.status !== "error" && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-sm text-muted-foreground">
          No schema objects were found in this snapshot.
        </div>
      )}

      {snapshotStatus === "ready" && state.objects.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_18rem]">
          <aside className="min-h-0 border-b border-border px-4 py-4 lg:border-b-0 lg:border-r lg:px-5">
            <TableList
              objects={state.objects}
              selectedName={selectedName}
              search={search}
              sortMode={sortMode}
              onSearchChange={setSearch}
              onSortModeChange={setSortMode}
              onSelect={selectObject}
            />
          </aside>

          <div className="min-h-0 overflow-hidden">
            {selectedObject ? (
              <TableBrowser object={selectedObject} onOpenRowDetails={setRowDetails} />
            ) : (
              <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
                Select a schema object to inspect.
              </div>
            )}
          </div>

          <aside className="hidden min-h-0 border-l border-border px-5 py-4 lg:block">
            <RowDetailsPanel details={rowDetails} onClose={() => setRowDetails(null)} />
          </aside>
        </div>
      )}
    </section>
  );
}

function RowDetailsPanel({
  details,
  onClose,
}: {
  details: RowDetailsPreview | null;
  onClose: () => void;
}) {
  if (!details) {
    return (
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <PanelRight className="mt-0.5 h-4 w-4" />
        <div>
          <p className="font-medium text-foreground">Row details</p>
          <p className="mt-1">
            Open a row from the table to inspect raw values. Relationship drill-in arrives
            in M6e.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground" title={details.object}>
            {details.object}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Row {details.rowNumber.toLocaleString("en-US")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} title="Close">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-3">
        <div className="space-y-2">
          {details.columns.map((column) => {
            const display = formatCellDisplay(column, details.row[column]);
            return (
              <div key={column} className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">{column}</div>
                <div
                  title={display.title}
                  className={cn(
                    "mt-0.5 break-words font-mono text-xs text-foreground",
                    display.kind === "null" && "text-muted-foreground/50",
                    display.kind === "binary" && "text-amber-700 dark:text-amber-400"
                  )}
                >
                  {display.text}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
