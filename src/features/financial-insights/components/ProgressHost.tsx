"use client";

import { useMemo } from "react";
import type { PeriodChoice } from "@/lib/financial-insights/period";
import { progressView } from "@/lib/financial-insights/progress";
import type { LinkedEquitySeries } from "@/lib/financial-insights/wealth";
import type { ReadyData } from "../hooks/useFinancialInsights";
import type { ProgressSwitches } from "../hooks/useProgressSwitches";
import { useWealth } from "../hooks/useWealth";
import { ProgressTab } from "./ProgressTab";

const NO_EQUITY: LinkedEquitySeries[] = [];

/**
 * Builds the share-safe view from the page's data and hands the tab nothing else. It is also where the property values are read,
 * only once this tab is open, because the home cards need each linked asset's loan-to-value by month.
 */
export function ProgressHost({ data, today, period, onPeriod, switches, onSwitches }: { data: ReadyData; today: string; period: PeriodChoice; onPeriod: (period: PeriodChoice) => void; switches: ProgressSwitches; onSwitches: (change: Partial<ProgressSwitches>) => void }) {
  const wealth = useWealth(data);
  // Still being read: null, and the tab says so. If the read failed there is nothing to draw, and no home card is offered.
  const equity = wealth.state === "ready" ? wealth.linked : wealth.state === "error" ? NO_EQUITY : null;
  // Some or all of the property values could not be read: the home cards that depend on them are not drawn, and the tab says so once.
  const equityFailed = wealth.state === "error" || (wealth.state === "ready" && wealth.hasFailedBooks);
  const allTime = period.kind === "preset" && period.id === "all";
  const view = useMemo(() => progressView({
    today, period: data.period, ledger: data.ledger, summary: data.summary, monthly: data.monthly, composition: data.composition, buffer: data.buffer, schedules: data.schedules, equity, equityFailed, allTime,
  }), [today, data.period, data.ledger, data.summary, data.monthly, data.composition, data.buffer, data.schedules, equity, equityFailed, allTime]);
  return <ProgressTab view={view} switches={switches} onSwitches={onSwitches} onSeeAllTime={allTime ? undefined : () => onPeriod({ kind: "preset", id: "all" })} />;
}
