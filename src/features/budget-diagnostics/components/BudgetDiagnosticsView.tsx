"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LockKeyhole, Stethoscope } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { exportSnapshot } from "../lib/exportSnapshot";
import {
  getSqliteWorkerClient,
  isSqliteWorkerLoadedFor,
  markSqliteWorkerLoaded,
  resetSqliteWorkerClient,
} from "../lib/sqliteWorkerClient";
import {
  connectionSignature,
  useDiagnosticsCacheStore,
} from "../store/diagnosticsCache";
import { DataBrowserSection } from "./DataBrowserSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { OverviewSection } from "./OverviewSection";
import type { WorkbenchTab } from "./WorkbenchSummaryBar";

const WORKBENCH_TABS: readonly WorkbenchTab[] = ["overview", "diagnostics", "data"];
const WORKBENCH_TAB_CLASS =
  "group flex flex-1 items-center justify-center gap-1 rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-2 py-2 text-[12px] font-medium text-muted-foreground transition-colors after:hidden hover:text-foreground focus-visible:ring-0 data-[active]:border-primary data-[active]:text-foreground lg:flex-none lg:px-6";

function isWorkbenchTab(value: string | null): value is WorkbenchTab {
  return WORKBENCH_TABS.includes(value as WorkbenchTab);
}

function TabCount({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-px text-[10px] leading-none text-muted-foreground group-data-[active]:bg-primary/15 group-data-[active]:text-primary">
      {children}
    </span>
  );
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
  return "Unable to open the budget snapshot.";
}

function ReadOnlyNotice() {
  return (
    <div className="flex min-w-0 items-start gap-2 text-[11px] leading-4 text-muted-foreground">
      <LockKeyhole className="mt-1.0 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="truncate">
          Read-only. No changes written back to the budget. Exports are processed locally.
        </div>
      </div>
    </div>
  );
}

function ConnectBudgetState() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <section className="w-full max-w-lg rounded-md border border-border bg-background p-6 shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Stethoscope className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Connect a budget first
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Budget Diagnostics opens an exported snapshot from the active connection.
        </p>
        <Link
          href="/connect"
          className={cn(buttonVariants({ className: "mt-5" }))}
        >
          Go to connection
          <ArrowRight data-icon="inline-end" />
        </Link>
      </section>
    </main>
  );
}

function formatLoadedAgo(loadedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - loadedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/** Self-updating "loaded X ago" label (refreshes once a minute). */
function LoadedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return <>{formatLoadedAgo(at, now)}</>;
}

