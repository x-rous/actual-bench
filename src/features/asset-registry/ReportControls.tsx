"use client";
import type { AssetPerformance } from "@/lib/asset-registry/performance";
import { averageYearlyYield, yearlyNetYield } from "@/lib/asset-registry/yields";
import { assetMoney, SummaryStrip } from "./AssetPresentation";
import type { OperatingEntry } from "./timeline";
export const percent = (value: number | null | undefined) => value == null ? "N/A" : `${value.toFixed(2)}%`;
/** Gaps are detectable inputs only; Bench cannot know about unlinked real-world cashflow. */
export function PerformanceGaps({ gaps }: { gaps: string[] }) {
  return gaps.length > 0 ? <details className="border-b px-4 py-2 text-xs"><summary className="cursor-pointer font-medium">Performance incomplete · {gaps.length} detectable {gaps.length === 1 ? "gap" : "gaps"}</summary><ul className="mt-2 list-disc space-y-1 pl-4">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></details> : null;
}
const count = (n: number) => `${n} ${n === 1 ? "transaction" : "transactions"}`;
/**
 * The Income & Expenses KPIs for the dates the table shows. `entries` are the linked income and expense rows, `performance` the
 * report for the same dates (for the yield on what was put in), `valueMinor` the recorded value at the end of them and `years`
 * their length, which turns the yields into yearly rates.
 */
export function IncomeSummary({ entries, from, to, performance, valueMinor, years }: { entries: OperatingEntry[]; from: string; to: string; performance?: AssetPerformance; valueMinor?: number | null; years: number }) {
  const inside = entries.filter((e) => e.date >= from && e.date <= to);
  const income = inside.filter((e) => e.income); const expenses = inside.filter((e) => !e.income);
  const sum = (rows: OperatingEntry[]) => rows.reduce((total, e) => total + e.amountMinor, 0);
  const net = sum(inside);
  const months = years * 12;
  const yearly = averageYearlyYield(performance?.operatingYield, years);
  const onValue = yearlyNetYield(net, valueMinor, years);
  return <><SummaryStrip label="Asset income and expenses summary" items={[
    { label: "Income", value: assetMoney(sum(income)), detail: count(income.length), wrap: true },
    { label: "Expenses", value: assetMoney(sum(expenses)), detail: count(expenses.length), wrap: true },
    { label: "Net cash flow", value: assetMoney(net), detail: months >= 1 ? `About ${assetMoney(Math.round(net / months))} a month` : "Income plus expenses", wrap: true },
    { label: "Yearly yield on cost", value: percent(yearly), detail: yearly === null ? "Needs six months of history" : `Net cash flow ÷ (opening value + capital added), per year over ${years.toFixed(1)} years`, wrap: true },
    { label: "Net yield on value", value: percent(onValue?.percent), detail: onValue === null ? "Needs a recorded value above zero" : onValue.annualized ? "A year of net cash flow ÷ the recorded value at the end of the dates" : "Net cash flow ÷ value for these dates, not scaled to a year", wrap: true },
  ]} /><PerformanceGaps gaps={performance?.gaps ?? []} /></>;
}
