"use client";

import { useState } from "react";
import { PillGroup } from "@/components/ui/pill-group";
import { InfoHint } from "@/components/ui/info-hint";
import { Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import {
  aggregateFor,
  type Baseline,
  type PatternTag,
  type SelectionFacts,
  type VarianceModel,
} from "../../../lib/varianceInvestigation";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import { BreakdownTable } from "./BreakdownTable";
import { EvidenceTransactions, type EvidenceScope } from "./EvidenceTransactions";
import { FAVOURABLE_TEXT, UNFAVOURABLE_TEXT } from "./useChartFrame";

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  facts: SelectionFacts;
  baseline: Baseline | null;
  /** The months the recent-months view lists, for a single-month period. */
  recentMonths: readonly string[];
  monthFilter: string | null;
  onClearMonthFilter: () => void;
  /** The selection is not the default one. */
  selectionCustom: boolean;
  onClearSelection: () => void;
  onSelectCategory: (categoryId: string) => void;
  onOpenSpendingAnalysis: (args: { categoryIds: string[]; title: string; monthStart: string; monthEnd: string }) => void;
  onExport: () => void;
};

const PATTERN_LABEL: Record<PatternTag, (model: VarianceModel) => string> = {
  repeated: (m) => (m.mode === "envelope" ? "Repeated deficits" : m.side === "income" ? "Repeated shortfall" : "Repeated overspending"),
  unusual: () => "Unusual this period",
  "budget-below-typical": (m) => (m.side === "income" ? "Target below typical" : "Budget below typical spending"),
};
const PATTERN_TONE: Record<PatternTag, string> = {
  repeated: "bg-destructive/10 text-destructive",
  unusual: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "budget-below-typical": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-1.5 py-1.5 text-center">
      <div className="truncate text-[15px] font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function baselineWhy(baseline: Baseline): string {
  const first = baseline.months[0];
  const last = baseline.months[baseline.months.length - 1];
  const span = first === last ? formatMonthLabel(first, "long") : `${formatMonthLabel(first, "long")} - ${formatMonthLabel(last, "long")}`;
  return baseline.kind === "year-ago"
    ? `Same months a year earlier (${span}), averaged per month. Context only; it does not change the variance.`
    : `Median of the ${baseline.months.length} closed months before this period (${span}). Last year's months were not all available. Context only; it does not change the variance.`;
}

/**
 * What happened in the selected drivers, in words and in evidence.
 *
 * The sentence, the four facts and the history come from the monthly budget.
 * The transactions below them are a supporting view loaded on demand.
 */
