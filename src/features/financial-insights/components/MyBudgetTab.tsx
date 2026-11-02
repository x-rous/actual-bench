"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import type { BudgetPlan, CellState, MissRow, PlanCell, PlanChange, PlanKpis, PlanMonth, Reconciliation } from "@/lib/financial-insights/budget";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { monthLabel } from "@/lib/financial-insights/period";
import { useBudgetPlan, PLAN_MONTH_CAP } from "../hooks/useBudgetPlan";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { compactMoney, money, percent, signedMoney, formatDay } from "../format";
import { CategoryHeatmap, HiddenMark, whole, type HeatGroupItem, type HeatItem } from "./CategoryHeatmap";
import { ChartFrame } from "./ChartFrame";
import { DrillLink } from "./DrillLink";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { BarChart } from "./charts/BarChart";
import { monthTip } from "./charts/monthTip";
import { TipNote, TipRow, TipTitle, useTip } from "./charts/Tip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
type PlanProps = { plan: BudgetPlan; onDrill: (target: DrillTarget) => void };

/** Cell shades reuse the Spending heatmap's validated steps: cooler below the plan, warmer above it. */
const BELOW = ["", "var(--fi-below1)", "var(--fi-below2)", "var(--fi-below3)", "var(--fi-below4)"];
const ABOVE = ["", "var(--fi-above1)", "var(--fi-above2)", "var(--fi-above3)", "var(--fi-above4)"];
const SHADE: Record<CellState, (level: 1 | 2) => string> = {
  under: (l) => (l === 2 ? BELOW[3] : BELOW[2]),
  on: () => "var(--fi-mid)",
  over: (l) => (l === 2 ? ABOVE[4] : ABOVE[2]),
  unplanned: () => "transparent",
  covered: () => "var(--fi-mid)",
  carried: () => ABOVE[2],
  uncovered: () => ABOVE[4],
};
/** A mark beside the number, so a state never rests on colour alone. */
const GLYPH: Record<CellState, string> = { under: "▼ ", on: "= ", over: "▲ ", unplanned: "○ ", covered: "", carried: "↷ ", uncovered: "! " };
const STATE_TEXT: Record<CellState, string> = {
  under: "under its budget", on: "on its budget", over: "over its budget", unplanned: "unplanned spending",
  covered: "covered", carried: "overspent, carried to next month", uncovered: "overspent, not covered",
};
const groupColour = (index: number) => `var(--fi-g${index % 10})`;
const range = (months: string[]) => (months.length === 0 ? "" : months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The categories behind Actual's own spending figure, for a link that opens it. In a Tracking budget Actual's totals leave out
 * hidden categories (and hidden groups), so the list does too; Envelope totals include them.
 */
const allCategories = (plan: BudgetPlan) => plan.groups.flatMap((g) => g.rows.filter((r) => !(plan.mode === "tracking" && r.hidden)).map((r) => r.id));
const wholeRange = (plan: BudgetPlan) => ({ month: plan.completed[0], throughMonth: plan.completed[plan.completed.length - 1] });

// ─── Figures ────────────────────────────────────────────────────────────────

function Kpis({ plan, onDrill }: PlanProps) {
  const k: PlanKpis = plan.kpis;
  if (k.state !== "ready") {
    const detail = k.state === "unavailable" ? `${k.months.map(monthLabel).join(", ")} could not be read` : "No completed month in this period";
    const labels = plan.mode === "tracking" ? ["Expenses budgeted", "Expenses spent", "Expense variance", "Months over budget", "Income variance"] : ["Budgeted", "Expenses spent", "Overspent last month", "Months needing adjustment", "Ending balance"];
    return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{labels.map((l) => <Tile key={l} label={l} detail={detail}>Unavailable</Tile>)}</div>;
  }
  const spent = (
    <DrillLink smallDecimals label={`Expenses spent ${money(k.spentMinor)}`} onClick={() => onDrill({ kind: "budgetCell", categoryIds: allCategories(plan), name: "All categories", amountMinor: k.spentMinor, ...wholeRange(plan) })}>{money(k.spentMinor)}</DrillLink>
  );
  const months = plural(k.months, "completed month");
  if (k.mode === "tracking") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Expenses budgeted" detail={`Saved budget, ${months}`}>{money(k.plannedMinor)}</Tile>
        <Tile label="Expenses spent" detail={plan.hidden ? "Actual's own figure, refunds netted, hidden categories left out" : "Actual's own figure, refunds netted"}>{spent}</Tile>
        <Tile label="Expense variance" detail={k.varianceMinor >= 0 ? "Under by: budgeted less spent" : "Over by: budgeted less spent"}>{money(Math.abs(k.varianceMinor))}</Tile>
        <Tile label="Months over budget" detail={`${k.monthsWithPlan === 1 ? "completed month" : "completed months"} with a budget`}>{`${k.monthsOver} of ${k.monthsWithPlan}`}</Tile>
        <Tile label="Income variance" detail={`${k.incomeVarianceMinor >= 0 ? "Above" : "Below"} by: received ${money(k.incomeMinor)} of ${money(k.plannedIncomeMinor)} budgeted`}>{money(Math.abs(k.incomeVarianceMinor))}</Tile>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Tile label="Budgeted" detail={`Money assigned to categories, ${months}`}>{money(k.assignedMinor)}</Tile>
      <Tile label="Expenses spent" detail="Actual's own figure, refunds netted">{spent}</Tile>
      <Tile label="Overspent last month" detail="Not covered: Actual deducts it from the next month">{money(k.uncoveredMinor)}</Tile>
      <Tile label="Months needing adjustment" detail="completed months with overspending not covered">{`${k.monthsNeedingAdjustment} of ${k.months}`}</Tile>
      <Tile label="Ending balance" detail={`Category balances at the end of ${monthLabel(k.leftMonth)}, not a bank balance`}>{money(k.leftMinor)}</Tile>
    </div>
  );
}

