"use client";

import { useQueries } from "@tanstack/react-query";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useAvailableMonths } from "../../hooks/useAvailableMonths";
import { useBudgetMode } from "../../hooks/useBudgetMode";
import { useIncomeBudgets } from "../../hooks/useIncomeBudgets";
import {
  budgetMonthDataQueryOptions,
  getMonthDataErrorMessage,
  isMissingBudgetMonthError,
} from "../../lib/monthDataQuery";
import { computeEffectiveMonthState } from "../../lib/effectiveMonth";
import { buildBudgetDetailsModel } from "../../lib/budgetDetailsModel";
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
  const {
    data: availableMonths,
    isLoading: availableMonthsLoading,
    error: availableMonthsError,
  } = useAvailableMonths();
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
  const availableMonthSet = new Set(availableMonths ?? []);

  const queries = useQueries({
    queries: displayMonths.map((month) => ({
      ...budgetMonthDataQueryOptions(connection, month),
      enabled: !!connection && !!month && availableMonthSet.has(month),
    })),
  });

  const dataArr = queries.map((query) => query.data);
  const isMonthLoading = queries.some((query) => query.isLoading);
  const monthQueryError = queries.find((query, index) => {
    const month = displayMonths[index];
    return query.isError && !isMissingBudgetMonthError(query.error, month);
  })?.error;

  const incomeCategoryIds = (() => {
    if (!isTracking) return [];
    for (const data of dataArr) {
      if (!data) continue;
      return Object.values(data.categoriesById)
        .filter((category) => category.isIncome)
        .map((category) => category.id);
    }
    return [];
  })();

  const {
    data: incomeBudgets,
    isLoading: incomeBudgetsLoading,
    error: incomeBudgetsError,
  } = useIncomeBudgets(incomeCategoryIds, isTracking);

  const hasMonthQueryError = monthQueryError != null;
  const hasIncomeBudgetsError = isTracking && incomeBudgetsError != null;

  const statesByMonth = new Map<string, LoadedMonthState>();
  if (!hasMonthQueryError && !hasIncomeBudgetsError) {
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
      if (effective) statesByMonth.set(month, effective);
    }
  }

  const model = buildBudgetDetailsModel({
    budgetMode,
    displayMonths,
    statesByMonth,
    rowSelection,
    selectedCategoryId,
    selectedGroupId,
    selectedMonth,
    edits,
  });

  if (displayMonths.length === 0) {
    return <EmptyDetailsState message="Loading..." />;
  }

  if (availableMonthsError) {
    return (
      <EmptyDetailsState
        message={`Budget details could not load available months: ${getMonthDataErrorMessage(availableMonthsError)}`}
      />
    );
  }

  if (monthQueryError) {
    return (
      <EmptyDetailsState
        message={`Budget details could not load month data: ${getMonthDataErrorMessage(monthQueryError)}`}
      />
    );
  }

  if (hasIncomeBudgetsError) {
    return (
      <EmptyDetailsState
        message={`Budget details could not load Tracking income budgets: ${getMonthDataErrorMessage(incomeBudgetsError)}`}
      />
    );
  }

  const isLoading =
    modeLoading ||
    availableMonthsLoading ||
    isMonthLoading ||
    (isTracking && incomeBudgetsLoading);
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