export function InvestigationPanel(props: Props) {
  const { model, format, facts, baseline } = props;
  const [evidence, setEvidence] = useState<"transactions" | "breakdown">("transactions");
  const [scope, setScope] = useState<EvidenceScope>("driver");
  const v = model.vocab;
  const agg = facts.aggregate;
  const env = agg.envelope;
  const n = agg.months.length;
  const names =
    facts.drivers.length === 1 ? facts.drivers[0].name : facts.drivers.length === 2 ? `${facts.drivers[0].name} and ${facts.drivers[1].name}` : `${facts.drivers.length} drivers`;
  const verb = facts.drivers.length > 1 ? "were" : "was";

  let sentence: React.ReactNode;
  if (env) {
    sentence =
      env.deficit > 0 ? (
        <>{names} ended with a <b className={UNFAVOURABLE_TEXT}>{format.money(env.deficit)} deficit</b></>
      ) : agg.variance > 0 ? (
        <>{names} spent <b className="text-amber-700 dark:text-amber-400">{format.money(agg.variance)} more than allocated</b>, covered by carried-in balance</>
      ) : (
        <>{names} ended with <b className={FAVOURABLE_TEXT}>{format.money(Math.max(env.available, 0))} still available</b></>
      );
  } else {
    const result =
      agg.variance > 0 ? <b className={UNFAVOURABLE_TEXT}>{format.money(agg.variance)} {v.netUnfavourable}</b>
      : agg.variance < 0 ? <b className={FAVOURABLE_TEXT}>{format.money(agg.variance)} {v.netFavourable}</b>
      : <b>on budget</b>;
    sentence = <>{names} {verb} {result}{agg.budget === 0 && agg.actual > 0 ? " (unbudgeted)" : ""}</>;
  }

  // Four facts. Tracking leads with a share of the gross side; Envelope with the deficit.
  const tiles: [string, string][] = [];
  if (env) {
    tiles.push(env.deficit > 0 ? [format.money(env.deficit), "deficit at period end"] : [format.money(Math.max(env.available, 0)), "available at period end"]);
    tiles.push([`${env.deficitMonths} of ${n}`, n === 1 ? "month in deficit" : "months in deficit"]);
    tiles.push(facts.categoryIds.length === 1 ? [env.carryoverCount ? "On" : "Off", "carryover"] : [`${env.carryoverCount} of ${facts.categoryIds.length}`, "categories carry over"]);
    tiles.push([format.money(env.clearedFromToBudget + env.clearedByMonth[n - 1]), "reduced To Budget"]);
  } else {
    const share = agg.variance > 0 ? facts.shareUnfavourable : agg.variance < 0 ? facts.shareFavourable : null;
    tiles.push([share == null ? "–" : `${Math.round(share * 100)}%`, agg.variance < 0 ? v.shareFavourable : v.shareUnfavourable]);
    tiles.push(
      n === 1
        ? facts.budgetUsed == null ? ["–", "unbudgeted"] : [`${Math.round(facts.budgetUsed * 100)}%`, `of ${model.side === "income" ? "target" : "budget"} reached`]
        : [`${agg.monthsOver} of ${n}`, `months ${model.side === "income" ? "below target" : "over budget"}`]
    );
    tiles.push(facts.topCategory ? [`${Math.round(facts.topCategory.share * 100)}%`, `from ${facts.topCategory.name}`] : [format.money(agg.actual / Math.max(n, 1)), "average per month"]);
    tiles.push(
      n > 1 && facts.peakMonth
        ? [formatMonthLabel(facts.peakMonth.month, "short"), `peak month (${format.signed(facts.peakMonth.variance)})`]
        : [`${facts.pattern.over} of ${facts.pattern.months}`, "recent months over"]
    );
  }

  const months = props.monthFilter ? [props.monthFilter] : [...model.months];
  const monthStart = months[0];
  const monthEnd = months[months.length - 1];
  const single = model.months.length === 1;
  const monthRows = props.monthFilter ? [props.monthFilter] : single ? [...props.recentMonths] : [...model.months];
  const allCategoryIds = model.categories.map((c) => c.id);
  const denominator = {
    driver: aggregateFor(model, facts.categoryIds, months).actual,
    all: aggregateFor(model, allCategoryIds, months).actual,
  };
  const selectionKey = `${facts.categoryIds.join(",")}|${monthStart}|${monthEnd}`;

  return (
    <div className="min-w-0">
      <p className="mb-2 text-base font-medium leading-snug">
        <span className="font-semibold">{sentence}</span>
        {facts.pattern.tags.map((tag) => (
          <span key={tag} className={cn("ml-2 inline-block rounded-full px-2 py-px align-middle text-[10.5px] font-semibold", PATTERN_TONE[tag])}>
            {PATTERN_LABEL[tag](model)}
          </span>
        ))}
      </p>

      <div className="mb-2.5 grid grid-cols-4 gap-2 max-sm:grid-cols-2">
        {tiles.map(([value, label]) => (
          <Tile key={label} value={value} label={label} />
        ))}
      </div>

      {baseline && (
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 rounded-lg bg-muted/60 px-3 py-1.5 tabular-nums">
          <span className="text-xs font-semibold">
            Historical context <span className="font-normal text-muted-foreground">(monthly average)</span>
          </span>
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[13px]">
            <span><span className="text-[11px] text-muted-foreground">{v.budget}</span> <b>{format.money(agg.budget / Math.max(n, 1))}/mo</b></span>
            <span><span className="text-[11px] text-muted-foreground">{v.actual}</span> <b>{format.money(agg.actual / Math.max(n, 1))}/mo</b></span>
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[11px] text-muted-foreground">Typical</span>
              <InfoHint label="typical spending">{baselineWhy(baseline)}</InfoHint>
              <b>{format.money(baseline.typicalPerMonth)}/mo</b>
            </span>
          </span>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{evidence === "transactions" ? "Largest transactions" : "Breakdown of this driver"}</h3>
        <div className="flex items-center gap-2">
          <PillGroup
            options={[
              { value: "transactions", label: "Transactions" },
              { value: "breakdown", label: "Breakdown" },
            ]}
            value={evidence}
            onChange={setEvidence}
          />
          <button
            type="button"
            onClick={props.onExport}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
            aria-label="Export the drivers shown as CSV"
          >
            <Download className="size-3" aria-hidden="true" /> Export
          </button>
        </div>
      </div>

      {(props.selectionCustom || props.monthFilter) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {props.selectionCustom && (
            <FilterChip label={`Drivers: ${facts.drivers.map((d) => d.name).join(", ")}`} onClear={props.onClearSelection} />
          )}
          {props.monthFilter && <FilterChip label={`Month: ${formatMonthLabel(props.monthFilter, "long")}`} onClear={props.onClearMonthFilter} />}
        </div>
      )}

      {evidence === "transactions" ? (
        <EvidenceTransactions
          key={`${selectionKey}|${scope}`}
          model={model}
          format={format}
          scope={scope}
          onScope={setScope}
          driverCategoryIds={facts.categoryIds}
          driverLabel={facts.drivers.length === 1 ? facts.drivers[0].name : "the selected drivers"}
          monthStart={monthStart}
          monthEnd={monthEnd}
          monthCount={months.length}
          denominator={denominator}
          onSelectCategory={props.onSelectCategory}
        />
      ) : (
        <BreakdownTable
          model={model}
          format={format}
          categoryIds={facts.categoryIds}
          months={months}
          monthRows={monthRows}
          highlightMonth={props.monthFilter ?? (single ? model.months[0] : null)}
        />
      )}

      <button
        type="button"
        onClick={() => props.onOpenSpendingAnalysis({ categoryIds: facts.categoryIds, title: names, monthStart, monthEnd })}
        className="mt-3 text-[12.5px] text-primary hover:underline"
      >
        View all in Spending Analysis →
      </button>
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
      {label}
      <button type="button" aria-label={`Remove filter: ${label}`} className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10" onClick={onClear}>
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}
