"use client";

import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import { heatBand, type GroupSeries, type SpendingRow } from "@/lib/financial-insights/breakdowns";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { GRANULARITY_NAME, bucketMonths, sumOver, type Bucket, type Granularity } from "@/lib/financial-insights/buckets";
import { usePayeeSpending, type FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, percent, formatDay } from "../format";
import { CategoryHeatmap, whole, type HeatGroupItem, type HeatItem } from "./CategoryHeatmap";
import { ChartFrame } from "./ChartFrame";
import { Delta } from "./Delta";
import { DrillLink } from "./DrillLink";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { useGranularity } from "../hooks/useGranularity";
import { UnitPills } from "./UnitPills";
import { BarChart } from "./charts/BarChart";
import { monthTip } from "./charts/monthTip";
import { TipNote, TipRow, TipTitle, useTip } from "./charts/Tip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
/** What the tab reads: spending, or money received (Income). The same cards, shaped by the same facts, with different words. */
type Mode = "spending" | "income";
const viewOf = (data: Ready, income: boolean) => (income ? { breakdown: data.income.breakdown, facts: data.income.facts, groups: data.income.groups } : { breakdown: data.breakdown, facts: data.spending, groups: data.groups });

/** "Where the money went" lists this many groups; every group is in the category table below. */
const TOP_GROUPS = 10;
const groupColour = (slot: number) => `var(--fi-g${slot})`;
const BELOW = ["", "var(--fi-below1)", "var(--fi-below2)", "var(--fi-below3)", "var(--fi-below4)"];
const ABOVE = ["", "var(--fi-above1)", "var(--fi-above2)", "var(--fi-above3)", "var(--fi-above4)"];

/** The transactions of a group, or of one category, in a month or in the whole period; the figure it sits on is the clicked amount. */
const groupTarget = (g: Pick<GroupSeries, "name" | "categoryIds" | "hasUncategorized">, amountMinor: number, month?: string, throughMonth?: string, income = false): DrillTarget => ({ kind: "category", categoryIds: g.categoryIds, includeUncategorized: g.hasUncategorized, name: g.name, amountMinor, month, throughMonth: throughMonth && throughMonth !== month ? throughMonth : undefined, income: income || undefined });
const rowTarget = (r: SpendingRow, amountMinor: number, month?: string, throughMonth?: string, income = false): DrillTarget => groupTarget({ name: r.name, categoryIds: r.id === null ? [] : [r.id], hasUncategorized: r.id === null }, amountMinor, month, throughMonth, income);