/**
 * Why the numbers on this tab do not simply equal the Spending tab's, in words that stay on the page: what the figures cover and
 * what Actual leaves out or counts differently. The reconciliation beside it puts amounts on each of those reasons.
 */
function ExplainBox({ plan, cappedFrom, periodMonths }: { plan: BudgetPlan; cappedFrom: string | null; periodMonths: number }) {
  const partial = plan.months.find((m) => m.partial);
  const tracking = plan.mode === "tracking";
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground" aria-label="About these figures">
      <h2 className="text-sm font-semibold text-foreground">{tracking ? "Tracking budget" : "Envelope budget"} <span className="font-normal text-muted-foreground">· {plan.completed.length > 0 ? `${range(plan.completed)}, ${plural(plan.completed.length, "completed month")} only${partial ? `, ${monthLabel(partial.month)} not counted` : ""}` : "No completed month read"}</span></h2>
      <p className="mt-0.5">Figures follow Actual&apos;s own budget calculations, the same as Budget Cockpit.</p>
      <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed marker:text-muted-foreground/60">
        <li><strong className="font-semibold text-foreground">Moving money isn&apos;t spending:</strong> transferring money from an account in your budget to an off-budget investment, savings or loan account doesn&apos;t necessarily mean an expense. You are moving money between assets or reducing what you owe. For loan repayments, principal reduces your debt, while interest and fees are expenses. This is one reason My budget and Spending show different totals.</li>
        {plan.hidden && <li><strong className="font-semibold text-foreground">Hidden categories:</strong> Actual&apos;s Tracking budget excludes hidden categories from its totals. Spending still includes their expenses, because hiding a category doesn&apos;t mean the money wasn&apos;t spent. This gives a complete spending picture and explain changes in cash and net worth.</li>}
        {!tracking && <li><strong className="font-semibold text-foreground">Not covered:</strong> overspending Actual takes from the next month. Spending that earlier money covered is not overspending.</li>}
        {cappedFrom && <li><strong className="font-semibold text-foreground">Limit:</strong> the most recent {PLAN_MONTH_CAP} of {periodMonths} months, from {monthLabel(cappedFrom)}.</li>}
        {plan.unavailable.length > 0 && <li><strong className="font-semibold text-foreground">Not in your budget:</strong> {plan.unavailable.map(monthLabel).join(", ")}.</li>}
        {plan.failed.length > 0 && <li><strong className="font-semibold text-foreground">Could not be read:</strong> {plan.failed.map(monthLabel).join(", ")}; figures that need them are unavailable.</li>}
      </ul>
    </section>
  );
}

/** Spending tab figure, each adjustment and Actual's figure as one short column of rows; every adjustment opens its transactions. */
function ReconcileBox({ rec, onDrill }: { rec: Reconciliation; onDrill: (target: DrillTarget) => void }) {
  const first = rec.months[0], last = rec.months[rec.months.length - 1];
  const partLabel = { categorizedTransfers: "Categorized transfers", uncategorized: "Entries with no category", offBudget: "Categorized entries in off-budget accounts", registry: "Entries the Asset Registry classifies", hidden: "Hidden categories left out of Actual's totals" } as const;
  const target = (p: Reconciliation["parts"][number]): DrillTarget =>
    p.key === "uncategorized" ? { kind: "uncategorizedOut", month: first, throughMonth: last }
      : p.key === "hidden" ? { kind: "category", categoryIds: p.categoryIds ?? [], name: "Hidden categories", amountMinor: p.spentMinor, month: first, throughMonth: last }
      : { kind: "budgetGap", part: p.key, amountMinor: p.spentMinor, month: first, throughMonth: last };
  const reconciled = rec.otherMinor === 0;
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card px-4 py-3 text-xs" aria-label="Reconciliation to the Spending tab">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {reconciled ? <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />}
          Spending reconciliation
        </h2>
        <span className={reconciled ? "rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300" : "rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"}>{reconciled ? "Reconciled" : "Not fully explained"}</span>
      </div>
      <dl className="mt-2 divide-y divide-border/50">
        <div className="flex items-center justify-between gap-3 py-1.5"><dt>Spending tab, same {plural(rec.months.length, "completed month")}</dt><dd className="tabular-nums">{money(rec.spendingMinor)}</dd></div>
        {rec.parts.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3 py-1.5"><dt>{partLabel[p.key]}</dt><dd><DrillLink label={`${partLabel[p.key]} ${signedMoney(p.contributionMinor)}`} onClick={() => onDrill(target(p))}>{signedMoney(p.contributionMinor)}</DrillLink></dd></div>
        ))}
        {!reconciled && <div className="flex items-center justify-between gap-3 py-1.5"><dt>Other, not explained here</dt><dd className="tabular-nums">{signedMoney(rec.otherMinor)}</dd></div>}
        <div className="flex items-center justify-between gap-3 py-1.5 text-[13px] font-semibold"><dt>Expenses spent</dt><dd className="tabular-nums">{money(rec.actualMinor)}</dd></div>
      </dl>
      {rec.otherRows.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          Where Other sits:{" "}
          {rec.otherRows.slice(0, 6).map((r, i) => (
            <span key={r.id}>{i > 0 && ", "}<DrillLink label={`${r.name} ${signedMoney(r.differenceMinor)}`} onClick={() => onDrill({ kind: "budgetCell", categoryIds: [r.id], name: r.name, amountMinor: r.actualMinor, month: first, throughMonth: last })}>{r.name}</DrillLink> <span className="tabular-nums text-foreground">{signedMoney(r.differenceMinor)}</span></span>
          ))}
          {rec.otherRows.length > 6 ? ` and ${rec.otherRows.length - 6} more` : ""}.
        </p>
      )}
    </section>
  );
}

