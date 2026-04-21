import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Database, Loader2, PanelRight, TableProperties } from "lucide-react";
import { getSqliteWorkerClient } from "../lib/sqliteWorkerClient";
import { defaultSchemaObjectSelection } from "../lib/schemaObjectGroups";
import type { SchemaObjectSummary } from "../types";
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

function formatRowCount(value: number | null): string {
  return value === null ? "Not row-browsable" : value.toLocaleString("en-US");
}

function objectSubtitle(object: SchemaObjectSummary): string {
  if (object.type === "index" || object.type === "trigger") {
    return `${object.type} - schema object`;
  }
  return object.featured ? "featured view" : object.type;
}

export function DataBrowserSection({ snapshotStatus }: DataBrowserSectionProps) {
  const [state, setState] = useState<DataBrowserState>({
    status: "idle",
    objects: [],
    error: null,
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);
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
        setSelectedName((current) => {
          if (current && payload.objects.some((object) => object.name === current)) {
            return current;
          }
          return defaultSchemaObjectSelection(payload.objects)?.name ?? null;
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

  const selectedObject = useMemo(
    () => state.objects.find((object) => object.name === selectedName) ?? null,
    [selectedName, state.objects]
  );
  const tablesAndViews = state.objects.filter(
    (object) => object.type === "table" || object.type === "view"
  ).length;
  const schemaOnly = state.objects.length - tablesAndViews;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 lg:px-5">
        <div className="flex items-start gap-3">
          <TableProperties className="mt-1 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Data Browser</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse schema objects from the exported snapshot. Row browsing arrives in M6c.
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
              onSelect={(object) => setSelectedName(object.name)}
            />
          </aside>

          <div className="min-h-0 overflow-auto px-4 py-4 lg:px-5">
            {selectedObject ? (
              <div className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">{selectedObject.name}</h3>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {objectSubtitle(selectedObject)}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-border/70 bg-muted/12 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Type
                    </div>
                    <div className="mt-2 text-sm font-medium">{selectedObject.type}</div>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/12 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Rows
                    </div>
                    <div className="mt-2 text-sm font-medium">
                      {formatRowCount(selectedObject.rowCount)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/12 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Group
                    </div>
                    <div className="mt-2 text-sm font-medium">{selectedObject.group}</div>
                  </div>
                </div>

                <div className="rounded-md border border-dashed border-border bg-muted/20 p-5">
                  <p className="text-sm font-medium">Table browser arrives next</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    M6c will render paginated rows here. M6d will add the schema tab for
                    columns, indexes, and raw SQL.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
                Select a schema object to inspect.
              </div>
            )}
          </div>

          <aside className="hidden min-h-0 border-l border-border px-5 py-4 lg:block">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <PanelRight className="mt-0.5 h-4 w-4" />
              <div>
                <p className="font-medium text-foreground">Row details</p>
                <p className="mt-1">
                  Drill-in details are reserved for M6e and will open here when linked cells
                  are available.
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
