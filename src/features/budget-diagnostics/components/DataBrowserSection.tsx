import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Relationship } from "../lib/relationshipMap";
import { getSqliteWorkerClient } from "../lib/sqliteWorkerClient";
import { defaultSchemaObjectSelection } from "../lib/schemaObjectGroups";
import type { SchemaObjectSummary } from "../types";
import { RowDetailsSheet, type RowDetailsEntry } from "./RowDetailsSheet";
import { TableBrowser } from "./TableBrowser";
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
  const mountedRef = useRef(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selectedNameRef = useRef<string | null>(null);
  const [rowStack, setRowStack] = useState<RowDetailsEntry[]>([]);
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
    selectedNameRef.current = selectedName;
    setRowStack([]);
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectObject = (object: SchemaObjectSummary) => {
    setSelectedName(object.name);
    const params = new URLSearchParams(searchParams.toString());
    params.set("obj", object.name);
    params.set("p", "1");
    params.delete("sort");
    params.delete("dir");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const pushRowEntry = (entry: RowDetailsEntry) => {
    setRowStack((current) => {
      const next = [...current, entry];
      if (next.length <= 10) return next;
      toast("Older drill-in entries collapsed");
      return next.slice(-10);
    });
  };

  const followRelationship = (relationship: Relationship, value: unknown) => {
    const selectedAtCall = selectedNameRef.current;

    async function run() {
      try {
        const payload = await getSqliteWorkerClient().call({
          kind: "lookupRow",
          object: relationship.to.table,
          keyColumn: relationship.to.column,
          keyValue: value,
        });
        if (!mountedRef.current || selectedNameRef.current !== selectedAtCall) return;
        pushRowEntry({
          object: payload.object,
          objectType: payload.objectType,
          sourceLayer: "raw",
          columns: payload.columns,
          row: payload.row,
          keyColumn: payload.keyColumn,
          keyValue: payload.keyValue,
        });
      } catch (error) {
        if (!mountedRef.current || selectedNameRef.current !== selectedAtCall) return;
        toast.error(getErrorMessage(error));
      }
    }

    void run();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
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
            <div className="mb-4 grid grid-cols-3 gap-2 border-b border-border pb-3 text-center text-xs">
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
                <div className="text-muted-foreground">Schema</div>
              </div>
            </div>
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
              <TableBrowser
                object={selectedObject}
                onOpenRowDetails={pushRowEntry}
                onFollowRelationship={followRelationship}
              />
            ) : (
              <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
                Select a schema object to inspect.
              </div>
            )}
          </div>

          <aside className="hidden min-h-0 border-l border-border px-5 py-4 lg:block">
            <RowDetailsSheet
              stack={rowStack}
              onBack={() => setRowStack((current) => current.slice(0, -1))}
              onClose={() => setRowStack([])}
              onFollowRelationship={followRelationship}
            />
          </aside>
        </div>
      )}
    </section>
  );
}