export function BudgetDiagnosticsView() {
  const connection = useConnectionStore(selectActiveInstance);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [reloadToken, setReloadToken] = useState(0);
  // Snapshot lives in a module-level store so it survives navigation (and is
  // shared with the standalone Data Browser) instead of being rebuilt on mount.
  const snapshot = useDiagnosticsCacheStore((s) => s.snapshot);
  const setSnapshot = useDiagnosticsCacheStore((s) => s.setSnapshot);
  const loadedAt = useDiagnosticsCacheStore((s) => s.loadedAt);
  const integrityRunGeneration = useRef(0);
  const tabParam = searchParams.get("tab");
  const activeTab: WorkbenchTab = isWorkbenchTab(tabParam) ? tabParam : "overview";
  const diagnosticsCount = snapshot.diagnostics?.findings.length ?? 0;
  const diagnosticsIssueCount =
    snapshot.diagnostics?.findings.filter((finding) => finding.severity !== "info").length ?? 0;

  const retry = useCallback(() => {
    // Force a fresh export: drop the cached snapshot and the loaded worker DB,
    // then bump the token to re-run the load effect.
    resetSqliteWorkerClient();
    useDiagnosticsCacheStore.getState().reset();
    setReloadToken((value) => value + 1);
  }, []);

  const setActiveTab = useCallback(
    (value: string) => {
      if (!isWorkbenchTab(value)) return;

      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const runIntegrityCheck = useCallback(() => {
    async function run() {
      const generation = ++integrityRunGeneration.current;
      const isCurrentRun = () => integrityRunGeneration.current === generation;

      setSnapshot((current) => ({
        ...current,
        integrityStatus: "loading",
        integrityError: null,
      }));

      try {
        const payload = await getSqliteWorkerClient().call(
          { kind: "runIntegrityCheck" },
          {
            timeoutMs: null,
            onProgress: (stage) => {
              if (isCurrentRun()) {
                setSnapshot((current) => ({ ...current, progressStage: stage }));
              }
            },
          }
        );
        if (!isCurrentRun()) return;
        setSnapshot((current) => {
          const existing = current.diagnostics?.findings ?? [];
          const withoutIntegrity = existing.filter(
            (finding) => finding.code !== "SQLITE_INTEGRITY_CHECK"
          );
          return {
            ...current,
            integrityStatus: "idle",
            integrityError: null,
            progressStage: "ready",
            diagnostics: {
              findings: [...withoutIntegrity, ...payload.findings],
            },
          };
        });
      } catch (error) {
        if (!isCurrentRun()) return;
        setSnapshot((current) => ({
          ...current,
          integrityStatus: "error",
          integrityError: getErrorMessage(error),
          progressStage: "ready",
        }));
      }
    }

    void run();
  }, [setSnapshot]);

  useEffect(() => {
    if (!connection) {
      integrityRunGeneration.current += 1;
      resetSqliteWorkerClient();
      useDiagnosticsCacheStore.getState().reset();
      return;
    }

    // Cache hit: the worker still holds this connection's DB and we already have
    // a ready snapshot — reuse it instead of re-downloading. Reload, connection
    // change, and disconnect all clear the cache, so a stale snapshot can't stick.
    const cache = useDiagnosticsCacheStore.getState();
    if (
      cache.signature === connectionSignature(connection) &&
      cache.snapshot.status === "ready" &&
      isSqliteWorkerLoadedFor(connection.id)
    ) {
      return;
    }

    let cancelled = false;
    const activeConnection = connection;

    async function openSnapshot() {
      integrityRunGeneration.current += 1;
      resetSqliteWorkerClient();
      setSnapshot({
        status: "loading",
        diagnosticsStatus: "idle",
        integrityStatus: "idle",
        progressStage: "exporting",
        errorMessage: null,
        diagnosticsError: null,
        integrityError: null,
        overview: null,
        diagnostics: null,
        download: null,
      });

      try {
        const exported = await exportSnapshot(activeConnection, (stage) => {
          if (!cancelled) {
            setSnapshot((current) => ({ ...current, progressStage: stage }));
          }
        });
        if (cancelled) return;
        // Worker now holds this connection's DB — record it so a later visit
        // (or the standalone Data Browser) can reuse it without re-exporting.
        markSqliteWorkerLoaded(activeConnection.id);
        const overview = await getSqliteWorkerClient().call(
          { kind: "overview" },
          {
            onProgress: (stage) => {
              if (!cancelled) {
                setSnapshot((current) => ({ ...current, progressStage: stage }));
              }
            },
          }
        );

        if (cancelled) return;

        setSnapshot({
          status: "ready",
          diagnosticsStatus: "loading",
          integrityStatus: "idle",
          progressStage: "ready",
          errorMessage: null,
          diagnosticsError: null,
          integrityError: null,
          overview,
          diagnostics: null,
          download: exported.download,
        });
        // Snapshot is now reusable across navigation; stamp the cache so the
        // mount guard above can short-circuit on return, and "loaded X ago" works.
        useDiagnosticsCacheStore
          .getState()
          .commitLoaded(activeConnection.id, connectionSignature(activeConnection));

        try {
          const diagnostics = await getSqliteWorkerClient().call(
            { kind: "runDiagnostics" },
            {
              onProgress: (stage) => {
                if (!cancelled) {
                  setSnapshot((current) => ({ ...current, progressStage: stage }));
                }
              },
            }
          );

          if (cancelled) return;

          setSnapshot((current) => ({
            ...current,
            diagnosticsStatus: "ready",
            diagnosticsError: null,
            progressStage: "ready",
            diagnostics,
          }));
        } catch (error) {
          if (cancelled) return;
          setSnapshot((current) => ({
            ...current,
            diagnosticsStatus: "error",
            diagnosticsError: getErrorMessage(error),
            progressStage: "ready",
          }));
        }
      } catch (error) {
        if (cancelled) return;
        setSnapshot({
          status: "error",
          diagnosticsStatus: "idle",
          integrityStatus: "idle",
          progressStage: null,
          errorMessage: getErrorMessage(error),
          diagnosticsError: null,
          integrityError: null,
          overview: null,
          diagnostics: null,
          download: null,
        });
      }
    }

    void openSnapshot();

    return () => {
      cancelled = true;
      integrityRunGeneration.current += 1;
      // Intentionally do NOT reset the worker here — keep the loaded DB alive so
      // returning to this page (or opening the Data Browser) reuses it without a
      // re-download. The worker is reset on explicit Reload, connection change,
      // or disconnect instead.
    };
  }, [
    connection,
    connection?.apiKey,
    connection?.baseUrl,
    connection?.budgetSyncId,
    connection?.encryptionPassword,
    connection?.id,
    reloadToken,
    setSnapshot,
  ]);

  if (!connection) {
    return <ConnectBudgetState />;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 flex-col border-b border-border bg-background lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="flex w-full shrink-0 border-b border-border bg-background lg:w-auto lg:min-w-[30rem] lg:border-b-0">
            <TabsTrigger
              value="overview"
              className={WORKBENCH_TAB_CLASS}
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="diagnostics"
              className={WORKBENCH_TAB_CLASS}
            >
              Diagnostics
              {snapshot.diagnosticsStatus === "ready" && (
                <TabCount>
                  {diagnosticsIssueCount > 0 ? diagnosticsIssueCount : diagnosticsCount}
                </TabCount>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="data"
              className={WORKBENCH_TAB_CLASS}
            >
              Data Browser
            </TabsTrigger>
          </TabsList>
          <div className="flex min-h-9 items-center gap-3 px-3 py-1.5 lg:justify-end">
            {snapshot.status === "ready" && loadedAt != null && (
              <span className="text-[11px] text-muted-foreground">
                Loaded <LoadedAgo at={loadedAt} />
              </span>
            )}
            {snapshot.status === "ready" && (
              <button
                type="button"
                onClick={retry}
                className="text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                title="Re-download the budget export and rebuild the snapshot"
              >
                Reload
              </button>
            )}
            <ReadOnlyNotice />
          </div>
        </div>

        <TabsContent
          value="overview"
          className="min-h-0 flex-1 overflow-auto px-4 py-4 lg:px-5"
        >
          <OverviewSection
            connection={connection}
            overview={snapshot.overview}
            download={snapshot.download}
            status={snapshot.status}
            diagnosticsStatus={snapshot.diagnosticsStatus}
            progressStage={snapshot.progressStage}
            errorMessage={snapshot.errorMessage}
            diagnosticsErrorMessage={snapshot.diagnosticsError}
            onRetry={retry}
          />
        </TabsContent>
        <TabsContent
          value="diagnostics"
          className="min-h-0 flex-1 overflow-auto px-4 py-4 lg:px-5"
        >
          <DiagnosticsSection
            diagnostics={snapshot.diagnostics}
            status={snapshot.diagnosticsStatus}
            errorMessage={snapshot.diagnosticsError}
            integrityStatus={snapshot.integrityStatus}
            integrityError={snapshot.integrityError}
            onRunIntegrityCheck={runIntegrityCheck}
          />
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-1 overflow-hidden">
          <DataBrowserSection snapshotStatus={snapshot.status} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
