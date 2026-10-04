"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { downloadCsv } from "@/lib/csv";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { useAvailableMonths } from "../../hooks/useAvailableMonths";
import { isClosedMonth, useVarianceInvestigation } from "../../hooks/useVarianceInvestigation";
import { useBudgetDisplay } from "../../context/BudgetDisplayContext";
import type {
  BudgetTransactionBrowserOptions,
  BudgetTransactionCategoryOption,
  BudgetTransactionsDrilldown,
} from "../../lib/budgetTransactionBrowser";
import {
  buildBaseline,
  buildMonthPoints,
  buildSelectionFacts,
  buildVarianceModel,
  buildVarianceCsvRows,
  effectiveDriverIds,
  recentMonths,
  resolveSelection,
  selectedCategoryIds,
  toggleSelection,
  type Driver,
  type DriverFilter,
  type VarianceLevel,
  type VarianceMode,
} from "../../lib/varianceInvestigation";
import { createVarianceFormat } from "../../lib/varianceInvestigation/varianceFormat";
import {
  optionKeyOf,
  scopeFromKeys,
  scopeFromTarget,
  spendingAnalysisTarget,
  type VarianceScope,
} from "../../lib/varianceInvestigation/varianceScope";
import { ANALYSIS_DIALOG_WIDE } from "./budgetTransactionsDialog.helpers";
import { DriverList } from "./variance/DriverList";
import { InvestigationPanel } from "./variance/InvestigationPanel";
import { DeficitImpact, TimelineChart } from "./variance/TimelineChart";
import { VarianceHeader } from "./variance/VarianceHeader";
import { VarianceSummary } from "./variance/VarianceSummary";
import { WaterfallChart } from "./variance/WaterfallChart";

export type TopVarianceDriversDialogProps = {
  /**
   * What the dialog opens on: the same drill-through target Spending Analysis
   * takes, built from the figure that was clicked. `null` keeps it closed.
   */
  target: BudgetTransactionsDrilldown | null;
  /** The category picker's options, shared with Spending Analysis. */
  browserOptions: BudgetTransactionBrowserOptions;
  /** The budget that is open. Tracking compares with a plan; Envelope reads balances. */
  budgetMode: VarianceMode;
  onClose: () => void;
  /** Open Spending Analysis on the same categories and months. */
  onOpenSpendingAnalysis: (target: BudgetTransactionsDrilldown) => void;
};