// ─── Chart ──────────────────────────────────────────────────────────────────

function MonthChart({ plan, onDrill, scope }: PlanProps & { scope: [string, string][] }) {
  const tracking = plan.mode === "tracking";
  const planName = "Budgeted";
  const labels = plan.months.map((m) => monthLabel(m.month));
  const partialIndex = plan.months.findIndex((m) => m.partial);
  const partial = partialIndex === -1 ? null : partialIndex;
  const series = [
    { key: "plan", label: planName, colour: "var(--fi-balance)", values: plan.months.map((m) => m.plannedMinor) },
    { key: "spent", label: "Spent", colour: "var(--fi-spend)", values: plan.months.map((m) => m.spentMinor) },
  ];
  const gap = (m: PlanMonth) => (m.plannedMinor === null || m.spentMinor === null ? null : tracking ? m.plannedMinor - m.spentMinor : m.uncoveredMinor);
  const tip = (i: number) => {
    const m = plan.months[i];
    if (m.status !== "ok") return <><TipTitle>{labels[i]}</TipTitle><TipNote>{m.status === "unavailable" ? "This month is not in your budget." : "This month could not be read."}</TipNote></>;
    const g = gap(m);
    const rows = [
      { colour: "var(--fi-balance)", name: planName, value: money(m.plannedMinor) },
      { colour: "var(--fi-spend)", name: "Spent", value: money(m.spentMinor) },
      ...(tracking && g !== null ? [{ name: g >= 0 ? "Under budget by" : "Over budget by", value: money(Math.abs(g)) }] : []),
      ...(!tracking && m.uncoveredMinor ? [{ name: "Overspent last month", value: money(m.uncoveredMinor) }] : []),
    ];
    return monthTip({ title: labels[i], partial: m.partial, partialNote: `Partial month: it runs to today.`, rows });
  };
  const select = (i: number, k: number) => {
    const m = plan.months[i];
    if (k !== 1 || m.status !== "ok" || m.spentMinor === null) return;
    onDrill({ kind: "budgetCell", categoryIds: allCategories(plan), name: "All categories", amountMinor: m.spentMinor, month: m.month });
  };
  return (
    <ChartFrame
      id="my-budget-months" title={`${planName} vs spent, month by month`} hint={tracking ? "Saved budget against Actual's spending" : "Money assigned against Actual's spending"}
      subtitle={<><p>{tracking ? "Each month's saved budget for spending beside what Actual recorded as spent." : "Each month's assignments to categories beside what Actual recorded as spent."} A month Actual does not have, or that could not be read, is left as a gap, never drawn as zero.</p><p>Select a Spent bar to see that month&apos;s transactions.</p></>}
      legend={[{ label: planName, colour: "var(--fi-balance)" }, { label: "Spent", colour: "var(--fi-spend)" }]}
      table={{ head: ["Month", planName, "Spent", tracking ? "Under (+) / over (−) budget" : "Overspent last month"], rows: plan.months.map((m, i) => [labels[i] + (m.partial ? " (partial)" : ""), m.plannedMinor, m.spentMinor, gap(m)]) }}
      csvScope={scope}
      footnote={partial !== null ? `* ${labels[partial]} is partial: it runs to today, is drawn lighter with a dashed outline and is not counted.` : undefined}
    >
      <BarChart labels={labels} partialIndex={partial} height={300} ariaLabel={`${planName} and spent each month`} series={series} tip={tip} onSelect={select} />
    </ChartFrame>
  );
}

// ─── Where the budget was missed ──────────────────────────────────────────────────

