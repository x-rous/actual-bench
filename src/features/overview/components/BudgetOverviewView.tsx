"use client";

import { useState } from "react";
import { BundleExportDialog } from "@/features/bundle/components/BundleExportDialog";
import { BundleImportDialog } from "@/features/bundle/components/BundleImportDialog";
import { useBudgetOverview } from "../hooks/useBudgetOverview";
import { useOverviewHeaderState } from "../hooks/useOverviewHeaderState";
import { OverviewHeader } from "./OverviewHeader";
import { OverviewNavigationSection } from "./OverviewNavigationSection";
import { OverviewStatsSection } from "./OverviewStatsSection";

export function BudgetOverviewView() {
  const { snapshot, isLoading, refresh } = useBudgetOverview();
  const headerState = useOverviewHeaderState({
    hasStats: !!snapshot,
    isLoading,
    refresh,
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
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

          <OverviewStatsSection
            snapshot={
              headerState.isRefreshing
                ? undefined
                : snapshot ?? undefined
            }
            isLoading={isLoading || headerState.isRefreshing}
          />
        </div>

        <OverviewNavigationSection />
      </div>

      <BundleExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <BundleImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
