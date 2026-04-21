"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LockKeyhole, Stethoscope } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DownloadResult } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { exportSnapshot } from "../lib/exportSnapshot";
import {
  getSqliteWorkerClient,
  resetSqliteWorkerClient,
} from "../lib/sqliteWorkerClient";
import type { DiagnosticsPayload, OverviewPayload, ProgressStage } from "../types";
import { DataBrowserSection } from "./DataBrowserSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { OverviewSection } from "./OverviewSection";
import type { WorkbenchTab } from "./WorkbenchSummaryBar";

type SnapshotState = {
  status: "idle" | "loading" | "ready" | "error";
  diagnosticsStatus: "idle" | "loading" | "ready" | "error";
  integrityStatus: "idle" | "loading" | "error";
  progressStage: ProgressStage | null;
  errorMessage: string | null;
  diagnosticsError: string | null;
  integrityError: string | null;
  overview: OverviewPayload | null;
  diagnostics: DiagnosticsPayload | null;
  download: DownloadResult | null;
};

const INITIAL_SNAPSHOT_STATE: SnapshotState = {
  status: "idle",
  diagnosticsStatus: "idle",
  integrityStatus: "idle",
  progressStage: null,
  errorMessage: null,
  diagnosticsError: null,
  integrityError: null,
  overview: null,
  diagnostics: null,
  download: null,
};

const WORKBENCH_TABS: readonly WorkbenchTab[] = ["overview", "diagnostics", "data"];

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
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        Read-only local snapshot. Nothing is written back to the budget.
      </span>
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

export function BudgetDiagnosticsView() {
  const connection = useConnectionStore(selectActiveInstance);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [reloadToken, setReloadToken] = useState(0);
  const [snapshot, setSnapshot] = useState<SnapshotState>(INITIAL_SNAPSHOT_STATE);
  const tabParam = searchParams.get("tab");
  const activeTab: WorkbenchTab = isWorkbenchTab(tabParam) ? tabParam : "overview";
  const diagnosticsCount = snapshot.diagnostics?.findings.length ?? 0;
  const diagnosticsIssueCount =
    snapshot.diagnostics?.findings.filter((finding) => finding.severity !== "info").length ?? 0;

  const retry = useCallback(() => {
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
              setSnapshot((current) => ({ ...current, progressStage: stage }));
            },
          }
        );
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
        setSnapshot((current) => ({
          ...current,
          integrityStatus: "error",
          integrityError: getErrorMessage(error),
          progressStage: "ready",
        }));
      }
    }

    void run();
  }, []);

  useEffect(() => {
    if (!connection) {
      resetSqliteWorkerClient();
      return;
    }

    let cancelled = false;
    const activeConnection = connection;

    async function openSnapshot() {
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
      resetSqliteWorkerClient();
    };
  }, [
    connection,
    connection?.apiKey,
    connection?.baseUrl,
    connection?.budgetSyncId,
    connection?.encryptionPassword,
    connection?.id,
    reloadToken,
  ]);

  if (!connection) {
    return <ConnectBudgetState />;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="min-h-0 gap-3"
          >
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <TabsList className="flex w-full shrink-0 border-b border-border lg:w-auto lg:min-w-[28rem]">
                  <TabsTrigger
                    value="overview"
                    className="group flex flex-1 items-center justify-center gap-1 border-b-2 border-transparent px-2 py-2 text-[12px] font-medium transition-colors after:hidden data-[active]:border-primary data-[active]:text-foreground lg:flex-none lg:px-15"
                  >
                    Overview
                  </TabsTrigger>
                  <TabsTrigger
                    value="diagnostics"
                    className="group flex flex-1 items-center justify-center gap-1 border-b-2 border-transparent px-2 py-2 text-[12px] font-medium transition-colors after:hidden data-[active]:border-primary data-[active]:text-foreground lg:flex-none lg:px-15"
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
                    className="group flex flex-1 items-center justify-center gap-1 border-b-2 border-transparent px-2 py-2 text-[12px] font-medium transition-colors after:hidden data-[active]:border-primary data-[active]:text-foreground lg:flex-none lg:px-5"
                  >
                    Data Browser
                  </TabsTrigger>
                </TabsList>
                <ReadOnlyNotice />
              </div>
            </div>

            <TabsContent value="overview" className="min-h-0">
              <OverviewSection
                connection={connection}
                overview={snapshot.overview}
                download={snapshot.download}
                status={snapshot.status}
                progressStage={snapshot.progressStage}
                errorMessage={snapshot.errorMessage}
                onRetry={retry}
              />
            </TabsContent>
            <TabsContent value="diagnostics" className="min-h-0">
              <DiagnosticsSection
                diagnostics={snapshot.diagnostics}
                status={snapshot.diagnosticsStatus}
                errorMessage={snapshot.diagnosticsError}
                integrityStatus={snapshot.integrityStatus}
                integrityError={snapshot.integrityError}
                onRunIntegrityCheck={runIntegrityCheck}
              />
            </TabsContent>
            <TabsContent value="data" className="min-h-0">
              <DataBrowserSection />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}
