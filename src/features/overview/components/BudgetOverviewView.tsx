"use client";

import { useState } from "react";
import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";
import { BundleExportDialog } from "@/features/bundle/components/BundleExportDialog";
import { BundleImportDialog } from "@/features/bundle/components/BundleImportDialog";
import { useBudgetOverview } from "../hooks/useBudgetOverview";
import { useOverviewHeaderState } from "../hooks/useOverviewHeaderState";
import { OverviewHeader } from "./OverviewHeader";
import { OverviewNavigationSection } from "./OverviewNavigationSection";
import { OverviewStatsSection } from "./OverviewStatsSection";

export function BudgetOverviewView() {
  const { snapshot, isLoading, hasPartialFailure, dataUpdatedAt, refresh } = useBudgetOverview();
  const headerState = useOverviewHeaderState({
    loadedAt: snapshot ? dataUpdatedAt : null,
    hasPartialFailure,
    refresh,
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <OverlayScrollArea className="flex-1">
      {/* Wider than the usual reading column on purpose: this is a launcher,
          not prose, and the cards are what the width is for. Capped rather than
          full-bleed so the stats row does not stretch into a ticker tape on an
          ultrawide display. */}
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="space-y-3">
          <OverviewHeader
            refreshButtonLabel={headerState.refreshButtonLabel}
            refreshStatusLabel={headerState.refreshStatusLabel}
            isRefreshing={headerState.isRefreshing}
            onRefresh={headerState.handleRefresh}
            onExportBundle={() => setExportOpen(true)}
            onImportBundle={() => setImportOpen(true)}
          />

          {/* A refresh keeps the figures in place, dimmed, rather than blanking the whole row. */}
          <OverviewStatsSection
            snapshot={snapshot ?? undefined}
            isLoading={isLoading}
            isRefreshing={headerState.isRefreshing}
          />
          {hasPartialFailure && !isLoading && !headerState.isRefreshing && (
            <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
              Some figures could not be read (shown as -). Press Refresh to try again.
            </p>
          )}
        </div>

        <OverviewNavigationSection />
      </div>

      <BundleExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <BundleImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </OverlayScrollArea>
  );
}
