"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useBudgetMode } from "../../hooks/useBudgetMode";
import { useIncomeBudgets } from "../../hooks/useIncomeBudgets";
import { budgetMonthDataQueryOptions } from "../../lib/monthDataQuery";
import { computeEffectiveMonthState } from "../../lib/effectiveMonth";
import {
  buildBudgetDetailsModel,
} from "../../lib/budgetDetailsModel";
import {
  buildEnvelopeDetailsMetrics,
  buildTrackingDetailsMetrics,
} from "../../lib/budgetDetailsMetrics";
import { EnvelopeDetailsPanel } from "./EnvelopeDetailsPanel";
import { TrackingDetailsPanel } from "./TrackingDetailsPanel";
import type { BudgetMode, LoadedMonthState } from "../../types";

function EmptyDetailsState({ message }: { message: string }) {
  return (
    <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
      {message}
    </div>
  );
}

/**
 * Mode-aware Budget Management side-panel content.
 *
 * This component is mounted outside the grid's `MonthsDataProvider`, so it
 * loads the visible months through the same TanStack Query keys and computes
 * effective states with the same cascade helper used by the grid.
 */
export function BudgetDetailsPanel() {
  const connection = useConnectionStore(selectActiveInstance);
  const { data: budgetModeRaw, isLoading: modeLoading } = useBudgetMode();
  const budgetMode: BudgetMode = budgetModeRaw ?? "unidentified";
  const isTracking = budgetMode === "tracking";

  const edits = useBudgetEditsStore((s) => s.edits);
  const {
    categoryId: selectedCategoryId,
    groupId: selectedGroupId,
    month: selectedMonth,
  } =
    useBudgetEditsStore((s) => s.uiSelection);
  const rowSelection = useBudgetEditsStore((s) => s.rowSelection);
  const displayMonths = useBudgetEditsStore((s) => s.displayMonths);

  const queries = useQueries({
    queries: displayMonths.map((month) => ({
      ...budgetMonthDataQueryOptions(connection, month),
      enabled: !!connection && !!month,
    })),
  });

  const dataArr = queries.map((query) => query.data);
  const isMonthLoading = queries.some((query) => query.isLoading);

  const incomeCategoryIds = useMemo(() => {
    if (!isTracking) return [];
    for (const data of dataArr) {
      if (!data) continue;
      return Object.values(data.categoriesById)
        .filter((category) => category.isIncome)
        .map((category) => category.id);
    }
    return [];
    // dataArr is recreated every render; element identities are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTracking, ...dataArr]);

  const {
    data: incomeBudgets,
    isLoading: incomeBudgetsLoading,
  } = useIncomeBudgets(incomeCategoryIds, isTracking);

  const statesByMonth = useMemo(() => {
    const result = new Map<string, LoadedMonthState>();
    for (let i = 0; i < displayMonths.length; i++) {
      const month = displayMonths[i];
      const serverState = dataArr[i];
      if (!month || !serverState) continue;
      const effective = computeEffectiveMonthState({
        serverState,
        allEdits: edits,
        isTracking,
        incomeBudgets,
        month,
      });
      if (effective) result.set(month, effective);
    }
    return result;
    // dataArr is recreated every render; element identities are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMonths, edits, isTracking, incomeBudgets, ...dataArr]);

  const model = useMemo(
    () =>
      buildBudgetDetailsModel({
        budgetMode,
        displayMonths,
        statesByMonth,
        rowSelection,
        selectedCategoryId,
        selectedGroupId,
        selectedMonth,
        edits,
      }),
    [
      budgetMode,
      displayMonths,
      statesByMonth,
      rowSelection,
      selectedCategoryId,
      selectedGroupId,
      selectedMonth,
      edits,
    ]
  );

  if (displayMonths.length === 0) {
    return <EmptyDetailsState message="Loading..." />;
  }

  const isLoading =
    modeLoading || isMonthLoading || (isTracking && incomeBudgetsLoading);
  if (isLoading && statesByMonth.size === 0) {
    return <EmptyDetailsState message="Loading..." />;
  }

  if (budgetMode === "unidentified") {
    return (
      <EmptyDetailsState message="Budget mode is unknown for this connection." />
    );
  }

  if (budgetMode === "envelope") {
    return (
      <EnvelopeDetailsPanel metrics={buildEnvelopeDetailsMetrics(model)} />
    );
  }

  return (
    <TrackingDetailsPanel metrics={buildTrackingDetailsMetrics(model)} />
  );
}