const EMPTY_SCOPE: VarianceScope = { wholeSide: true, categoryIds: [], groupIds: [] };

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function TopVarianceDriversDialog({
  target,
  browserOptions,
  budgetMode,
  onClose,
  onOpenSpendingAnalysis,
}: TopVarianceDriversDialogProps) {
  const open = target != null;
  const side = target?.side ?? "expense";
  const { showDecimals } = useBudgetDisplay();
  const format = useMemo(() => createVarianceFormat(showDecimals), [showDecimals]);

  const [selectedKeys, setSelectedKeys] = useState<string[] | null>(null);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [levelChoice, setLevelChoice] = useState<VarianceLevel>("group");
  const [filter, setFilter] = useState<DriverFilter>("all");
  const [selection, setSelection] = useState<string[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  const categoryOptions = useMemo(
    () => browserOptions.categories.filter((o) => o.side === side),
    [browserOptions.categories, side]
  );
  const selectedOptions = useMemo(() => {
    if (!selectedKeys || selectedKeys.length === 0) return null;
    const byKey = new Map(categoryOptions.map((o) => [optionKeyOf(o), o]));
    const resolved = selectedKeys.map((k) => byKey.get(k)).filter((o): o is BudgetTransactionCategoryOption => !!o);
    return resolved.length > 0 ? resolved : null;
  }, [selectedKeys, categoryOptions]);

  const baseScope = useMemo(() => (target ? scopeFromTarget(target) : EMPTY_SCOPE), [target]);
  const scope = useMemo(
    () => (selectedKeys ? (scopeFromKeys(selectedKeys, categoryOptions) ?? baseScope) : baseScope),
    [selectedKeys, categoryOptions, baseScope]
  );
  const monthStart = range?.start ?? target?.monthStart ?? "";
  const monthEnd = range?.end ?? target?.monthEnd ?? "";

  const data = useVarianceInvestigation({
    mode: budgetMode,
    side,
    monthStart,
    monthEnd,
    scope,
    level: levelChoice,
  });
  const fullModel = data.model;
  const { data: availableMonths } = useAvailableMonths();

  /*
   * A month clicked in a multi-month view narrows everything that describes the
   * period: the headline, the waterfall, the drivers and the investigation. The
   * month chart keeps the whole period, so the click can be undone from where
   * it was made. If the month has nothing in scope the filter is ignored rather
   * than leaving empty panels.
   */
  const single = fullModel.months.length === 1;
  const requestedMonth = month && fullModel.months.includes(month) && !single ? month : null;
  const monthModel = useMemo(
    () =>
      requestedMonth
        ? buildVarianceModel({
            mode: budgetMode,
            side,
            months: [requestedMonth],
            statesByMonth: fullModel.statesByMonth,
            categoryIds: scope.wholeSide ? null : scope.categoryIds,
            groupIds: scope.wholeSide ? null : scope.groupIds,
            level: levelChoice,
          })
        : null,
    [requestedMonth, budgetMode, side, fullModel.statesByMonth, scope, levelChoice]
  );
  const activeMonth = monthModel && monthModel.drivers.length > 0 ? requestedMonth : null;
  const model = activeMonth && monthModel ? monthModel : fullModel;

  // Nothing selected means everything in view; the analysis describes all drivers then.
  const driverIds = useMemo(() => resolveSelection(model, selection), [model, selection]);
  const wholeView = driverIds.length === 0;
  const analysisIds = useMemo(() => effectiveDriverIds(model, driverIds), [model, driverIds]);
  const selectionCustom = !wholeView && model.drivers.length > 1;
  const categoryIds = useMemo(() => selectedCategoryIds(model, analysisIds), [model, analysisIds]);
  // History belongs to the period, so a month filter does not change what is typical.
  const baseline = useMemo(
    () => buildBaseline({ model: fullModel, categoryIds, months: fullModel.months, isClosed: isClosedMonth }),
    [fullModel, categoryIds]
  );
  const facts = useMemo(
    () =>
      buildSelectionFacts({
        model,
        driverIds: analysisIds,
        baseline,
        context: activeMonth ? fullModel.months : undefined,
      }),
    [model, analysisIds, baseline, activeMonth, fullModel.months]
  );
  const recent = useMemo(() => recentMonths(fullModel.months), [fullModel.months]);
  const points = useMemo(
    () => (single ? buildMonthPoints(fullModel, recent).filter((p) => p.present) : fullModel.monthly),
    [single, fullModel, recent]
  );

  function resetView() {
    setSelection(null);
    setMonth(null);
    setFilter("all");
  }
  function handleRangeChange(start: string, end: string) {
    setRange({ start, end });
    resetView();
  }
  function handleSelectionChange(keys: string[]) {
    // A category inside a chosen group adds nothing; drop it rather than record it twice.
    const groupKeys = new Set(keys.filter((k) => k.startsWith("group:")));
    const covered = new Set<string>();
    for (const key of groupKeys) {
      const option = categoryOptions.find((o) => optionKeyOf(o) === key);
      for (const id of option?.categoryIds ?? []) covered.add(`category:${id}`);
    }
    const kept = keys.filter((k) => !covered.has(k));
    setSelectedKeys(kept.length > 0 ? kept : null);
    setLevelChoice("group");
    resetView();
  }
  function handleSelect(ids: string[], additive: boolean) {
    setSelection((current) => {
      const now = current ?? driverIds;
      // Clicking what is already the whole selection puts it back to everything.
      if (!additive && sameSet(now, ids)) return null;
      return toggleSelection(now, ids, additive);
    });
  }
  function handleDrill(driver: Driver) {
    const key = `group:${driver.id}`;
    if (!categoryOptions.some((o) => optionKeyOf(o) === key)) return;
    setSelectedKeys([key]);
    resetView();
  }
  function handleSelectCategory(categoryId: string) {
    const driver = model.drivers.find((d) => d.categoryIds.includes(categoryId));
    if (driver) setSelection([driver.id]);
  }
  function handleOpenSpendingAnalysis(args: { categoryIds: string[]; title: string; monthStart: string; monthEnd: string }) {
    onOpenSpendingAnalysis(spendingAnalysisTarget({ side, ...args }));
  }

  const wholeSideKey = `group:${side === "income" ? "__all_income__" : "__all_expenses__"}`;
  const canGoBack = !scope.wholeSide && categoryOptions.some((o) => optionKeyOf(o) === wholeSideKey);
  const selectionSummary = useMemo(() => {
    if (!selectedOptions) return undefined;
    if (selectedOptions.length === 1) return selectedOptions[0].title;
    const groups = selectedOptions.filter((o) => o.entity === "group").length;
    const cats = selectedOptions.length - groups;
    return [groups ? `${groups} ${groups === 1 ? "group" : "groups"}` : "", cats ? `${cats} ${cats === 1 ? "category" : "categories"}` : ""].filter(Boolean).join(" + ");
  }, [selectedOptions]);
  const coveredKeys = useMemo(() => {
    const covered = new Set<string>();
    for (const option of selectedOptions ?? []) {
      if (option.entity !== "group") continue;
      for (const id of option.categoryIds) covered.add(`category:${id}`);
    }
    return covered;
  }, [selectedOptions]);
  const exclusiveKeys = useMemo(
    () => new Set(categoryOptions.filter((o) => o.id.startsWith("__all_")).map(optionKeyOf)),
    [categoryOptions]
  );

  const periodNote = data.provisional
    ? "Includes the current month so far"
    : data.allClosed
      ? "Closed months"
      : null;
  const periodLabel =
    monthStart === monthEnd ? formatMonthLabel(monthStart, "long") : `${formatMonthLabel(monthStart, "long")} - ${formatMonthLabel(monthEnd, "long")}`;
  const viewLabel = activeMonth ? formatMonthLabel(activeMonth, "long") : periodLabel;

  let body: React.ReactNode;
  if (data.isLoading) {
    body = <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">Loading budget months…</div>;
  } else if (data.error) {
    body = <div className="flex flex-1 items-center justify-center p-10 text-sm text-destructive">Could not load the budget months for this period.</div>;
  } else if (data.months.length === 0) {
    body = <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">These months have no actuals yet, so there is no variance to explain.</div>;
  } else if (fullModel.drivers.length === 0) {
    body = <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">No budget or spending in these categories for this period.</div>;
  } else {
    const envelope = model.mode === "envelope";
    const hint = (label: string, text: string) => (
      <InfoHint label={label}>{text}</InfoHint>
    );
    const swatch = (cls: string, text: string) => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <i className={`inline-block size-2 rounded-[2px] ${cls}`} />
        {text}
      </span>
    );
    body = (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:[@media(min-height:900px)]:overflow-hidden">
        <VarianceSummary
          model={model}
          format={format}
          provisional={data.provisional}
          focus={activeMonth ? { month: activeMonth, periodLabel } : undefined}
        />
        {data.hasFutureMonths && (
          <p className="border-b border-border px-5 py-1.5 text-[11px] text-muted-foreground">Months that have not happened yet are left out.</p>
        )}

        <div className="grid shrink-0 grid-cols-[minmax(0,6fr)_minmax(0,5fr)] border-b border-border max-lg:grid-cols-1">
          <section className="min-w-0 px-5 py-3 lg:border-r lg:border-border">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-semibold">
                {envelope ? "How allocation became spending" : "How budget became actual"}{" "}
                <span className="font-normal text-muted-foreground">· {viewLabel}</span>
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {swatch("bg-muted-foreground", `${model.vocab.budget} / ${model.vocab.actual}`)}
                {swatch("bg-destructive", model.vocab.unfavourable)}
                {swatch("bg-emerald-500", model.vocab.favourable)}
                {model.canChooseLevel && (
                  <div className="flex gap-px rounded border border-border bg-muted/40 p-px" role="group" aria-label="Group by">
                    {(["group", "category"] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={model.level === level}
                        onClick={() => {
                          setLevelChoice(level);
                          resetView();
                        }}
                        className={`rounded px-2 py-0.5 text-xs transition-colors ${model.level === level ? "bg-background font-medium text-foreground shadow-sm" : "hover:text-foreground"}`}
                      >
                        {level === "group" ? "Groups" : "Categories"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <WaterfallChart model={model} format={format} selectedIds={driverIds} onSelect={handleSelect} />
          </section>

          <section className="min-w-0 px-5 py-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <span>
                  {envelope ? "How balances moved" : single ? "Recent months" : "When the variance developed"}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {single ? `${formatMonthLabel(fullModel.months[0], "long")} highlighted` : periodLabel}
                  </span>
                </span>
                {!single && hint("filtering by month", "Click a month to narrow the headline, the waterfall, the drivers and the analysis to it. Click it again to clear.")}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {envelope ? (
                  <>
                    {swatch("bg-muted-foreground/60", "Available")}
                    {swatch("bg-destructive", "Deficit")}
                  </>
                ) : (
                  <>
                    {swatch("bg-destructive", model.vocab.unfavourable)}
                    {swatch("bg-emerald-500", model.vocab.favourable)}
                    {!single && (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <i className="inline-block h-0.5 w-3 bg-foreground" />
                        Cumulative
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <TimelineChart
              model={fullModel}
              format={format}
              points={points}
              periodMonths={fullModel.months}
              showCumulative={!envelope && !single}
              selectedMonth={activeMonth}
              onMonthClick={single ? undefined : (m) => setMonth((current) => (current === m ? null : m))}
            />
            {envelope && <DeficitImpact points={points} periodMonths={fullModel.months} format={format} />}
          </section>
        </div>

        <div
          className={`grid min-h-[26rem] flex-1 max-lg:grid-cols-1 lg:[@media(min-height:900px)]:min-h-0 lg:[@media(min-height:900px)]:grid-rows-[minmax(0,1fr)] ${
            // Envelope adds a balance column, so its driver names get more room.
            envelope ? "grid-cols-[31rem_minmax(0,1fr)]" : "grid-cols-[26rem_minmax(0,1fr)]"
          }`}
        >
          <div className="min-w-0 px-5 py-3 lg:overflow-auto lg:[@media(min-height:900px)]:pr-2">
            <DriverList
              model={model}
              format={format}
              selectedIds={driverIds}
              filter={filter}
              onFilter={setFilter}
              onSelect={handleSelect}
              onDrill={model.level === "group" ? handleDrill : undefined}
              breadcrumb={
                canGoBack ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <button type="button" className="text-primary hover:underline" onClick={() => { setSelectedKeys([wholeSideKey]); resetView(); }}>
                      {side === "income" ? "All income" : "All expenses"}
                    </button>
                    <span aria-hidden="true">›</span>
                    <span className="font-medium text-foreground">{selectionSummary ?? target?.title}</span>
                  </div>
                ) : null
              }
            />
          </div>
          <div className="min-w-0 px-5 py-3 lg:overflow-auto lg:pl-3">
            <InvestigationPanel
              model={model}
              format={format}
              facts={facts}
              baseline={baseline}
              wholeView={wholeView}
              scopeTitle={selectionSummary ?? target?.title ?? "Everything in view"}
              recentMonths={activeMonth ? fullModel.months : recent.filter((m) => points.some((p) => p.month === m))}
              monthFilter={activeMonth}
              onClearMonthFilter={() => setMonth(null)}
              selectionCustom={selectionCustom}
              onClearSelection={() => setSelection(null)}
              onSelectCategory={handleSelectCategory}
              onOpenSpendingAnalysis={handleOpenSpendingAnalysis}
              onExport={() => downloadCsv(`variance-drivers-${model.mode}-${side}.csv`, buildVarianceCsvRows(model))}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={`flex flex-col gap-0 overflow-hidden p-0 ${ANALYSIS_DIALOG_WIDE}`}>
        <VarianceHeader
          options={categoryOptions}
          selectedKeys={selectedKeys}
          placeholder={target?.title ?? "Select categories"}
          coveredKeys={coveredKeys}
          exclusiveKeys={exclusiveKeys}
          summary={selectionSummary}
          selectedOptions={selectedOptions}
          categoryCount={fullModel.categories.length}
          onSelectionChange={handleSelectionChange}
          monthStart={monthStart}
          monthEnd={monthEnd}
          availableMonths={availableMonths ?? []}
          onRangeChange={handleRangeChange}
          periodNote={periodNote}
          description={`${periodLabel}${target ? ` · ${target.title}` : ""}`}
        />
        {body}
      </DialogContent>
    </Dialog>
  );
}
