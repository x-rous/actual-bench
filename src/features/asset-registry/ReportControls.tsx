"use client";
import type { AssetPerformance } from "@/lib/asset-registry/performance";
import { assetMoney, SummaryStrip } from "./AssetPresentation";
export const percent = (value: number | null | undefined) => value == null ? "N/A" : `${value.toFixed(2)}%`;
/** Gaps are detectable inputs only; Bench cannot know about unlinked real-world cashflow. */
export function PerformanceGaps({ gaps }: { gaps: string[] }) {
  return gaps.length > 0 ? <details className="border-b px-4 py-2 text-xs"><summary className="cursor-pointer font-medium">Performance incomplete · {gaps.length} detectable {gaps.length === 1 ? "gap" : "gaps"}</summary><ul className="mt-2 list-disc space-y-1 pl-4">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></details> : null;
}
export function IncomeSummary({ performance }: { performance?: AssetPerformance }) {
  return <><SummaryStrip label="Asset income and returns summary" items={[
    { label: "Operating Result", value: assetMoney(performance?.operatingMinor), detail: "Linked income less expenses · excludes CapEx, proceeds, selling costs and principal" },
    { label: "Operating Yield", value: percent(performance?.operatingYield), detail: "Operating Result / (Opening + Capital Added)" },
    { label: "Total Result", value: assetMoney(performance?.totalMinor), detail: "Close − Open − Capital Added + Net Proceeds + Operating Result" },
    { label: "Simple Total Return", value: percent(performance?.simpleReturn), detail: "Non-annualized, non-time-weighted" },
  ]} /><PerformanceGaps gaps={performance?.gaps ?? []} /></>;
}
