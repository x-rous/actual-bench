"use client";

import { useCallback } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LockKeyhole, Stethoscope } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DirectModeUnavailable } from "@/components/DirectModeUnavailable";
import {
  isBrowserApiConnection,
  selectActiveInstance,
  useConnectionStore,
} from "@/store/connection";
import { useDiagnosticsSnapshot } from "../hooks/useDiagnosticsSnapshot";
import { SnapshotReloadControls } from "./SnapshotReloadControls";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { OverviewSection } from "./OverviewSection";
import type { WorkbenchTab } from "./WorkbenchSummaryBar";

const WORKBENCH_TABS: readonly WorkbenchTab[] = ["overview", "diagnostics"];
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
          Budget File Health opens an exported snapshot from the active connection.
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeConnection = useConnectionStore(selectActiveInstance);
  // Snapshot loading/caching (incl. reload + integrity check) lives in a shared
  // hook so the standalone Data Browser reuses the exact same cache + worker.
  const { connection, snapshot, loadedAt, retry, runIntegrityCheck } =
    useDiagnosticsSnapshot();
  const tabParam = searchParams.get("tab");
  const activeTab: WorkbenchTab = isWorkbenchTab(tabParam) ? tabParam : "overview";
  const diagnosticsCount = snapshot.diagnostics?.findings.length ?? 0;
  const diagnosticsIssueCount =
    snapshot.diagnostics?.findings.filter((finding) => finding.severity !== "info").length ?? 0;

  const setActiveTab = useCallback(
    (value: string) => {
      if (!isWorkbenchTab(value)) return;

      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  if (isBrowserApiConnection(activeConnection)) {
    return (
      <DirectModeUnavailable
        title="Budget File Health needs HTTP API Server mode"
        description="Direct mode does not have a safe browser API export helper yet, so snapshot diagnostics are unavailable for this connection."
        detail="Use an HTTP API Server connection for Budget File Health and Data Browser until Direct export support is added."
      />
    );
  }

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
          </TabsList>
          <div className="flex min-h-9 items-center gap-3 px-3 py-1.5 lg:justify-end">
            <SnapshotReloadControls
              status={snapshot.status}
              loadedAt={loadedAt}
              onReload={retry}
            />
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
      </Tabs>
    </main>
  );
}
