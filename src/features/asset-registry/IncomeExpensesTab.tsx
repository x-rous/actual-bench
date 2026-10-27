"use client";
import { useState } from "react";
import type { AssetPerformance } from "@/lib/asset-registry/performance";
import type { Asset, Registry } from "@/lib/asset-registry/models";
import type { ExternalSnapshot } from "@/lib/asset-registry/cashflows";
import type { CapitalContext } from "@/lib/asset-registry/capitalActions";
import { yearsBetween } from "@/lib/asset-registry/yields";
import { CashflowPanel } from "./CashflowPanel";
import { ALL_TIME, effectiveRange, type AssetRange } from "./dateRange";
import { IncomeSummary } from "./ReportControls";
import type { OperatingEntry } from "./timeline";
import type { CashflowFocus } from "./TimelineSection";

/**
 * Income & Expenses: the KPI strip and the table share one date range (the whole history until the user picks another), so the
 * tiles always add up to the rows below. A chart click-through narrows both to its period until cleared.
 */
export function IncomeExpensesTab({ asset, registry, external, categories, today, firstDate, operating, reportFor, valueAt, focus, onClearFocus, fresh, ensureExternal, onSaved }: {
  asset: Asset; registry: Registry; external: ExternalSnapshot; categories?: { id: string; isIncome: boolean }[]; today: string;
  /** The date of the asset's first ledger entry: where "all time" starts. */ firstDate: string;
  operating: OperatingEntry[];
  reportFor: (from: string, to: string) => AssetPerformance | undefined; valueAt: (on: string) => number | null;
  focus?: CashflowFocus | null; onClearFocus: () => void;
  fresh: (date: string, accountIds?: string[]) => Promise<CapitalContext>; ensureExternal: (accountIds: string[]) => Promise<ExternalSnapshot>;
  onSaved: (registry?: Registry) => Promise<void>;
}) {
  const [range, setRange] = useState<AssetRange>(ALL_TIME);
  const span = focus ? { from: focus.from, to: focus.to < today ? focus.to : today, years: yearsBetween(focus.from, focus.to < today ? focus.to : today) } : effectiveRange(range, today, firstDate);
  return <>
    <IncomeSummary entries={operating} from={span.from} to={span.to} performance={reportFor(span.from, span.to)} valueMinor={valueAt(span.to)} years={span.years} />
    <CashflowPanel asset={asset} registry={registry} external={external} categories={categories} focus={focus} onClearFocus={onClearFocus} range={range} onRangeChange={setRange} today={today} fresh={fresh} ensureExternal={ensureExternal} onSaved={onSaved} />
  </>;
}
