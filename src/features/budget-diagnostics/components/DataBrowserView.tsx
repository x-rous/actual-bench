"use client";

import Link from "next/link";
import { ArrowRight, Database, Loader2, LockKeyhole } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DirectModeUnavailable } from "@/components/DirectModeUnavailable";
import { cn } from "@/lib/utils";
import {
  isBrowserApiConnection,
  selectActiveInstance,
  useConnectionStore,
} from "@/store/connection";
import { useDiagnosticsSnapshot } from "../hooks/useDiagnosticsSnapshot";
import { DataBrowserSection } from "./DataBrowserSection";
import { SnapshotReloadControls } from "./SnapshotReloadControls";

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

function ConnectState() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <section className="w-full max-w-lg rounded-md border border-border bg-background p-6 shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Database className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Connect a budget first</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The Data Browser opens an exported snapshot from the active connection.
        </p>
        <Link href="/connect" className={cn(buttonVariants({ className: "mt-5" }))}>
          Go to connection
          <ArrowRight data-icon="inline-end" />
        </Link>
      </section>
    </main>
  );
}

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <div className="text-sm font-medium">Loading budget data…</div>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">
        Downloading and opening the budget export. This happens once. Afterwards it stays
        cached, so returning here is instant.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div className="text-sm font-medium text-destructive">Couldn’t open the budget data</div>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">
        {message ?? "The budget export could not be loaded."}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * Standalone Data Browser page. Reuses the shared diagnostics snapshot cache, so
 * once the budget has been opened (here or on the Budget Diagnostics page) it
 * loads instantly without re-downloading.
 */
export function DataBrowserView() {
  const activeConnection = useConnectionStore(selectActiveInstance);
  const { connection, snapshot, loadedAt, retry } = useDiagnosticsSnapshot();

  if (isBrowserApiConnection(activeConnection)) {
    return (
      <DirectModeUnavailable
        title="Data Browser needs HTTP API Server mode"
        description="Direct mode cannot export the full budget database for local SQLite browsing yet."
        detail="Use an HTTP API Server connection for raw SQLite table browsing until Direct export support is added."
      />
    );
  }

  if (!connection) {
    return <ConnectState />;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-4 w-4 text-muted-foreground" />
          Data Browser
        </div>
        <div className="flex items-center gap-3">
          <SnapshotReloadControls
            status={snapshot.status}
            loadedAt={loadedAt}
            onReload={retry}
          />
          <ReadOnlyNotice />
        </div>
      </div>

      {snapshot.status === "error" ? (
        <ErrorState message={snapshot.errorMessage} onRetry={retry} />
      ) : snapshot.status === "ready" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <DataBrowserSection snapshotStatus={snapshot.status} />
        </div>
      ) : (
        <LoadingState />
      )}
    </main>
  );
}
