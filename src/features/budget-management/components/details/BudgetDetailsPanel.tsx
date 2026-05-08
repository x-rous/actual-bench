"use client";

import { useMemo } from "react";
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
import { buildBudgetTransactionBrowserOptions } from "../../lib/budgetTransactionBrowser";
import { useAllNotes } from "@/hooks/useAllNotes";
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

const EMPTY_INCOME_CATEGORY_IDS: string[] = [];

function firstLoadedIncomeCategoryIds(
  states: Array<LoadedMonthState | undefined>
): string[] {
  for (const state of states) {
    if (!state) continue;
    return Object.values(state.categoriesById)
      .filter((category) => category.isIncome)
      .map((category) => category.id);
  }
  return EMPTY_INCOME_CATEGORY_IDS;
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
  const availableMonthSet = useMemo(
    () => new Set(availableMonths ?? []),
    [availableMonths]
  );

  const monthQueries = useMemo(
    () => displayMonths.map((month) => ({
      ...budgetMonthDataQueryOptions(connection, month),
      enabled: !!connection && !!month && availableMonthSet.has(month),
    })),
    [availableMonthSet, connection, displayMonths]
  );

  const queries = useQueries({
    queries: monthQueries,
  });

  const dataArr = useMemo(
    () => queries.map((query) => query.data),
    [queries]
  );
  const isMonthLoading = useMemo(
    () => queries.some((query) => query.isLoading),
    [queries]
  );
  const monthQueryError = useMemo(
    () =>
      queries.find((query, index) => {
        const month = displayMonths[index];
        return (
          query.isError && !isMissingBudgetMonthError(query.error, month)
        );
      })?.error,
    [displayMonths, queries]
  );

  const incomeCategoryIds = isTracking
    ? firstLoadedIncomeCategoryIds(dataArr)
    : EMPTY_INCOME_CATEGORY_IDS;

  const {
    data: incomeBudgets,
    isLoading: incomeBudgetsLoading,
    error: incomeBudgetsError,
  } = useIncomeBudgets(incomeCategoryIds, isTracking);

  const hasMonthQueryError = monthQueryError != null;
  const hasIncomeBudgetsError = isTracking && incomeBudgetsError != null;

  const statesByMonth = useMemo(() => {
    const result = new Map<string, LoadedMonthState>();
    if (hasMonthQueryError || hasIncomeBudgetsError) return result;

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
  }, [
    dataArr,
    displayMonths,
    edits,
    hasIncomeBudgetsError,
    hasMonthQueryError,
    incomeBudgets,
    isTracking,
  ]);

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
      edits,
      rowSelection,
      selectedCategoryId,
      selectedGroupId,
      selectedMonth,
      statesByMonth,
    ]
  );
  const transactionBrowserOptions = useMemo(
    () => buildBudgetTransactionBrowserOptions(model),
    [model]
  );

  const { data: allNotes } = useAllNotes();
  const note = (() => {
    if (selectedCategoryId && selectedMonth) {
      return allNotes?.get(`${selectedCategoryId}-${selectedMonth}`) ?? "";
    }
    if (rowSelection?.kind === "category" || rowSelection?.kind === "group") {
      return allNotes?.get(rowSelection.id) ?? "";
    }
    return "";
  })();

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
      <EnvelopeDetailsPanel
        metrics={buildEnvelopeDetailsMetrics(model)}
        transactionBrowserOptions={transactionBrowserOptions}
        statesByMonth={statesByMonth}
        note={note}
      />
    );
  }

  return (
    <TrackingDetailsPanel
      metrics={buildTrackingDetailsMetrics(model)}
      transactionBrowserOptions={transactionBrowserOptions}
      statesByMonth={statesByMonth}
      note={note}
    />
  );
}