function Misses({ plan, onDrill }: PlanProps) {
  const tracking = plan.mode === "tracking";
  const [all, setAll] = useState(false);
  const [view, setView] = useState<"categories" | "groups">("categories");
  const [onlyUnplanned, setOnlyUnplanned] = useState(false);
  const source = view === "groups" ? plan.groupMisses : plan.misses;
  const list = onlyUnplanned ? source.filter((m) => m.unplannedMonths > 0).sort((a, b) => b.unplannedMinor - a.unplannedMinor || a.name.localeCompare(b.name)) : source;
  const shown = all ? list : list.slice(0, 8);
  const title = tracking ? "Where the budget was missed" : "Where funds ran short";
  const noun = tracking ? "over budget" : "uncovered";
  const link = (m: MissRow): DrillTarget => ({ kind: "budgetCell", categoryIds: m.categoryIds, name: m.name, amountMinor: m.spentMinor, ...wholeRange(plan) });
  const u = plan.unplanned;
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle title={title} hint={tracking ? `${view === "groups" ? "Groups" : "Categories"} over their budget, most first` : `${view === "groups" ? "Groups" : "Categories"} left uncovered, most months first`}
          info={tracking
            ? <><p>Categories (or category groups) ranked by how much they spent beyond their saved budget across the completed months. Spending in a month with no budget saved is unplanned spending: it counts as a month over budget, for the whole amount spent. A group is over in a month when its categories together spent more than their budgets together.</p><p>Select a total to see the transactions for those months.</p></>
            : <><p>Categories (or category groups) ranked by the months they ended below zero without carrying the overspending forward, so Actual took it from the next month. Spending above this month&apos;s assignment that earlier money covered is not overspending.</p><p>Select a total to see the transactions for those months.</p></>}
          infoLabel={title.toLowerCase()} />
        <PillGroup options={[{ value: "categories", label: "Categories" }, { value: "groups", label: "Groups" }]} value={view} onChange={(v) => { setView(v as typeof view); setAll(false); }} />
      </div>
      {u && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs" aria-label="Unplanned spending">
          <span><span className="font-medium">Unplanned spending</span> <span className="tabular-nums">{money(u.amountMinor)}</span>{u.spendingMinor > 0 ? <> · <span className="tabular-nums">{percent((u.amountMinor / u.spendingMinor) * 100)}</span> of all category spending, hidden categories included</> : null} · {plural(u.categories, "category", "categories")}</span>
          <button type="button" aria-pressed={onlyUnplanned} className={`rounded-md border px-2 py-0.5 ${onlyUnplanned ? "border-primary bg-primary/10" : "border-input hover:bg-muted"}`} onClick={() => { setOnlyUnplanned((v) => !v); setAll(false); }}>{onlyUnplanned ? "All misses" : "Only unplanned"}</button>
        </div>
      )}
      {list.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{plan.completed.length === 0 ? "No completed month to look at." : onlyUnplanned ? "Nothing was spent without a budget." : tracking ? "Nothing went over its budget in the completed months." : "Nothing was left uncovered in the completed months."}</p>
      ) : (
        <div className={`mt-2 min-h-0 flex-1 ${all ? "overflow-y-auto" : ""}`}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1 text-left font-medium">{view === "groups" ? "Group" : "Category"}</th>
                <th className="whitespace-nowrap pl-3 text-right font-medium">Months {noun}</th>
                <th className="whitespace-nowrap pl-3 text-right font-medium">Longest run</th>
                <th className="whitespace-nowrap pl-3 text-right font-medium">{onlyUnplanned ? "Unplanned" : tracking ? "Over budget by" : "Uncovered"}</th>
                <th className="whitespace-nowrap pl-3 text-right font-medium">Spent</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id} className="border-b border-border/40 align-top">
                  <th scope="row" className="py-1 text-left font-normal" title={view === "groups" ? `${m.name}: ${plural(m.categoryIds.length, "category", "categories")}` : `${m.name} (${m.groupName})`}><span className="break-words">{m.name}</span>{m.hidden && <> <HiddenMark title={view === "groups" ? "Hidden group" : "Hidden category"} /></>}</th>
                  <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums">{m.monthsMissed} of {m.monthsCounted}{m.unplannedMonths > 0 ? <span className="text-muted-foreground" title={`${m.unplannedMonths} of them unplanned spending, ${money(m.unplannedMinor)}`}> ({m.unplannedMonths} unplanned)</span> : null}</td>
                  <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums text-muted-foreground">{plural(m.longestStreak, "month")}</td>
                  <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums">{money(onlyUnplanned ? m.unplannedMinor : m.amountMinor)}</td>
                  <td className="whitespace-nowrap py-1 pl-3 text-right"><DrillLink label={`${m.name} spent ${money(m.spentMinor)}`} onClick={() => onDrill(link(m))}>{money(m.spentMinor)}</DrillLink></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 8 && <button type="button" className="mt-1 border-t border-border/50 pt-1.5 text-center text-xs text-muted-foreground underline" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>}
    </section>
  );
}

// ─── Category by month ──────────────────────────────────────────────────────

