"use client";

import { useCallback } from "react";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";

/** The Progress tab's two per-viewer choices, kept like the other Financial Insights filters. They only change how the cards are drawn. */
export type ProgressSwitches = { showDates: boolean; footer: boolean };

export function useProgressSwitches(): { switches: ProgressSwitches; change: (change: Partial<ProgressSwitches>) => void } {
  const [switches, setSwitches] = usePersistedFilters<ProgressSwitches>("filters:financial-insights-progress", { showDates: true, footer: true });
  const change = useCallback((next: Partial<ProgressSwitches>) => setSwitches((s) => ({ ...s, ...next })), [setSwitches]);
  return { switches, change };
}
