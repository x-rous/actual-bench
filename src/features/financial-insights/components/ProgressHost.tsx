"use client";

import { useMemo } from "react";
import { progressView } from "@/lib/financial-insights/progress";
import { isFixedAssetAccount, type PropertySeries } from "@/lib/financial-insights/wealth";
import type { ReadyData } from "../hooks/useFinancialInsights";
import type { ProgressSwitches } from "../hooks/useProgressSwitches";
import { useWealth } from "../hooks/useWealth";
import { ProgressTab } from "./ProgressTab";

const NO_PROPERTIES: PropertySeries[] = [];

/**
 * Builds the share-safe view from the page's data and hands the tab nothing else. It is also where the property values are read,
 * only once this tab is open, because the home cards need each linked asset's loan-to-value by month.
 */
export function ProgressHost({ data, today, switches, onSwitches }: { data: ReadyData; today: string; switches: ProgressSwitches; onSwitches: (change: Partial<ProgressSwitches>) => void }) {
  const wealth = useWealth(data);
  // Still being read: null, and the tab says so. If the read failed there is nothing to draw, and no home card is offered.
  const equity = wealth.state === "ready" ? wealth.properties : wealth.state === "error" ? NO_PROPERTIES : null;
  // Some or all of the property values could not be read: the home cards that depend on them are not drawn, and the tab says so once.
  // That includes a property whose value history could not be used (it does not reconcile, has too many entries, or the registry could not be read): it would otherwise just be missing.
  const equityFailed = wealth.state === "error" || (wealth.state === "ready" && (wealth.hasFailedBooks || missingProperty(data, wealth.properties)));
  const view = useMemo(() => progressView({
    today, period: data.period, ledger: data.ledger, summary: data.summary, monthly: data.monthly, composition: data.composition, buffer: data.buffer, bufferSettings: data.bufferSettings, bufferSchedules: data.bufferSchedules, schedules: data.schedules, equity, equityFailed,
  }), [today, data.period, data.ledger, data.summary, data.monthly, data.composition, data.buffer, data.bufferSettings, data.bufferSchedules, data.schedules, equity, equityFailed]);
  return <ProgressTab view={view} switches={switches} onSwitches={onSwitches} />;
}

/** Whether an active fixed asset has no series: its card cannot be drawn, so the tab says so rather than leave it out silently. */
function missingProperty(data: ReadyData, properties: readonly PropertySeries[]): boolean {
  const { registry, ledger } = data;
  if (!registry.read) return true;
  const drawn = new Set(properties.map((l) => l.assetId));
  return registry.assets.some((a) => a.status !== "archived" && isFixedAssetAccount(ledger.account.get(a.actualAccountId) ?? { accountClass: "bank", treatment: null }) && !drawn.has(a.id));
}