type Source = { name: string; ids: string[]; cells: (PlanCell | null)[] };

function BudgetHeatmap({ plan, onDrill }: PlanProps) {
  const tracking = plan.mode === "tracking";
  const { show, hide } = useTip();
  if (plan.groups.length === 0) return null;
  const rowItem = (r: BudgetPlan["groups"][number]["rows"][number]): HeatItem<Source> => ({ key: r.id, name: r.name, totalMinor: r.spentMinor, order: r.order, hidden: r.hidden, data: { name: r.name, ids: [r.id], cells: r.cells } });
  const groups: HeatGroupItem<Source>[] = plan.groups.map((g, i) => ({ key: g.name, name: g.name, hidden: g.hidden, totalMinor: g.spentMinor, order: g.order, colour: groupColour(i), data: { name: g.name, ids: g.categoryIds, cells: g.cells }, rows: g.rows.map(rowItem) }));
  const cell = (src: Source, i: number) => {
    const m = plan.months[i];
    if (m.status !== "ok") return <td className="px-1 py-0.5 text-right text-muted-foreground/60" title={m.status === "unavailable" ? "Not in your budget" : "Could not be read"}>{m.status === "unavailable" ? "n/a" : "!"}</td>;
    const c = src.cells[i];
    if (!c) return <td />;
    const partial = m.partial;
    const diff = c.planMinor - c.spentMinor;
    const text = partial ? "partial month, not compared" : STATE_TEXT[c.state];
    const unplanned = c.state === "unplanned" && !partial;
    return (
      <td className="px-0.5 py-0.5">
        <button type="button" className="block w-full rounded px-1.5 py-0.5 text-right tabular-nums"
          style={{ background: partial ? "var(--fi-mid)" : SHADE[c.state](c.level), color: "var(--fi-cell-ink)", opacity: partial ? 0.75 : 1, outline: partial ? "1px dashed var(--muted-foreground)" : unplanned ? "1px dotted var(--muted-foreground)" : undefined, outlineOffset: -2 }}
          aria-label={`${src.name}, ${monthLabel(m.month)}: spent ${money(c.spentMinor)}${tracking ? (c.planMinor ? ` of ${money(c.planMinor)} budgeted` : "") : ""}, ${text}. Show the transactions`}
          onClick={() => onDrill({ kind: "budgetCell", categoryIds: src.ids, name: src.name, amountMinor: c.spentMinor, month: m.month })} onMouseLeave={hide}
          onMouseMove={(e) => show(
            <>
              <TipTitle>{src.name} · {monthLabel(m.month)}{partial ? " (partial)" : ""}</TipTitle>
              <TipRow name="Spent" value={money(c.spentMinor)} />
              {tracking ? <TipRow name="Plan" value={c.state === "unplanned" ? "None saved (unplanned)" : money(c.planMinor)} /> : <><TipRow name="Assigned" value={money(c.planMinor)} /><TipRow name="Balance" value={money(c.balanceMinor)} /></>}
              {tracking && c.planMinor > 0 && !partial && <TipRow name={diff >= 0 ? "Under budget by" : "Over budget by"} value={money(Math.abs(diff))} />}
              <TipNote>{partial ? "Partial month: not compared with the budget." : c.state === "unplanned" ? "Spending with no budget saved (Actual returns 0 for no budget and for a budget of 0) is unplanned spending; it counts as over budget." : c.state === "carried" ? "Overspent, and this category carries the overspending into next month." : c.state === "uncovered" ? "Overspent: Actual takes the amount from next month's money." : tracking ? `Colour shows spending against the plan, ${STATE_TEXT[c.state]}.` : "Covered: the balance is at or above zero."}</TipNote>
            </>, e)}>
          {partial ? "" : GLYPH[c.state]}{whole(c.spentMinor)}
        </button>
      </td>
    );
  };
  const legend = tracking ? (
    <>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.under(2) }} aria-hidden />▼ Under budget</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.on(1) }} aria-hidden />= On budget</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.over(2) }} aria-hidden />▲ Over budget</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-dotted border-muted-foreground" aria-hidden />○ Unplanned spending</span>
      <span>· darker = further from the budget · dashed = partial month · n/a = not in your budget</span>
    </>
  ) : (
    <>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.covered(1) }} aria-hidden />Covered</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.carried(1) }} aria-hidden />↷ Carried to next month</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.uncovered(1) }} aria-hidden />! Uncovered</span>
      <span>· dashed = partial month · n/a = not in your budget</span>
    </>
  );
  return (
    <CategoryHeatmap
      id="my-budget-category-by-month" title={tracking ? "Category by month: spent against budget" : "Category by month: coverage"} hint={tracking ? "Each cell against its saved budget" : "Whether each category's money covered what was spent"}
      infoLabel="category by month" sortLabel="Spend"
      info={tracking
        ? <><p>Whole amounts spent, shaded by how they compare with that category&apos;s budget for the month. Colour says where spending sits against the budget, not whether it is good or bad.</p><p>Actual returns 0 for both &ldquo;no budget&rdquo; and a budget of 0, so spending against a budget of 0 is shown as <strong>unplanned spending</strong> (○) and counts as over budget.</p><p>Select a group name to expand its categories, or an amount to see its transactions.</p></>
        : <><p>Whole amounts spent. <strong>Covered</strong>: the balance is at or above zero, so earlier money paid for it. <strong>Carried</strong>: negative, and the category carries its overspending forward. <strong>Uncovered</strong>: negative and not carried, so Actual takes it from the next month.</p><p>Select a group name to expand its categories, or an amount to see its transactions.</p></>}
      legend={legend} initialGroups={10} defaultSort="order"
      months={plan.months.map((m) => ({ key: m.month, label: monthLabel(m.month), partial: m.partial }))} groups={groups}
      renderCell={({ data }, i) => cell(data, i)}
      footer={<>Totals are spent over the {plural(plan.completed.length, "completed month")}. Hidden categories with a budget or spending are included{tracking && plan.groups.some((g) => g.rows.some((r) => r.hidden)) ? ", although Actual's Tracking totals leave them out" : ""}.</>}
    />
  );
}

