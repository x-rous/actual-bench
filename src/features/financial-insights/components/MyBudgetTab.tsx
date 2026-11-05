"use client";

import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import { combineCells, type BudgetPlan, type CellState, type MissRow, type PlanCell, type PlanKpis, type PlanMonth, type Reconciliation } from "@/lib/financial-insights/budget";
import { GRANULARITY_NAME, bucketMonths, type Bucket, type Granularity } from "@/lib/financial-insights/buckets";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { monthLabel } from "@/lib/financial-insights/period";
import { useBudgetPlan } from "../hooks/useBudgetPlan";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { compactMoney, money, percent, signedMoney, formatDay } from "../format";
import { CategoryHeatmap, HiddenMark, whole, type HeatGroupItem, type HeatItem } from "./CategoryHeatmap";
import { ChartFrame } from "./ChartFrame";
import { DrillLink } from "./DrillLink";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { useGranularity } from "../hooks/useGranularity";
import { UnitPills } from "./UnitPills";
import { BarChart } from "./charts/BarChart";
import { BUDGET_TINT, BudgetBars } from "./charts/BudgetBars";
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
    const labels = plan.mode === "tracking" ? ["Expenses budgeted", "Expenses spent", "Expense variance", "Months over budget", "Income variance"] : ["Budgeted", "Expenses spent", "Overspent, not covered", "Months needing adjustment", "Ending balance"];
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
        <Tile label="Expenses spent" info={<p>Actual&apos;s own figure, refunds netted{plan.hidden ? ", with hidden categories left out as Actual's Tracking totals do" : ""}.</p>} detail={`${months} counted`}>{spent}</Tile>
        <Tile label="Expense variance" detail={k.varianceMinor >= 0 ? "Under by: budgeted less spent" : "Over by: budgeted less spent"}><span className={k.varianceMinor === 0 ? undefined : k.varianceMinor > 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>{k.varianceMinor === 0 ? money(0) : signedMoney(k.varianceMinor)}</span></Tile>
        <Tile label="Months over budget" detail={`${k.monthsWithPlan === 1 ? "completed month" : "completed months"} with a budget${k.monthsWithPlan > 0 ? ` · ${percent((k.monthsOver / k.monthsWithPlan) * 100)} over` : ""}`}>{`${k.monthsOver} of ${k.monthsWithPlan}`}</Tile>
        <Tile label="Income variance" detail={`${k.incomeVarianceMinor >= 0 ? "Above" : "Below"} by: received ${money(k.incomeMinor)} of ${money(k.plannedIncomeMinor)} budgeted`}><span className={k.incomeVarianceMinor === 0 ? undefined : k.incomeVarianceMinor > 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>{k.incomeVarianceMinor === 0 ? money(0) : signedMoney(k.incomeVarianceMinor)}</span></Tile>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Tile label="Budgeted" detail={`Money assigned to categories, ${months}`}>{money(k.assignedMinor)}</Tile>
      <Tile label="Expenses spent" detail="Actual's own figure, refunds netted">{spent}</Tile>
      <Tile label="Overspent, not covered" info={<p>The overspending Actual deducts from the next month, added up over the completed months.</p>} detail="Taken from the next month">{money(k.uncoveredMinor)}</Tile>
      <Tile label="Months needing adjustment" detail="completed months with overspending not covered">{`${k.monthsNeedingAdjustment} of ${k.months}`}</Tile>
      <Tile label="Ending balance" info={<p>The sum of the category balances at the end of the period: not a bank balance.</p>} detail={`At the end of ${monthLabel(k.leftMonth)}`}>{money(k.leftMinor)}</Tile>
    </div>
  );
}

/**
 * Why the numbers on this tab do not simply equal the Spending tab's, in words that stay on the page: what the figures cover and
 * what Actual leaves out or counts differently. The reconciliation beside it puts amounts on each of those reasons.
 */
