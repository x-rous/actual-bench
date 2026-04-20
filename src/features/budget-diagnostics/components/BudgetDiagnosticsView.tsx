"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole, Stethoscope } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { DownloadResult } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { exportSnapshot } from "../lib/exportSnapshot";
import {
  getSqliteWorkerClient,
  resetSqliteWorkerClient,
} from "../lib/sqliteWorkerClient";
import type { OverviewPayload, ProgressStage } from "../types";
import { DataBrowserSection } from "./DataBrowserSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { OverviewSection } from "./OverviewSection";

type SnapshotState = {
  status: "idle" | "loading" | "ready" | "error";
  progressStage: ProgressStage | null;
  errorMessage: string | null;
  overview: OverviewPayload | null;
  download: DownloadResult | null;
};

const INITIAL_SNAPSHOT_STATE: SnapshotState = {
  status: "idle",
  progressStage: null,
  errorMessage: null,
  overview: null,
  download: null,
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to open the budget snapshot.";
}

function ReadOnlyNotice() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/35 px-4 py-3 text-sm">
      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium text-foreground">Read-only diagnostics</p>
        <p className="mt-1 text-muted-foreground">
          No changes are written back to the budget. Export contents are processed locally in the browser.
        </p>
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

export function BudgetDiagnosticsView() {
  const connection = useConnectionStore(selectActiveInstance);
  const [reloadToken, setReloadToken] = useState(0);
  const [snapshot, setSnapshot] = useState<SnapshotState>(INITIAL_SNAPSHOT_STATE);

  const retry = useCallback(() => {
    setReloadToken((value) => value + 1);
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
        progressStage: "exporting",
        errorMessage: null,
        overview: null,
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
          progressStage: "ready",
          errorMessage: null,
          overview,
          download: exported.download,
        });
      } catch (error) {
        if (cancelled) return;
        setSnapshot({
          status: "error",
          progressStage: null,
          errorMessage: getErrorMessage(error),
          overview: null,
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
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Tools
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Budget Diagnostics
            </h1>
          </div>
          <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            Active budget: <span className="font-medium text-foreground">{connection.label}</span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <ReadOnlyNotice />
          <OverviewSection
            connection={connection}
            overview={snapshot.overview}
            download={snapshot.download}
            status={snapshot.status}
            progressStage={snapshot.progressStage}
            errorMessage={snapshot.errorMessage}
            onRetry={retry}
          />
          <DiagnosticsSection />
          <DataBrowserSection />
        </div>
      </div>
    </main>
  );
}