// ─── How the budget has changed ───────────────────────────────────────────────

function PlanChanges({ change, mode }: { change: PlanChange; mode: BudgetPlan["mode"] }) {
  const [all, setAll] = useState(false);
  const [view, setView] = useState<"categories" | "groups">("categories");
  const noun = mode === "tracking" ? "budget" : "assignments";
  const title = mode === "tracking" ? "How your budget has changed" : "How your assignments have changed";
  if (change.state === "omitted") {
    return (
      <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-label={title}>
        <CardTitle title={title} hint="Not enough months to compare" />
        <p className="mt-2 text-xs text-muted-foreground">{change.reason}</p>
      </section>
    );
  }
  const source = view === "groups" ? change.groupRows : change.rows;
  const changed = source.filter((r) => r.changeMinor !== 0);
  const unchanged = source.length - changed.length;
  const shown = all ? changed : changed.slice(0, 10);
  const pct = (from: number, to: number) => (from === 0 ? "-" : to === from ? "0%" : `${to > from ? "+" : "−"}${Math.abs(((to - from) / from) * 100).toFixed(0)}%`);
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle title={title} hint={`${range(change.earlier)} against ${range(change.latest)}`}
          info={<><p>The average {mode === "tracking" ? "budget" : "assignment"} saved in Actual for the earliest three completed months of the period against the latest three. The two groups of months do not overlap. A group is the sum of its categories.</p><p>It compares the amounts saved in Actual for those months, not edits made within a month.</p></>} infoLabel={title.toLowerCase()} />
        <PillGroup options={[{ value: "categories", label: "Categories" }, { value: "groups", label: "Groups" }]} value={view} onChange={(v) => { setView(v as typeof view); setAll(false); }} />
      </div>
      {changed.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No {view === "groups" ? "group" : "category"}&apos;s {mode === "tracking" ? "budget" : "assignment"} differs between the two sets of months ({change.earlierTotalMinor === change.latestTotalMinor ? `${money(change.latestTotalMinor)} in all` : "totals differ"}).</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 font-medium">{view === "groups" ? "Group" : "Category"}</th><th className="text-right font-medium">Earlier average</th><th className="text-right font-medium">Latest average</th><th className="text-right font-medium">Change</th><th className="text-right font-medium">Change %</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-border/40">
                <th scope="row" className="py-1 text-left font-normal" title={`${r.name} (${r.groupName})`}><span className="break-words">{r.name}</span>{r.hidden && <> <HiddenMark title={view === "groups" ? "Hidden group" : "Hidden category"} /></>}</th>
                <td className="text-right tabular-nums">{money(r.earlierMinor)}</td>
                <td className="text-right tabular-nums">{money(r.latestMinor)}</td>
                <td className="text-right tabular-nums">{signedMoney(r.changeMinor)}</td>
                <td className="text-right tabular-nums text-muted-foreground">{pct(r.earlierMinor, r.latestMinor)}</td>
              </tr>
            ))}
            <tr className="font-medium"><th scope="row" className="py-1 text-left font-medium">{view === "groups" ? "All groups" : "All categories"}</th><td className="text-right tabular-nums">{money(change.earlierTotalMinor)}</td><td className="text-right tabular-nums">{money(change.latestTotalMinor)}</td><td className="text-right tabular-nums">{signedMoney(change.latestTotalMinor - change.earlierTotalMinor)}</td><td className="text-right tabular-nums text-muted-foreground">{pct(change.earlierTotalMinor, change.latestTotalMinor)}</td></tr>
          </tbody>
        </table>
      )}
      {changed.length > 10 && <button type="button" className="mt-1 w-full border-t border-border/50 pt-1.5 text-center text-xs text-muted-foreground underline" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${changed.length}`}</button>}
      <p className="mt-2 text-xs text-muted-foreground">Compares the amounts saved in Actual for those months, not edits made within a month. Earlier: {change.earlier.map(monthLabel).join(", ")}. Latest: {change.latest.map(monthLabel).join(", ")}.{unchanged > 0 && changed.length > 0 ? ` ${plural(unchanged, view === "groups" ? "group" : "category", view === "groups" ? "groups" : "categories")} kept the same ${noun}.` : ""} A month in which nothing was saved counts as 0.</p>
    </section>
  );
}

/**
 * Tracking only: what the budget set aside against what happened, as one compact table whose rows carry their own pair of bars.
 * A comparison of two sets of figures over the same months, not a forecast.
 */
function RoomToSave({ kpis }: { kpis: PlanKpis }) {
  if (kpis.state !== "ready" || kpis.mode !== "tracking") return null;
  const rows = [
    { label: "Income", planned: kpis.plannedIncomeMinor, actual: kpis.incomeMinor, colour: "var(--fi-income)", strong: false, variance: kpis.incomeVarianceMinor },
    { label: "Spending", planned: kpis.plannedMinor, actual: kpis.spentMinor, colour: "var(--fi-spend)", strong: false, variance: kpis.varianceMinor },
    { label: "Surplus", planned: kpis.plannedSavingsMinor, actual: kpis.actualSavingsMinor, colour: kpis.actualSavingsMinor >= 0 ? "var(--fi-up)" : "var(--fi-down)", strong: true, variance: kpis.actualSavingsMinor - kpis.plannedSavingsMinor },
  ];
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.planned), Math.abs(r.actual)]));
  const bar = (v: number, colour: string) => <div className="h-1.5 rounded-full" style={{ width: `${(Math.abs(v) / max) * 100}%`, minWidth: v === 0 ? 0 : 2, background: colour }} aria-hidden />;
  const cols = "grid-cols-[5rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem]";
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card px-4 py-3" aria-label="Budgeted vs actual surplus">
      <CardTitle title="Budgeted vs actual surplus" hint="A comparison, not a forecast" info={<p>Budgeted income less budgeted spending, set beside the income received less what was spent, over the same completed months. The bars share one scale. Nothing here is projected.</p>} infoLabel="budgeted vs actual surplus" />
      <div className={`mt-2 grid ${cols} items-center gap-x-3 border-b border-border pb-1 text-xs text-muted-foreground`}>
        <span /><span className="flex gap-3"><span className="flex items-center gap-1"><i className="size-2 rounded-full" style={{ background: "var(--fi-balance)" }} aria-hidden />Budgeted</span><span className="flex items-center gap-1"><i className="size-2 rounded-full bg-foreground/60" aria-hidden />Actual</span></span><span className="text-right">Budgeted</span><span className="text-right">Actual</span><span className="text-right" title="Positive is better than budgeted: income above, spending under, surplus above">Variance</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className={`grid ${cols} items-center gap-x-3 border-b border-border/40 py-1.5 text-xs last:border-b-0 ${r.strong ? "font-semibold" : ""}`}>
          <span className={r.strong ? "" : "text-muted-foreground"}>{r.label}</span>
          <div className="space-y-0.5" aria-hidden>{bar(r.planned, "var(--fi-balance)")}{bar(r.actual, r.colour)}</div>
          <span className="text-right tabular-nums">{money(r.planned)}</span>
          <span className="text-right tabular-nums">{money(r.actual)}</span>
          <span className="text-right tabular-nums" title={r.variance >= 0 ? "Better than budgeted" : "Worse than budgeted"}>{signedMoney(r.variance)}</span>
        </div>
      ))}
      <p className="mt-1 text-xs text-muted-foreground">Variance is positive when the result is better than budgeted: income above, spending under, surplus above.</p>
    </section>
  );
}

/** Tracking: how much of each month's category spending had no budget saved. Compact, beside the surplus; one stacked bar per month. */
function UnplannedChart({ plan, scope, onDrill }: { plan: BudgetPlan; scope: [string, string][]; onDrill: (target: DrillTarget) => void }) {
  const labels = plan.months.map((m) => monthLabel(m.month));
  const pi = plan.months.findIndex((m) => m.partial);
  const planned = plan.months.map((m) => (m.categorySpentMinor === null ? null : m.categorySpentMinor - (m.unplannedMinor ?? 0)));
  const unplanned = plan.months.map((m) => (m.unplannedMinor === null ? null : m.unplannedMinor));
  const series = [
    { key: "planned", label: "With a budget", colour: "var(--fi-balance)", values: planned },
    { key: "unplanned", label: "Unplanned", colour: "var(--fi-gap)", values: unplanned },
  ];
  // A segment opens Actual's own transactions for the categories it is made of: those with no budget saved, or those with one.
  const select = (i: number, k: number) => {
    const m = plan.months[i];
    const amount = k === 1 ? unplanned[i] : planned[i];
    if (m.status !== "ok" || amount === null || amount === undefined) return;
    const ids = plan.groups.flatMap((g) => g.rows).filter((r) => { const c = r.cells[i]; return c !== null && (c.state === "unplanned") === (k === 1); }).map((r) => r.id);
    onDrill({ kind: "budgetCell", categoryIds: ids, name: k === 1 ? "Unplanned spending" : "Spending with a budget", amountMinor: amount, month: m.month });
  };
  const tip = (i: number) => {
    const m = plan.months[i];
    if (m.categorySpentMinor === null) return <><TipTitle>{labels[i]}</TipTitle><TipNote>{m.status === "unavailable" ? "This month is not in your budget." : "This month could not be read."}</TipNote></>;
    const u = m.unplannedMinor ?? 0;
    return monthTip({ title: labels[i], partial: m.partial, partialNote: "Partial month: it runs to today.", rows: [
      { colour: "var(--fi-balance)", name: "With a budget", value: money(m.categorySpentMinor - u) },
      { colour: "var(--fi-gap)", name: "Unplanned", value: money(u) },
      ...(m.categorySpentMinor > 0 ? [{ name: "Unplanned share", value: percent((u / m.categorySpentMinor) * 100) }] : []),
    ] });
  };
  return (
    <ChartFrame
      id="my-budget-unplanned" title="Unplanned spending by month" hint="Category spending with no budget saved"
      subtitle={<><p>Each bar is the month&apos;s spending across all expense categories, hidden ones included, split into categories with a budget and categories with none saved. Actual returns 0 for both no budget and a budget of 0, so both count as unplanned.</p><p>Select a segment to see its transactions.</p></>}
      legend={[{ label: "With a budget", colour: "var(--fi-balance)" }, { label: "Unplanned", colour: "var(--fi-gap)" }]}
      table={{ head: ["Month", "With a budget", "Unplanned"], rows: plan.months.map((m, i) => [labels[i] + (m.partial ? " (partial)" : ""), planned[i], unplanned[i]]) }} csvScope={scope}
      footnote={pi !== -1 ? `* ${labels[pi]} is partial: it runs to today and is not counted.` : undefined}
    >
      <BarChart labels={labels} partialIndex={pi === -1 ? null : pi} height={230} stacked ariaLabel="Unplanned spending each month" series={series} tip={tip} onSelect={select}
        topLabel={(i) => ((unplanned[i] ?? 0) > 0 ? { text: compactMoney(unplanned[i] ?? 0), colour: "var(--fi-gap)" } : null)} />
    </ChartFrame>
  );
}

// ─── The tab ────────────────────────────────────────────────────────────────

/** My budget: budget against what happened, in the budget's own mode, from Actual's own month figures. Display only. */
export function MyBudgetTab({ data, today, mode, onDrill }: { data: Ready; today: string; mode: "tracking" | "envelope"; onDrill: (target: DrillTarget) => void }) {
  const load = useBudgetPlan(data, today, mode);
  if (load.state === "loading") {
    return <div className="p-8 text-sm text-muted-foreground" role="status" aria-live="polite">Reading month {Math.min(load.done + 1, Math.max(load.total, 1))} of {load.total} of your budget…</div>;
  }
  if (load.state === "error") {
    return (
      <div className="mx-auto max-w-md space-y-3 p-8 text-center">
        <h2 className="text-sm font-semibold">We could not read your budget months</h2>
        <p className="text-sm text-muted-foreground">No figures are shown until the read succeeds.</p>
        <button type="button" className="rounded-md border border-input px-3 py-1 text-sm hover:bg-muted" onClick={load.retry}>Retry</button>
      </div>
    );
  }
  const { plan } = load;
  const { period } = data;
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["Budget", plan.mode === "tracking" ? "Tracking" : "Envelope"], ["Completed months counted", range(plan.completed) || "none"]];
  if (plan.kpis.state === "empty") {
    return (
      <div className="space-y-4 p-4">
        <ExplainBox plan={plan} cappedFrom={load.cappedFrom} periodMonths={load.periodMonths} />
        <div className="mx-auto max-w-md space-y-2 p-8 text-center">
          <h2 className="text-sm font-semibold">There is no completed budget month to show</h2>
          <p className="text-sm text-muted-foreground">Actual&apos;s budget has no finished month in this period. Choose a period that includes a month before the current one.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4 p-4">
      <Kpis plan={plan} onDrill={onDrill} />
      <div className={plan.reconciliation ? "grid items-start gap-4 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]" : ""}>
        <ExplainBox plan={plan} cappedFrom={load.cappedFrom} periodMonths={load.periodMonths} />
        {plan.reconciliation && <ReconcileBox rec={plan.reconciliation} onDrill={onDrill} />}
      </div>
      <div className="grid items-stretch gap-4 2xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] 2xl:[&>*:last-child]:max-h-[30rem]">
        <MonthChart plan={plan} onDrill={onDrill} scope={scope} />
        <Misses plan={plan} onDrill={onDrill} />
      </div>
      <BudgetHeatmap plan={plan} onDrill={onDrill} />
      <div className={plan.mode === "tracking" ? "grid items-start gap-4 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]" : ""}>
        {plan.mode === "tracking" && (
          <div className="space-y-4">
            <RoomToSave kpis={plan.kpis} />
            {plan.unplanned && <UnplannedChart plan={plan} scope={scope} onDrill={onDrill} />}
          </div>
        )}
        <PlanChanges change={plan.planChange} mode={plan.mode} />
      </div>
    </div>
  );
}