function ExplainBox({ plan }: { plan: BudgetPlan }) {
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

/** The months of a plan as buckets (months, quarters or years); a month that is not in the budget, or could not be read, has no data. */
function planBuckets(plan: BudgetPlan, unit: Granularity): Bucket[] {
  return bucketMonths(plan.months.map((m) => m.month), plan.months.map((m) => m.status === "ok"), plan.months.map((m) => m.partial), unit);
}

/** Every month of the bucket was read: only then does its transaction list match what the figure adds up. */
const allRead = (plan: BudgetPlan, b: Bucket) => b.indexes.every((i) => plan.months[i].status === "ok");

/** Why a bucket has no figure: a month Actual could not read, or one that is not in the budget. */
const gapReason = (plan: BudgetPlan, b: Bucket): "failed" | "unavailable" => (b.indexes.some((i) => plan.months[i].status === "failed") ? "failed" : "unavailable");

function MonthChart({ plan, onDrill, scope }: PlanProps & { scope: [string, string][] }) {
  const [unit, setUnit] = useGranularity(plan.months.map((m) => m.month));
  const names = GRANULARITY_NAME[unit];
  const tracking = plan.mode === "tracking";
  const planName = "Budgeted";
  const buckets = useMemo(() => planBuckets(plan, unit), [plan, unit]);
  const labels = buckets.map((b) => b.label);
  const partials = buckets.flatMap((b, i) => (b.partial ? [i] : []));
  // What each bucket adds up to over its months that are in the budget.
  const totals = buckets.map((b) => {
    const ok = b.indexes.map((i) => plan.months[i]).filter((m) => m.status === "ok");
    if (ok.length === 0) return null;
    const sum = (pick: (m: PlanMonth) => number | null) => ok.reduce((a, m) => a + (pick(m) ?? 0), 0);
    return { plannedMinor: sum((m) => m.plannedMinor), spentMinor: sum((m) => m.spentMinor), uncoveredMinor: sum((m) => m.uncoveredMinor) };
  });
  const gap = (t: (typeof totals)[number]) => (!t ? null : tracking ? t.plannedMinor - t.spentMinor : t.uncoveredMinor);
  const tip = (i: number) => {
    const t = totals[i], b = buckets[i];
    if (!t) return <><TipTitle>{labels[i]}</TipTitle><TipNote>{gapReason(plan, b) === "unavailable" ? `This ${names.one} is not in your budget.` : `This ${names.one} could not be read.`}</TipNote></>;
    const g = gap(t);
    const rows = [
      { colour: "var(--fi-balance)", name: planName, value: money(t.plannedMinor) },
      { colour: "var(--fi-spend)", name: "Spent", value: money(t.spentMinor) },
      ...(tracking && g !== null ? [{ name: g >= 0 ? "Under budget by" : "Over budget by", value: money(Math.abs(g)), strong: true }] : []),
      ...(!tracking && t.uncoveredMinor ? [{ name: unit === "month" ? "Overspent last month" : "Overspent, taken from the next month", value: money(t.uncoveredMinor) }] : []),
    ];
    return monthTip({ title: labels[i], partial: b.partial, partialNote: unit === "month" ? "Partial month: it runs to today." : `Partial ${names.one}: only part of it is in the period, or it includes the month still running.`, rows });
  };
  const select = (i: number) => {
    const t = totals[i], b = buckets[i];
    if (!t || !allRead(plan, b)) return;
    onDrill({ kind: "budgetCell", categoryIds: allCategories(plan), name: "All categories", amountMinor: t.spentMinor, month: b.first, throughMonth: b.last !== b.first ? b.last : undefined });
  };
  const footnote = partials.length === 0 ? undefined
    : unit === "month" ? `* ${labels[partials[0]]} is partial: it runs to today, is drawn lighter with a dashed outline and is not counted.`
    : `* ${partials.map((i) => labels[i]).join(" and ")} ${partials.length === 1 ? "is" : "are"} partial: only part of ${partials.length === 1 ? "it" : "them"} is in the period, or ${partials.length === 1 ? "it includes" : "they include"} the month still running, so ${partials.length === 1 ? "it is" : "they are"} drawn lighter with a dashed outline and not counted.`;
  return (
    <ChartFrame
      id="my-budget-months" title={`${planName} vs spent, ${names.one} by ${names.one}`} hint={tracking ? "Saved budget against Actual's spending" : "Money assigned against Actual's spending"}
      subtitle={<><p>{tracking ? `Each ${names.one}'s saved budget for spending is the pale block, and what Actual recorded as spent is the bar in front of it.` : `Each ${names.one}'s assignments to categories are the pale block, and what Actual recorded as spent is the bar in front of it.`} A bar that rises above its block is over budget. The row under the months says by how much (−) or how much was left (+). A month Actual does not have, or that could not be read, is left as a gap, never drawn as zero.{unit !== "month" && ` A ${names.one} adds up its months that are in the budget; it is a calendar ${names.one}, and one the period only partly covers is marked *.`}</p><p>Select a bar to see that {names.one}&apos;s transactions.</p></>}
      legend={[{ label: planName, colour: "var(--fi-balance)" }, { label: "Spent, within it", colour: "var(--fi-up)" }, { label: "Spent, over it", colour: "var(--fi-other-liability)" }]}
      actions={<UnitPills value={unit} onChange={setUnit} label="Show the budget by" />}
      table={{ head: [names.one[0].toUpperCase() + names.one.slice(1), planName, "Spent", tracking ? "Under (+) / over (−) budget" : unit === "month" ? "Overspent last month" : "Overspent, taken from the next month"], rows: buckets.map((b, i) => [labels[i] + (b.partial ? " (partial)" : ""), totals[i]?.plannedMinor ?? null, totals[i]?.spentMinor ?? null, gap(totals[i])]) }}
      csvScope={scope}
      footnote={footnote}
    >
      <BudgetBars labels={labels} partialIndex={partials.length ? partials : null} height={320} ariaLabel={`Spent each ${names.one} against ${planName.toLowerCase()}`}
        spent={totals.map((t) => t?.spentMinor ?? null)} budget={totals.map((t) => t?.plannedMinor ?? null)}
        within="var(--fi-up)" over="var(--fi-other-liability)" block="var(--fi-balance)" tip={tip} onSelect={select} />
    </ChartFrame>
  );
}

// ─── Budget against spending, by group ──────────────────────────────────────

/**
 * One combined line per group or category, in the colours of the monthly chart above: what was spent within its budget in green,
 * the budget not spent in the pale tint of the budget block, and what was spent beyond it in red. Every line shares one scale,
 * so a larger amount is a longer line.
 */
function BudgetLine({ planMinor, spentMinor, scale, thin = false }: { planMinor: number; spentMinor: number; scale: number; thin?: boolean }) {
  const within = Math.max(0, Math.min(spentMinor, planMinor));
  const saved = Math.max(0, planMinor - Math.max(0, spentMinor));
  const extra = Math.max(0, spentMinor - Math.max(0, planMinor));
  const pct = (v: number) => `${(v / scale) * 100}%`;
  return (
    <div className={`overflow-hidden rounded-full bg-muted ${thin ? "h-1.5" : "h-2"}`} aria-hidden>
      <div className="flex h-full">
        <div className="h-full" style={{ width: pct(within), background: "var(--fi-up)" }} />
        <div className="h-full" style={{ width: pct(saved), background: BUDGET_TINT }} />
        <div className="h-full" style={{ width: pct(extra), background: "var(--fi-other-liability)" }} />
      </div>
    </div>
  );
}

/** One row of the card: the name, the line, then budgeted, spent, variance (under +, over −) and the share of spending. */
const BUDGET_ROW = "grid grid-cols-[minmax(7rem,13rem)_minmax(4rem,1fr)_6rem_6rem_6rem_3.25rem] items-center gap-x-3";

/** Budgeted less spent, green when under and red when over; spending with no budget saved is all over. */
function Variance({ planMinor, spentMinor }: { planMinor: number; spentMinor: number }) {
  const diff = planMinor - spentMinor;
  const unplanned = planMinor <= 0 && spentMinor > 0;
  return <span className={`text-right tabular-nums ${diff > 0 ? "text-green-700 dark:text-green-400" : diff < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`} title={unplanned ? "No budget saved: all of it is extra" : diff > 0 ? "Under budget" : diff < 0 ? "Over budget" : "On budget"}>{diff === 0 ? money(0) : signedMoney(diff)}</span>;
}

/** The groups of the budget (each opening into its categories): one row each, with the line against the budget, the figures and the share of spending. */
function BudgetByGroup({ plan, onDrill }: PlanProps) {
  const tracking = plan.mode === "tracking";
  const noun = tracking ? "Budgeted" : "Assigned";
  const [open, setOpen] = useState<Set<string>>(new Set());
  const byMost = <T extends { name: string; spentMinor: number; planMinor: number }>(a: T, b: T) => Math.max(b.spentMinor, b.planMinor) - Math.max(a.spentMinor, a.planMinor) || a.name.localeCompare(b.name);
  const groups = useMemo(() => [...plan.groups].sort(byMost), [plan.groups]);
  const totalSpent = groups.reduce((a, g) => a + g.spentMinor, 0), totalPlan = groups.reduce((a, g) => a + g.planMinor, 0);
  const scale = Math.max(1, ...groups.flatMap((g) => [g.spentMinor, g.planMinor]));
  const title = tracking ? "Budgeted vs spent by group" : "Assigned vs spent by group";
  const share = (v: number) => (totalSpent > 0 ? percent((v / totalSpent) * 100) : "-");
  const link = (name: string, ids: string[], spent: number) => <DrillLink label={`${name} ${money(spent)}`} onClick={() => onDrill({ kind: "budgetCell", categoryIds: ids, name, amountMinor: spent, ...wholeRange(plan) })}>{money(spent)}</DrillLink>;
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label={title}>
      <CardTitle title={title} hint={`${money(totalPlan)} ${tracking ? "budgeted" : "assigned"} · ${money(totalSpent)} spent`} infoLabel={title.toLowerCase()}
        info={<><p>Each category group over the completed months: {tracking ? "its saved budget" : "what was assigned to it"}, what was spent, the variance and its share of all the spending shown here.</p><p>The line is one scale for every row: <strong>green</strong> is spending within the {tracking ? "budget" : "assignment"}, the <strong>pale</strong> stretch is {tracking ? "budget" : "assigned money"} not spent, and <strong>red</strong> is spending beyond it, as in the monthly chart. Variance is {tracking ? "budgeted" : "assigned"} less spent: <strong>+</strong> is under, <strong>−</strong> is over. Spending with no budget saved is all red.</p><p>Select a group name to expand its categories, or a spent total to see its transactions.</p></>} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--fi-up)" }} aria-hidden />Spent within {tracking ? "budget" : "assigned"}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-border" style={{ background: BUDGET_TINT }} aria-hidden />{tracking ? "Budget" : "Assigned"} left</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--fi-other-liability)" }} aria-hidden />Over {tracking ? "budget" : "assigned"}</span>
      </div>
      {groups.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">No categories to show.</p> : (
        <OverlayScrollArea className="mt-2 flex-1">
          <div className="min-w-[34rem]">
            <div className={`${BUDGET_ROW} sticky top-0 z-10 border-b border-border bg-card py-1 text-xs text-muted-foreground`}>
              <span>Group</span><span aria-hidden />
              <span className="text-right">{noun}</span><span className="text-right">Spent</span><span className="text-right">Variance</span><span className="text-right">Share</span>
            </div>
            <div className="divide-y divide-border/40">
              {groups.map((g) => {
                const isOpen = open.has(g.name);
                return (
                  <div key={g.name}>
                    <div className={`${BUDGET_ROW} py-1 text-xs`}>
                      <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${g.name}, ${g.rows.length} ${g.rows.length === 1 ? "category" : "categories"}`} title={`${g.name}: ${g.rows.length} ${g.rows.length === 1 ? "category" : "categories"}`}
                        className="-ml-1 flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted/60" onClick={() => setOpen((cur) => { const n = new Set(cur); if (!n.delete(g.name)) n.add(g.name); return n; })}>
                        <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                        <span className="truncate font-medium">{g.name}{g.hidden ? " (hidden)" : ""}</span>
                      </button>
                      <BudgetLine planMinor={g.planMinor} spentMinor={g.spentMinor} scale={scale} />
                      <span className="text-right tabular-nums text-muted-foreground">{money(g.planMinor)}</span>
                      <span className="text-right">{link(g.name, g.categoryIds, g.spentMinor)}</span>
                      <Variance planMinor={g.planMinor} spentMinor={g.spentMinor} />
                      <span className="text-right tabular-nums text-muted-foreground">{share(g.spentMinor)}</span>
                    </div>
                    {isOpen && [...g.rows].sort(byMost).map((r) => (
                      <div key={r.id} className={`${BUDGET_ROW} border-t border-border/30 py-0.5 text-xs`}>
                        <span className="min-w-0 truncate pl-5 text-muted-foreground" title={r.name}>{r.name}{r.hidden ? " (hidden)" : ""}</span>
                        <BudgetLine planMinor={r.planMinor} spentMinor={r.spentMinor} scale={scale} thin />
                        <span className="text-right tabular-nums text-muted-foreground">{money(r.planMinor)}</span>
                        <span className="text-right">{link(r.name, [r.id], r.spentMinor)}</span>
                        <Variance planMinor={r.planMinor} spentMinor={r.spentMinor} />
                        <span className="text-right tabular-nums text-muted-foreground">{share(r.spentMinor)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </OverlayScrollArea>
      )}
      <p className="mt-1 border-t border-border/50 pt-1.5 text-xs text-muted-foreground">Over the {plural(plan.completed.length, "completed month")}; the share is of the spending shown here.</p>
    </section>
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
        <OverlayScrollArea className="mt-2 flex-1">
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
        </OverlayScrollArea>
      )}
      {list.length > 8 && <button type="button" className="mt-1 border-t border-border/50 pt-1.5 text-center text-xs text-muted-foreground underline" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>}
    </section>
  );
}

// ─── Category by month ──────────────────────────────────────────────────────

type Source = { name: string; ids: string[]; cells: (PlanCell | null)[] };

function BudgetHeatmap({ plan, onDrill }: PlanProps) {
  const [unit, setUnit] = useGranularity(plan.months.map((m) => m.month));
  const names = GRANULARITY_NAME[unit];
  const tracking = plan.mode === "tracking";
  const { show, hide } = useTip();
  const buckets = useMemo(() => planBuckets(plan, unit), [plan, unit]);
  if (plan.groups.length === 0) return null;
  // A category's cells over the months of each bucket, judged like a month; months not in the budget add nothing.
  const over = (cells: (PlanCell | null)[], balances: (number | null)[]) => buckets.map((b) => {
    const ok = b.indexes.filter((i) => plan.months[i].status === "ok");
    return combineCells(plan.mode, ok.map((i) => cells[i]), ok.length ? balances[ok[ok.length - 1]] : null);
  });
  const rowItem = (r: BudgetPlan["groups"][number]["rows"][number]): HeatItem<Source> => ({ key: r.id, name: r.name, totalMinor: r.spentMinor, order: r.order, hidden: r.hidden, data: { name: r.name, ids: [r.id], cells: over(r.cells, r.balances) } });
  const groups: HeatGroupItem<Source>[] = plan.groups.map((g, i) => ({ key: g.name, name: g.name, hidden: g.hidden, totalMinor: g.spentMinor, order: g.order, colour: groupColour(i), data: { name: g.name, ids: g.categoryIds, cells: over(g.cells, g.balances) }, rows: g.rows.map(rowItem) }));
  const cell = (src: Source, i: number) => {
    const b = buckets[i];
    if (!b.hasData) {
      const reason = gapReason(plan, b);
      return <td className="px-1 py-0.5 text-right text-muted-foreground/60" title={reason === "unavailable" ? "Not in your budget" : "Could not be read"}>{reason === "unavailable" ? "n/a" : "!"}</td>;
    }
    const c = src.cells[i];
    if (!c) return <td />;
    const partial = b.partial;
    const diff = c.planMinor - c.spentMinor;
    // A quarter or year with a month that is not in the budget or could not be read adds up only the months that were read, so its transactions would not match.
    if (!allRead(plan, b)) return <td className="px-1 py-0.5 text-right tabular-nums text-muted-foreground" title="Some months of this period are not in your budget or could not be read, so the transactions are not listed">{whole(c.spentMinor)}</td>;
    const text = partial ? `partial ${names.one}, not compared` : STATE_TEXT[c.state];
    const unplanned = c.state === "unplanned" && !partial;
    return (
      <td className="px-0.5 py-0.5">
        <button type="button" className="block w-full rounded px-1.5 py-0.5 text-right tabular-nums"
          style={{ background: partial ? "var(--fi-mid)" : SHADE[c.state](c.level), color: "var(--fi-cell-ink)", opacity: partial ? 0.75 : 1, outline: partial ? "1px dashed var(--muted-foreground)" : unplanned ? "1px dotted var(--muted-foreground)" : undefined, outlineOffset: -2 }}
          aria-label={`${src.name}, ${b.label}: spent ${money(c.spentMinor)}${tracking ? (c.planMinor ? ` of ${money(c.planMinor)} budgeted` : "") : ""}, ${text}. Show the transactions`}
          onClick={() => onDrill({ kind: "budgetCell", categoryIds: src.ids, name: src.name, amountMinor: c.spentMinor, month: b.first, throughMonth: b.last !== b.first ? b.last : undefined })} onMouseLeave={hide}
          onMouseMove={(e) => show(
            <>
              <TipTitle>{src.name} · {b.label}{partial ? " (partial)" : ""}</TipTitle>
              <TipRow name="Spent" value={money(c.spentMinor)} />
              {tracking ? <TipRow name="Plan" value={c.state === "unplanned" ? "None saved (unplanned)" : money(c.planMinor)} /> : <><TipRow name="Assigned" value={money(c.planMinor)} /><TipRow name="Balance" value={money(c.balanceMinor)} strong /></>}
              {tracking && c.planMinor > 0 && !partial && <TipRow name={diff >= 0 ? "Under budget by" : "Over budget by"} value={money(Math.abs(diff))} strong />}
              <TipNote>{partial ? `Partial ${names.one}: not compared with the budget.` : c.state === "unplanned" ? "Spending with no budget saved (Actual returns 0 for no budget and for a budget of 0) is unplanned spending; it counts as over budget." : c.state === "carried" ? `Overspent, and this category carries the overspending into next month${unit === "month" ? "" : " (in at least one month of the " + names.one + ")"}.` : c.state === "uncovered" ? `Overspent: Actual takes the amount from next month's money${unit === "month" ? "" : " (in at least one month of the " + names.one + ")"}.` : tracking ? `Colour shows spending against the plan, ${STATE_TEXT[c.state]}.` : "Covered: the balance is at or above zero."}</TipNote>
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
      <span>· darker = further from the budget · dashed = partial {names.one} · n/a = not in your budget</span>
    </>
  ) : (
    <>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.covered(1) }} aria-hidden />Covered</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.carried(1) }} aria-hidden />↷ Carried to next month</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-5 rounded-sm border border-border/60" style={{ background: SHADE.uncovered(1) }} aria-hidden />! Uncovered</span>
      <span>· dashed = partial {names.one} · n/a = not in your budget</span>
    </>
  );
  return (
    <CategoryHeatmap
      id="my-budget-category-by-month" title={tracking ? `Category by ${names.one}: spent against budget` : `Category by ${names.one}: coverage`} hint={`${tracking ? "Each cell against its saved budget" : "Whether each category's money covered what was spent"}${unit === "month" ? "" : `; a ${names.one} adds up its months`}`}
      infoLabel={`category by ${names.one}`} sortLabel="Spend" beforeSort={<UnitPills value={unit} onChange={setUnit} label="Show categories by" />}
      info={tracking
        ? <><p>Whole amounts spent, shaded by how they compare with that category&apos;s budget for the month. Colour says where spending sits against the budget, not whether it is good or bad.</p><p>Actual returns 0 for both &ldquo;no budget&rdquo; and a budget of 0, so spending against a budget of 0 is shown as <strong>unplanned spending</strong> (○) and counts as over budget.</p><p>Select a group name to expand its categories, or an amount to see its transactions.</p></>
        : <><p>Whole amounts spent. <strong>Covered</strong>: the balance is at or above zero, so earlier money paid for it. <strong>Carried</strong>: negative, and the category carries its overspending forward. <strong>Uncovered</strong>: negative and not carried, so Actual takes it from the next month.</p><p>Select a group name to expand its categories, or an amount to see its transactions.</p></>}
      legend={legend} initialGroups={10} defaultSort="order"
      months={buckets.map((b) => ({ key: b.key, label: b.label, partial: b.partial }))} groups={groups}
      renderCell={({ data }, i) => cell(data, i)}
      footer={<>Totals are spent over the {plural(plan.completed.length, "completed month")}. Hidden categories with a budget or spending are included{tracking && plan.groups.some((g) => g.rows.some((r) => r.hidden)) ? ", although Actual's Tracking totals leave them out" : ""}.</>}
    />
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
  const [unit, setUnit] = useGranularity(plan.months.map((m) => m.month));
  const names = GRANULARITY_NAME[unit];
  const buckets = useMemo(() => planBuckets(plan, unit), [plan, unit]);
  const labels = buckets.map((b) => b.label);
  const partials = buckets.flatMap((b, i) => (b.partial ? [i] : []));
  // What each bucket adds up to over its months that are in the budget.
  const sums = buckets.map((b) => {
    const ok = b.indexes.map((i) => plan.months[i]).filter((m) => m.status === "ok" && m.categorySpentMinor !== null);
    if (ok.length === 0) return null;
    const unplannedMinor = ok.reduce((a, m) => a + (m.unplannedMinor ?? 0), 0);
    return { unplannedMinor, plannedMinor: ok.reduce((a, m) => a + (m.categorySpentMinor ?? 0), 0) - unplannedMinor, totalMinor: ok.reduce((a, m) => a + (m.categorySpentMinor ?? 0), 0) };
  });
  const planned = sums.map((x) => x?.plannedMinor ?? null);
  const unplanned = sums.map((x) => x?.unplannedMinor ?? null);
  const series = [
    { key: "planned", label: "With a budget", colour: "var(--fi-balance)", values: planned },
    { key: "unplanned", label: "Unplanned", colour: "var(--fi-gap)", values: unplanned },
  ];
  // The categories behind each segment, by bucket. A category that had a budget in some months of a quarter or year and none in
  // others cannot be split between the two segments by its transactions, so such a bucket opens no list (its months do).
  const behind = useMemo(() => buckets.map((b) => {
    const rows = plan.groups.flatMap((g) => g.rows);
    const ok = b.indexes.filter((i) => plan.months[i].status === "ok");
    const unplannedIds: string[] = [], plannedIds: string[] = [];
    let mixed = false;
    for (const r of rows) {
      const states = ok.map((i) => r.cells[i]).filter((c): c is PlanCell => c !== null).map((c) => c.state === "unplanned");
      if (states.length === 0) continue;
      if (states.every(Boolean)) unplannedIds.push(r.id); else if (states.some(Boolean)) mixed = true; else plannedIds.push(r.id);
    }
    return { unplannedIds, plannedIds, mixed };
  }), [plan, buckets]);
  // A segment opens Actual's own transactions for the categories it is made of: those with no budget saved, or those with one.
  const select = (i: number, k: number) => {
    const x = sums[i], b = buckets[i];
    if (!allRead(plan, b)) return;
    const amount = k === 1 ? unplanned[i] : planned[i];
    if (!x || amount === null || amount === undefined || behind[i].mixed) return;
    onDrill({ kind: "budgetCell", categoryIds: k === 1 ? behind[i].unplannedIds : behind[i].plannedIds, name: k === 1 ? "Unplanned spending" : "Spending with a budget", amountMinor: amount, month: b.first, throughMonth: b.last !== b.first ? b.last : undefined });
  };
  const tip = (i: number) => {
    const x = sums[i], b = buckets[i];
    if (!x) return <><TipTitle>{labels[i]}</TipTitle><TipNote>{gapReason(plan, b) === "unavailable" ? `This ${names.one} is not in your budget.` : `This ${names.one} could not be read.`}</TipNote></>;
    return monthTip({ title: labels[i], partial: b.partial, partialNote: unit === "month" ? "Partial month: it runs to today." : `Partial ${names.one}: only part of it is in the period, or it includes the month still running.`, rows: [
      { colour: "var(--fi-balance)", name: "With a budget", value: money(x.plannedMinor) },
      { colour: "var(--fi-gap)", name: "Unplanned", value: money(x.unplannedMinor) },
      ...(x.totalMinor > 0 ? [{ name: "Unplanned share", value: percent((x.unplannedMinor / x.totalMinor) * 100) }] : []),
      ...(behind[i].mixed ? [{ name: <span className="text-muted-foreground">Select a month for its transactions: some categories had a budget in only part of this {names.one}</span>, value: "" }] : []),
    ] });
  };
  const footnote = partials.length === 0 ? undefined
    : unit === "month" ? `* ${labels[partials[0]]} is partial: it runs to today and is not counted.`
    : `* ${partials.map((i) => labels[i]).join(" and ")} ${partials.length === 1 ? "is" : "are"} partial: only part of ${partials.length === 1 ? "it" : "them"} is in the period, or ${partials.length === 1 ? "it includes" : "they include"} the month still running, so ${partials.length === 1 ? "it is" : "they are"} drawn lighter with a dashed outline and not counted.`;
  return (
    <ChartFrame
      id="my-budget-unplanned" title={`Unplanned spending by ${names.one}`} hint="Category spending with no budget saved"
      subtitle={<><p>Each bar is the {names.one}&apos;s spending across all expense categories, hidden ones included, split into categories with a budget and categories with none saved. Actual returns 0 for both no budget and a budget of 0, so both count as unplanned.{unit !== "month" && ` A ${names.one} adds up its months that are in the budget, and a category counts as unplanned only when it had no budget in any of them.`}</p><p>Select a segment to see its transactions.</p></>}
      legend={[{ label: "With a budget", colour: "var(--fi-balance)" }, { label: "Unplanned", colour: "var(--fi-gap)" }]}
      actions={<UnitPills value={unit} onChange={setUnit} label="Show unplanned spending by" />}
      table={{ head: [names.one[0].toUpperCase() + names.one.slice(1), "With a budget", "Unplanned"], rows: buckets.map((b, i) => [labels[i] + (b.partial ? " (partial)" : ""), planned[i], unplanned[i]]) }} csvScope={scope}
      footnote={footnote}
    >
      <BarChart labels={labels} partialIndex={partials.length ? partials : null} height={230} stacked ariaLabel={`Unplanned spending each ${names.one}`} series={series} tip={tip} onSelect={select}
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
        <ExplainBox plan={plan} />
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
        <ExplainBox plan={plan} />
        {plan.reconciliation && <ReconcileBox rec={plan.reconciliation} onDrill={onDrill} />}
      </div>
      <div className="grid items-stretch gap-4 2xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] 2xl:[&>*:last-child]:max-h-[30rem]">
        <MonthChart plan={plan} onDrill={onDrill} scope={scope} />
        <BudgetByGroup plan={plan} onDrill={onDrill} />
      </div>
      <BudgetHeatmap plan={plan} onDrill={onDrill} />
      <div className={plan.mode === "tracking" ? "grid items-start gap-4 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]" : ""}>
        {plan.mode === "tracking" && (
          <div className="space-y-4">
            <RoomToSave kpis={plan.kpis} />
            {plan.unplanned && <UnplannedChart plan={plan} scope={scope} onDrill={onDrill} />}
          </div>
        )}
        <Misses plan={plan} onDrill={onDrill} />
      </div>
    </div>
  );
}