function Ranking({ data, onDrill, income }: { data: Ready; onDrill: (target: DrillTarget) => void; income: boolean }) {
  const { groups: { groups }, breakdown } = viewOf(data, income);
  const title = income ? "Where the money came from" : "Where the money went";
  const [open, setOpen] = useState<Set<string>>(new Set());
  const shown = groups.slice(0, TOP_GROUPS);
  const largest = Math.max(1, ...groups.map((g) => g.totalMinor));
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label={title}>
      <CardTitle title={title} hint={income ? (groups.length > TOP_GROUPS ? `Top ${TOP_GROUPS} of ${groups.length} categories` : "By income category") : groups.length > TOP_GROUPS ? `Top ${TOP_GROUPS} of ${groups.length} category groups` : "By category group"}
        info={<><p>By category group, net of refunds{breakdown.hasHidden ? ", hidden categories included" : ""}.</p><p>{income ? "Select a total to see all of its transactions." : "Select a total to see all of its transactions; select a group name to expand its categories."}</p>{groups.length > TOP_GROUPS && <p>The other {groups.length - TOP_GROUPS} groups are in the table below.</p>}</>} infoLabel={title.toLowerCase()} />
      <OverlayScrollArea className="mt-2 flex-1"><div className="divide-y divide-border/40">
        {shown.map((g) => {
          const isOpen = open.has(g.name);
          return (
            <div key={g.name} className="py-1">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem_3.5rem] items-center gap-3 text-xs">
                <div className="min-w-0">
                  {income ? (
                    <span className="flex w-full min-w-0 items-center gap-1.5 px-1 py-0.5">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: groupColour(g.slot) }} aria-hidden />
                      <span className="truncate font-medium" title={g.name}>{g.name}{g.rows[0]?.hidden ? " (hidden)" : ""}</span>
                    </span>
                  ) : (
                  <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${g.name}, ${g.rows.length} ${g.rows.length === 1 ? "category" : "categories"}`} title={`${g.name}: ${g.rows.length} ${g.rows.length === 1 ? "category" : "categories"}`}
                    className="-ml-1 flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/60" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.name)) n.delete(g.name); else n.add(g.name); return n; })}>
                    <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: groupColour(g.slot) }} aria-hidden />
                    <span className="truncate font-medium">{g.name}</span>
                  </button>
                  )}
                  <div className={`${income ? "ml-4" : "ml-6"} mt-1 h-1.5 overflow-hidden rounded-full bg-muted`} aria-hidden><div className="h-full rounded-full" style={{ width: `${(g.totalMinor / largest) * 100}%`, background: groupColour(g.slot) }} /></div>
                </div>
                <span className="text-right"><DrillLink label={`${g.name} ${money(g.totalMinor)}`} onClick={() => onDrill(groupTarget(g, g.totalMinor, undefined, undefined, income))}>{money(g.totalMinor)}</DrillLink></span>
                <span className="text-right tabular-nums text-muted-foreground">{breakdown.totalMinor > 0 ? percent((g.totalMinor / breakdown.totalMinor) * 100) : "-"}</span>
              </div>
              {isOpen && !income && (
                <ul className="ml-6 mt-1 divide-y divide-border/30">
                  {g.rows.map((r) => (
                    <li key={r.id ?? "uncategorized"} className="grid grid-cols-[minmax(0,1fr)_7rem_3.5rem] items-center gap-3 py-0.5 text-xs">
                      <span className="truncate text-muted-foreground" title={r.name}>{r.name}{r.hidden ? " (hidden)" : ""}</span>
                      <span className="text-right"><DrillLink label={`${r.name} ${money(r.totalMinor)}`} onClick={() => onDrill(rowTarget(r, r.totalMinor, undefined, undefined, income))}>{money(r.totalMinor)}</DrillLink></span>
                      <span className="text-right tabular-nums text-muted-foreground">{breakdown.totalMinor > 0 ? percent((r.totalMinor / breakdown.totalMinor) * 100) : "-"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div></OverlayScrollArea>
      {groups.length > TOP_GROUPS && <p className="mt-1 border-t border-border/50 pt-1.5 text-center text-xs text-muted-foreground">{groups.length - TOP_GROUPS} more {groups.length - TOP_GROUPS === 1 ? "group is" : "groups are"} in the table below</p>}
    </section>
  );
}

function Payees({ data, today, onDrill, switcher, income }: { data: Ready; today: string; onDrill: (target: DrillTarget) => void; switcher: ReactNode; income: boolean }) {
  const { payees: ranking, isLoading, isError, retry } = usePayeeSpending(data, today, income ? "income" : "spending");
  const who = income ? "payer" : "payee";
  const none = ranking?.noPayee ?? null;
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-label={income ? "Frequent payers" : "Frequent payees"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle title={income ? "Frequent payers" : "Frequent payees"} hint={income ? "Where most of the money came from, by payer" : "Where most of the money went, by payee"} info={<p>Transfers are not {who}s. Entries with no {who} are kept apart below the table.</p>} infoLabel={income ? "frequent payers" : "frequent payees"} />
        {switcher}
      </div>
      {isError ? (
        <p className="mt-2 text-xs text-muted-foreground" role="alert">{income ? "Payers" : "Payees"} could not be read. <button type="button" className="underline" onClick={retry}>Retry</button></p>
      ) : isLoading || !ranking ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">Reading {who}s…</p>
      ) : ranking.payees.length === 0 && !none ? (
        <p className="mt-2 text-xs text-muted-foreground">{income ? "No money was received in this period." : "No spending in this period."}</p>
      ) : (
        <>
          {ranking.payees.length > 0 && (
            <table className="mt-2 w-full border-collapse text-xs">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 font-medium">{income ? "Payer" : "Payee"}</th><th className="font-medium">Main category</th><th className="text-right font-medium">Entries</th><th className="text-right font-medium">Average</th><th className="text-right font-medium">Total</th></tr></thead>
              <tbody>
                {ranking.payees.map((p) => (
                  <tr key={p.payeeId ?? "none"} className="border-b border-border/40">
                    <th scope="row" className="max-w-56 truncate py-1 text-left font-normal" title={p.name}>{p.name}</th>
                    <td className="max-w-48 truncate text-muted-foreground">{p.topCategory ?? "-"}</td>
                    <td className="text-right tabular-nums">{p.count}</td>
                    <td className="text-right tabular-nums">{money(p.averageMinor)}</td>
                    <td className="text-right"><DrillLink label={`${p.name} ${money(p.totalMinor)}`} onClick={() => onDrill({ kind: "payee", payeeId: p.payeeId, name: p.name, amountMinor: p.totalMinor, income: income || undefined })}>{money(p.totalMinor)}</DrillLink></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {none && (
            <p className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
              {income ? "Not from a payer" : "Not by a payee"}: <DrillLink label={`No ${who} ${money(none.totalMinor)}`} onClick={() => onDrill({ kind: "payee", payeeId: null, name: `No ${who}`, amountMinor: none.totalMinor, income: income || undefined })}>{money(none.totalMinor)}</DrillLink> in {none.count.toLocaleString()} {none.count === 1 ? "entry" : "entries"} with no payee
              {none.splitParts > 0 ? `, ${none.splitParts.toLocaleString()} of them parts of split transactions` : ", none of them parts of a split transaction"}.
            </p>
          )}
        </>
      )}
    </section>
  );
}


/** Category group by month, quarter or year: every cell against its own row's average of whole units. Groups expand into their categories. */
function Heatmap({ data, onDrill, switcher, unitPills, unit, income }: { data: Ready; onDrill: (target: DrillTarget) => void; switcher: ReactNode; unitPills: ReactNode; unit: Granularity; income: boolean }) {
  const { monthly } = data;
  const { groups: { groups }, breakdown } = viewOf(data, income);
  const { show, hide } = useTip();
  const names = GRANULARITY_NAME[unit];
  const hasData = useMemo(() => monthly.map((m) => m.hasData), [monthly]);
  const buckets = useMemo(() => bucketMonths(monthly.map((m) => m.month), hasData, monthly.map((m) => m.partial), unit), [monthly, hasData, unit]);
  if (groups.length === 0) return null;
  const sum = (values: number[]) => buckets.map((b) => sumOver(values, b, hasData));
  const complete = buckets.flatMap((b, i) => (b.hasData && !b.partial ? [i] : []));
  const average = (values: number[]) => (complete.length ? complete.reduce((a, i) => a + values[i], 0) / complete.length : null);
  const cell = (name: string, values: number[], counts: number[] | null, i: number, target: (b: Bucket) => DrillTarget) => {
    const b = buckets[i];
    const v = values[i];
    if (!b.hasData) return <td className="px-1 py-0.5 text-right text-muted-foreground/60">-</td>;
    if (!v) return <td />;
    const avg = average(values), partial = b.partial;
    const band = partial ? 0 : heatBand(v, avg), diff = avg && !partial ? (v / avg - 1) * 100 : null;
    const bg = partial || band === 0 ? "var(--fi-mid)" : band < 0 ? BELOW[-band] : ABOVE[band];
    const glyph = diff === null ? "" : diff >= 25 ? "▲ " : diff <= -25 ? "▼ " : "";
    return (
      <td className="px-0.5 py-0.5">
        <button type="button" className="block w-full rounded px-1.5 py-0.5 text-right tabular-nums" style={{ background: bg, color: "var(--fi-cell-ink)", opacity: partial ? 0.75 : 1, outline: partial ? "1px dashed var(--muted-foreground)" : undefined, outlineOffset: -2 }}
          aria-label={`${name}, ${b.label}: ${money(v)}${diff === null ? "" : diff >= 0 ? `, ${diff.toFixed(0)}% above its usual` : `, ${Math.abs(diff).toFixed(0)}% below its usual`}. Show the transactions`}
          onClick={() => onDrill(target(b))} onMouseLeave={hide}
          onMouseMove={(e) => show(
            <>
              <TipTitle>{name} · {b.label}{partial ? " (partial)" : ""}</TipTitle>
              <TipRow name={income ? "Received" : "Spent"} value={money(v)} />
              {partial ? <TipNote>Partial {names.one}: not compared with whole {names.many}.</TipNote> : avg !== null && diff !== null && <TipNote><TipRow name={`Usual (average of whole ${names.many})`} value={money(Math.round(avg))} /><TipRow name="Compared with usual" value={`${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(0)}%`} /></TipNote>}
              {counts && <TipRow name="Entries" value={counts[i].toLocaleString()} />}
              <p className="mt-1 text-muted-foreground">Colour shows {income ? "income" : "spending"} relative to this row&apos;s usual, not whether it is good or bad.</p>
            </>, e)}>
          {glyph}{whole(v)}
        </button>
      </td>
    );
  };
  type Source = { group: GroupSeries; byUnit: number[]; counts: number[] | null } | { row: SpendingRow; byUnit: number[]; counts: number[] | null };
  const rowItem = (r: SpendingRow): HeatItem<Source> => ({ key: r.id ?? "u", name: r.name, totalMinor: r.totalMinor, order: r.order, data: { row: r, byUnit: sum(r.byMonth), counts: r.id === null ? null : sum(r.counts) } });
  const items: HeatGroupItem<Source>[] = groups.map((g) => ({ key: g.name, name: g.name, totalMinor: g.totalMinor, order: g.order, colour: groupColour(g.slot), data: { group: g, byUnit: sum(g.byMonth), counts: g.counts ? sum(g.counts) : null }, rows: g.rows.map(rowItem) }));
  const title = `Category by ${names.one}`;
  return (
    <CategoryHeatmap
      id="category-by-month" title={title} hint="Each cell against its row's usual" infoLabel={title.toLowerCase()} switcher={switcher} beforeSort={unitPills} flat={income} firstColumnLabel={income ? "Category" : "Category group"}
      info={<><p>Whole amounts, each against that row&apos;s own average over the whole {names.many}. Cooler means below its usual, warmer above; neither is good or bad.</p><p>{income ? "Select an amount to see its transactions." : "Select a group name to expand its categories, or an amount to see its transactions."}</p>{unit !== "month" && <p>A {names.one} the period only partly covers, or that includes a month still running, is marked * and not compared.</p>}</>}
      legend={<>
        <span>Below usual</span>
        <span className="flex gap-0.5" aria-hidden>{[BELOW[4], BELOW[3], BELOW[2], BELOW[1], "var(--fi-mid)", ABOVE[1], ABOVE[2], ABOVE[3], ABOVE[4]].map((c, i) => <i key={i} className="inline-block h-2.5 w-5 rounded-sm" style={{ background: c }} />)}</span>
        <span>Above usual</span><span>· ▼ ≤ −25% · ▲ ≥ +25% · dashed = partial {names.one}</span>
      </>}
      months={buckets.map((b) => ({ key: b.key, label: b.label, partial: b.partial }))} groups={items}
      renderCell={({ data }, i) => ("group" in data
        ? cell(data.group.name, data.byUnit, data.counts, i, (b) => groupTarget(data.group, data.byUnit[i], b.first, b.last, income))
        : cell(data.row.name, data.byUnit, data.counts, i, (b) => rowTarget(data.row, data.byUnit[i], b.first, b.last, income)))}
      footer={<>Totals: {money(breakdown.totalMinor)} {income ? "received" : "spent"} in the period.</>}
    />
  );
}

/**
 * Spending (where the money went) or Income (where it came from): the same cards over the same period, by category group by
 * month, quarter or year, by category group, by payee or payer and category by period. Income is money received, not budgeted income.
 */
export function FlowTab({ mode, data, today, onDrill }: { mode: Mode; data: Ready; today: string; onDrill: (target: DrillTarget) => void }) {
  const income = mode === "income";
  const { monthly, period, comparison, summary } = data;
  const view = useMemo(() => viewOf(data, income), [data, income]);
  const { facts: spending, groups, breakdown } = view;
  /** What a month holds on this side: money received, or money spent. */
  const amountOf = (m: (typeof monthly)[number]) => (income ? m.received : m.spent);
  const word = income ? { total: "Total received", flow: "Income", noun: "received", of: "the period's income", compare: "income", source: "Largest source", detail: "Net of refunds of income; transfers are not income", payees: "Frequent payers" } : { total: "Total spent", flow: "Spending", noun: "spent", of: "the period's spending", compare: "spending", source: "Largest group", detail: "Net of refunds, including hidden categories", payees: "Frequent payees" };
  const [below, setBelow] = useState<"categories" | "payees">("categories");
  const [chartUnit, setChartUnit] = useGranularity(monthly.map((m) => m.month));
  const [tableUnit, setTableUnit] = useGranularity(monthly.map((m) => m.month));
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const names = GRANULARITY_NAME[chartUnit];
  const hasData = useMemo(() => monthly.map((m) => m.hasData), [monthly]);
  const buckets = useMemo(() => bucketMonths(monthly.map((m) => m.month), hasData, monthly.map((m) => m.partial), chartUnit), [monthly, hasData, chartUnit]);
  const labels = buckets.map((b) => b.label);
  const partials = buckets.flatMap((b, i) => (b.partial ? [i] : []));
  const partialNote = chartUnit === "month" ? `Partial month: it runs to ${formatDay(period.endDate)}.` : `Partial ${names.one}: the period covers only part of it (it runs from ${formatDay(period.startDate)} to ${formatDay(period.endDate)}).`;
  const pace = spending.pace;
  const highest = monthly.reduce<{ i: number; v: number } | null>((best, m, i) => (m.hasData && !m.partial && (best === null || amountOf(m) > best.v) ? { i, v: amountOf(m) } : best), null);
  const monthLabels = monthly.map((m) => bucketMonths([m.month], [true], [false], "month")[0].label);
  const amounts = useMemo(() => monthly.map((m) => (income ? m.received : m.spent)), [monthly, income]);
  const spentBy = useMemo(() => buckets.map((b) => sumOver(amounts, b, hasData)), [buckets, amounts, hasData]);
  const totals = buckets.map((b, i) => (b.hasData ? spentBy[i] : null));
  const stacked = groups.stacked;
  const stackedBy = useMemo(() => stacked.map((g) => ({ g, byUnit: buckets.map((b) => sumOver(g.byMonth, b, hasData)), counts: g.counts ? buckets.map((b) => sumOver(g.counts!, b, hasData)) : null })), [stacked, buckets, hasData]);
  const series = stackedBy.map(({ g, byUnit }) => ({ key: g.name, label: g.name, colour: groupColour(g.slot), values: byUnit.map((v, i) => (buckets[i].hasData ? v : null)) }));
  const select = (i: number, k: number) => {
    const b = buckets[i];
    onDrill(groupTarget(stackedBy[k].g, stackedBy[k].byUnit[i], b.first, b.last, income));
  };
  const tip = (i: number, k: number | null) => {
    const b = buckets[i];
    const spent = spentBy[i];
    const entries = stackedBy.every((x) => x.counts) ? stackedBy.reduce((a, x) => a + (x.counts?.[i] ?? 0), 0) : null;
    const total = { name: word.total, value: money(spent), strong: true };
    const rows = [total, ...stackedBy.map((x) => ({ g: x.g, v: x.byUnit[i] })).filter((r) => r.v !== 0).sort((x, y) => y.v - x.v).map(({ g, v }) => ({ colour: groupColour(g.slot), name: <span className={k !== null && stackedBy[k]?.g === g ? "font-semibold text-foreground" : undefined}>{g.name}</span>, value: `${money(v)} · ${spent ? ((v / spent) * 100).toFixed(0) : 0}%` }))];
    return monthTip({ title: b.label, partial: b.partial, partialNote, rows, compare: { values: totals, index: i, label: word.compare }, share: { part: spent, whole: breakdown.totalMinor, of: word.of }, entries });
  };
  const partialFootnote = partials.length === 0 ? undefined
    : chartUnit === "month" ? `* ${labels[partials[0]]} is partial: it runs to ${formatDay(period.endDate)}, is drawn lighter with a dashed outline and is not compared with full months.`
    : `* ${partials.map((i) => labels[i]).join(" and ")} ${partials.length === 1 ? "is" : "are"} partial: the period covers only part of ${partials.length === 1 ? "it" : "them"} (${formatDay(period.startDate)} to ${formatDay(period.endDate)}), so ${partials.length === 1 ? "it is" : "they are"} drawn lighter with a dashed outline and not compared with whole ${names.many}.`;
  // Against the stretch before, what has no category (a hint of how much of the picture is guessed) and, for spending, what it is of what came in.
  const uncategorized = breakdown.rows.find((r) => r.id === null)?.totalMinor ?? 0;
  const totalDetail = (
    <>
      {((!income && summary.received > 0) || (uncategorized !== 0 && breakdown.totalMinor > 0)) && (
        <span className="block">
          {!income && summary.received > 0 && <>{percent((spending.totalMinor / summary.received) * 100)} of what you received</>}
          {!income && summary.received > 0 && uncategorized !== 0 && breakdown.totalMinor > 0 && " · "}
          {uncategorized !== 0 && breakdown.totalMinor > 0 && <>{percent((uncategorized / breakdown.totalMinor) * 100)} has no category</>}
        </span>
      )}
    </>
  );
  const switcher = <PillGroup options={[{ value: "categories", label: `Category by ${GRANULARITY_NAME[tableUnit].one}` }, { value: "payees", label: word.payees }]} value={below} onChange={(v) => setBelow(v as typeof below)} />;
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label={word.total} detail={totalDetail} delta={comparison && <Delta now={income ? comparison.current.received : comparison.current.spent} before={income ? comparison.previous.received : comparison.previous.spent} label={comparison.label} good={income ? "up" : "down"} />} info={<p>{word.detail}</p>}><DrillLink smallDecimals label={`${word.total} ${money(spending.totalMinor)}`} onClick={() => onDrill({ kind: income ? "received" : "spent" })}>{money(spending.totalMinor)}</DrillLink></Tile>
        <Tile label="Monthly average" detail={spending.averageMonths > 0 ? `Over ${spending.averageMonths} complete ${spending.averageMonths === 1 ? "month" : "months"}${period.partial ? "; this month is not counted" : ""}` : "No complete month in this period"}>{spending.averageMinor === null ? "Unavailable" : money(spending.averageMinor)}</Tile>
        <Tile label={word.source} detail={groups.groups[0] ? `${money(groups.groups[0].totalMinor)}${breakdown.totalMinor > 0 ? ` · ${percent((groups.groups[0].totalMinor / breakdown.totalMinor) * 100)} of ${income ? "income" : "spending"}` : ""}` : undefined}>{groups.groups[0] ? <span className="line-clamp-2 block text-base leading-snug" title={groups.groups[0].name}>{groups.groups[0].name}</span> : "-"}</Tile>
        <Tile label="Highest month" detail={highest ? monthLabels[highest.i] : "No complete month in this period"}>{highest ? money(highest.v) : "-"}</Tile>
        <Tile label="Recent pace" detail={pace.state === "ready" ? `Latest three months average ${money(pace.latestMinor)}; earliest three ${money(pace.earliestMinor)}` : pace.reason}>{pace.state === "ready" ? (pace.changePercent === null ? "-" : `${pace.changePercent > 0 ? "+" : ""}${percent(pace.changePercent)}`) : "Not enough months"}</Tile>
      </div>
      {income && groups.groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-12 text-center text-xs text-muted-foreground" role="status">No money was received in this period.</p>
      ) : (
        <>
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] xl:[&>*:last-child]:max-h-[34rem]">
        <ChartFrame
          id={`${mode}-over-time`} title={`${word.flow} each ${names.one}`} hint={income ? "By income category" : "By category group"} subtitle={<p>{`${income ? "By income category" : "By category group"}; the stack adds up to Money ${word.noun}. Select a segment for that ${income ? "category" : "group"} in that ${names.one}.`}{chartUnit !== "month" && ` A ${names.one} is a calendar ${names.one}; one the period only partly covers is marked *.`}</p>}
          legend={stacked.map((g) => ({ label: g.name, colour: groupColour(g.slot) }))}
          actions={<UnitPills value={chartUnit} onChange={setChartUnit} label={`Show ${word.flow.toLowerCase()} by`} />}
          table={{ head: [names.one[0].toUpperCase() + names.one.slice(1), ...stacked.map((g) => g.name), "Total"], rows: buckets.map((b, i) => [labels[i] + (b.partial ? " (partial)" : ""), ...stackedBy.map((x) => (b.hasData ? x.byUnit[i] : null)), totals[i]]) }} csvScope={scope}
          footnote={partialFootnote}
        >
          <BarChart labels={labels} partialIndex={chartUnit === "month" ? (partials[0] ?? null) : partials.length ? partials : null} height={340} stacked totals ariaLabel={`${word.flow} each ${names.one}`} series={series} tip={tip} onSelect={select} />
        </ChartFrame>
        <Ranking data={data} onDrill={onDrill} income={income} />
      </div>
      {below === "categories" ? <Heatmap data={data} onDrill={onDrill} income={income} unit={tableUnit} switcher={switcher} unitPills={<UnitPills value={tableUnit} onChange={setTableUnit} label="Show categories by" />} /> : <Payees data={data} today={today} income={income} onDrill={onDrill} switcher={switcher} />}
        </>
      )}
    </div>
  );
}
