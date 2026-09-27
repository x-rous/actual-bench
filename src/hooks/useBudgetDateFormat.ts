"use client";

import { useContext, useSyncExternalStore } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type { BudgetPreferences } from "@/lib/api/preferences";
import { DEFAULT_DATE_FORMAT } from "@/lib/dates/typedDate";

const noop = () => () => {};

/**
 * The open budget's date format (Settings → Formatting), for date fields.
 *
 * Reads what `useBudgetPreferences` (kept fetched by the app shell) already
 * holds, rather than starting its own query, so a date field works anywhere,
 * including outside a query provider, and falls back to Actual's default
 * until the budget's preferences arrive.
 */
export function useBudgetDateFormat(): string {
  const client = useContext(QueryClientContext);
  const connectionId = useConnectionStore((state) => selectActiveInstance(state)?.id);
  const read = () =>
    client?.getQueryData<BudgetPreferences>(["budgetPreferences", connectionId])?.dateFormat;
  const dateFormat = useSyncExternalStore(
    client ? (onChange) => client.getQueryCache().subscribe(onChange) : noop,
    read,
    () => undefined
  );
  return dateFormat ?? DEFAULT_DATE_FORMAT;
}
