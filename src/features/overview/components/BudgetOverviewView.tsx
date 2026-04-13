"use client";

import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { useBudgetOverview } from "../hooks/useBudgetOverview";
import { useOverviewHeaderState } from "../hooks/useOverviewHeaderState";
import { OverviewHeader } from "./OverviewHeader";
import { OverviewNavigationSection } from "./OverviewNavigationSection";
import { OverviewStatsSection } from "./OverviewStatsSection";

export function BudgetOverviewView() {
  const { snapshot, isLoading, refresh } = useBudgetOverview();
  const connection = useConnectionStore(selectActiveInstance);
  const headerState = useOverviewHeaderState({
    hasStats: !!snapshot,
    isLoading,
    refresh,
  });

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="space-y-3">
          <OverviewHeader
            budgetLabel={connection?.label ?? ""}
            statusLabel={headerState.statusLabel}
            statusDotClass={headerState.statusDotClass}
            refreshButtonLabel={headerState.refreshButtonLabel}
            refreshStatusLabel={headerState.refreshStatusLabel}
            isRefreshing={headerState.isRefreshing}
            onRefresh={headerState.handleRefresh}
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
    </div>
  );
}
