"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import { heatBand, type GroupSeries, type SpendingRow } from "@/lib/financial-insights/breakdowns";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { monthLabel } from "@/lib/financial-insights/period";
import { usePayeeSpending, type FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, percent, formatDay } from "../format";
import { CategoryHeatmap, whole, type HeatGroupItem, type HeatItem } from "./CategoryHeatmap";
import { ChartFrame } from "./ChartFrame";
import { DrillLink } from "./DrillLink";
import { CardTitle } from "./InfoTip";
import { Tile } from "./Tile";
import { BarChart } from "./charts/BarChart";
import { monthTip } from "./charts/monthTip";
import { TipNote, TipRow, TipTitle, useTip } from "./charts/Tip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
/** "Where the money went" lists this many groups; every group is in Category by month. */
const TOP_GROUPS = 10;
const groupColour = (slot: number) => `var(--fi-g${slot})`;
const BELOW = ["", "var(--fi-below1)", "var(--fi-below2)", "var(--fi-below3)", "var(--fi-below4)"];
const ABOVE = ["", "var(--fi-above1)", "var(--fi-above2)", "var(--fi-above3)", "var(--fi-above4)"];

/** The transactions of a group, or of one category, in a month or in the whole period; the figure it sits on is the clicked amount. */
const groupTarget = (g: Pick<GroupSeries, "name" | "categoryIds" | "hasUncategorized">, amountMinor: number, month?: string): DrillTarget => ({ kind: "category", categoryIds: g.categoryIds, includeUncategorized: g.hasUncategorized, name: g.name, amountMinor, month });
const rowTarget = (r: SpendingRow, amountMinor: number, month?: string): DrillTarget => groupTarget({ name: r.name, categoryIds: r.id === null ? [] : [r.id], hasUncategorized: r.id === null }, amountMinor, month);

function Ranking({ data, onDrill }: { data: Ready; onDrill: (target: DrillTarget) => void }) {
  const { groups: { groups }, breakdown } = data;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const shown = groups.slice(0, TOP_GROUPS);
  const largest = Math.max(1, ...groups.map((g) => g.totalMinor));
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label="Where the money went">
      <CardTitle title="Where the money went" hint={groups.length > TOP_GROUPS ? `Top ${TOP_GROUPS} of ${groups.length} category groups` : "By category group"}
        info={<><p>By category group, net of refunds{breakdown.hasHidden ? ", hidden categories included" : ""}.</p><p>Select a total to see all of its transactions; select a group name to expand its categories.</p>{groups.length > TOP_GROUPS && <p>The other {groups.length - TOP_GROUPS} groups are in Category by month.</p>}</>} infoLabel="where the money went" />
      <div className="mt-2 min-h-0 flex-1 divide-y divide-border/40 overflow-y-auto">
        {shown.map((g) => {
          const isOpen = open.has(g.name);
          return (
            <div key={g.name} className="py-1">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem_3.5rem] items-center gap-3 text-xs">
                <div className="min-w-0">
                  <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${g.name}, ${g.rows.length} ${g.rows.length === 1 ? "category" : "categories"}`} title={`${g.name}: ${g.rows.length} ${g.rows.length === 1 ? "category" : "categories"}`}
                    className="-ml-1 flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/60" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.name)) n.delete(g.name); else n.add(g.name); return n; })}>
                    <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: groupColour(g.slot) }} aria-hidden />
                    <span className="truncate font-medium">{g.name}</span>
                  </button>
                  <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full" style={{ width: `${(g.totalMinor / largest) * 100}%`, background: groupColour(g.slot) }} /></div>
                </div>
                <span className="text-right"><DrillLink label={`${g.name} ${money(g.totalMinor)}`} onClick={() => onDrill(groupTarget(g, g.totalMinor))}>{money(g.totalMinor)}</DrillLink></span>
                <span className="text-right tabular-nums text-muted-foreground">{breakdown.totalMinor > 0 ? percent((g.totalMinor / breakdown.totalMinor) * 100) : "-"}</span>
              </div>
              {isOpen && (
                <ul className="ml-6 mt-1 divide-y divide-border/30">
                  {g.rows.map((r) => (
                    <li key={r.id ?? "uncategorized"} className="grid grid-cols-[minmax(0,1fr)_7rem_3.5rem] items-center gap-3 py-0.5 text-xs">
                      <span className="truncate text-muted-foreground" title={r.name}>{r.name}{r.hidden ? " (hidden)" : ""}</span>
                      <span className="text-right"><DrillLink label={`${r.name} ${money(r.totalMinor)}`} onClick={() => onDrill(rowTarget(r, r.totalMinor))}>{money(r.totalMinor)}</DrillLink></span>
                      <span className="text-right tabular-nums text-muted-foreground">{breakdown.totalMinor > 0 ? percent((r.totalMinor / breakdown.totalMinor) * 100) : "-"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {groups.length > TOP_GROUPS && <p className="mt-1 border-t border-border/50 pt-1.5 text-center text-xs text-muted-foreground">{groups.length - TOP_GROUPS} more {groups.length - TOP_GROUPS === 1 ? "group is" : "groups are"} in Category by month</p>}
    </section>
  );
}

function Payees({ data, today, onDrill, switcher }: { data: Ready; today: string; onDrill: (target: DrillTarget) => void; switcher: ReactNode }) {
  const { payees: ranking, isLoading, isError, retry } = usePayeeSpending(data, today);
  const none = ranking?.noPayee ?? null;
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-label="Frequent payees">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle title="Frequent payees" hint="Where most of the money went, by payee" info={<p>Transfers are not payees. Entries with no payee are kept apart below the table.</p>} infoLabel="frequent payees" />
        {switcher}
      </div>
      {isError ? (
        <p className="mt-2 text-xs text-muted-foreground" role="alert">Payees could not be read. <button type="button" className="underline" onClick={retry}>Retry</button></p>
      ) : isLoading || !ranking ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">Reading payees…</p>
      ) : ranking.payees.length === 0 && !none ? (
        <p className="mt-2 text-xs text-muted-foreground">No spending in this period.</p>
      ) : (
        <>
          {ranking.payees.length > 0 && (
            <table className="mt-2 w-full border-collapse text-xs">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 font-medium">Payee</th><th className="font-medium">Main category</th><th className="text-right font-medium">Entries</th><th className="text-right font-medium">Average</th><th className="text-right font-medium">Total</th></tr></thead>
              <tbody>
                {ranking.payees.map((p) => (
                  <tr key={p.payeeId ?? "none"} className="border-b border-border/40">
                    <th scope="row" className="max-w-56 truncate py-1 text-left font-normal" title={p.name}>{p.name}</th>
                    <td className="max-w-48 truncate text-muted-foreground">{p.topCategory ?? "-"}</td>
                    <td className="text-right tabular-nums">{p.count}</td>
                    <td className="text-right tabular-nums">{money(p.averageMinor)}</td>
                    <td className="text-right"><DrillLink label={`${p.name} ${money(p.totalMinor)}`} onClick={() => onDrill({ kind: "payee", payeeId: p.payeeId, name: p.name, amountMinor: p.totalMinor })}>{money(p.totalMinor)}</DrillLink></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {none && (
            <p className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
              Not by a payee: <DrillLink label={`No payee ${money(none.totalMinor)}`} onClick={() => onDrill({ kind: "payee", payeeId: null, name: "No payee", amountMinor: none.totalMinor })}>{money(none.totalMinor)}</DrillLink> in {none.count.toLocaleString()} {none.count === 1 ? "entry" : "entries"} with no payee
              {none.splitParts > 0 ? `, ${none.splitParts.toLocaleString()} of them parts of split transactions` : ", none of them parts of a split transaction"}.
            </p>
          )}
        </>
      )}
    </section>
  );
}


/** Category group by month: every cell against its own row's average of complete months. Groups expand into their categories. */
function Heatmap({ data, onDrill, switcher }: { data: Ready; onDrill: (target: DrillTarget) => void; switcher: ReactNode }) {
  const { groups: { groups }, monthly, breakdown } = data;
  const { show, hide } = useTip();
  if (groups.length === 0) return null;
  const complete = monthly.flatMap((m, i) => (m.hasData && !m.partial ? [i] : []));
  const average = (values: number[]) => (complete.length ? complete.reduce((a, i) => a + values[i], 0) / complete.length : null);
  const cell = (name: string, values: number[], counts: number[] | null, i: number, target: () => DrillTarget) => {
    const v = values[i];
    if (!monthly[i].hasData) return <td className="px-1 py-0.5 text-right text-muted-foreground/60">-</td>;
    if (!v) return <td />;
    const avg = average(values), partial = monthly[i].partial;
    const band = partial ? 0 : heatBand(v, avg), diff = avg && !partial ? (v / avg - 1) * 100 : null;
    const bg = partial || band === 0 ? "var(--fi-mid)" : band < 0 ? BELOW[-band] : ABOVE[band];
    const glyph = diff === null ? "" : diff >= 25 ? "▲ " : diff <= -25 ? "▼ " : "";
    return (
      <td className="px-0.5 py-0.5">
        <button type="button" className="block w-full rounded px-1.5 py-0.5 text-right tabular-nums" style={{ background: bg, color: "var(--fi-cell-ink)", opacity: partial ? 0.75 : 1, outline: partial ? "1px dashed var(--muted-foreground)" : undefined, outlineOffset: -2 }}
          aria-label={`${name}, ${monthLabel(monthly[i].month)}: ${money(v)}${diff === null ? "" : diff >= 0 ? `, ${diff.toFixed(0)}% above its usual` : `, ${Math.abs(diff).toFixed(0)}% below its usual`}. Show the transactions`}
          onClick={() => onDrill(target())} onMouseLeave={hide}
          onMouseMove={(e) => show(
            <>
              <TipTitle>{name} · {monthLabel(monthly[i].month)}{partial ? " (partial)" : ""}</TipTitle>
              <TipRow name="Spent" value={money(v)} />
              {partial ? <TipNote>Partial month: not compared with full months.</TipNote> : avg !== null && diff !== null && <TipNote><TipRow name="Usual (average of complete months)" value={money(Math.round(avg))} /><TipRow name="Compared with usual" value={`${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(0)}%`} /></TipNote>}
              {counts && <TipRow name="Entries" value={counts[i].toLocaleString()} />}
              <p className="mt-1 text-muted-foreground">Colour shows spending relative to this row&apos;s usual, not whether it is good or bad.</p>
            </>, e)}>
          {glyph}{whole(v)}
        </button>
      </td>
    );
  };
  type Source = { group: GroupSeries } | { row: SpendingRow };
  const rowItem = (r: SpendingRow): HeatItem<Source> => ({ key: r.id ?? "u", name: r.name, totalMinor: r.totalMinor, order: r.order, data: { row: r } });
  const items: HeatGroupItem<Source>[] = groups.map((g) => ({ key: g.name, name: g.name, totalMinor: g.totalMinor, order: g.order, colour: groupColour(g.slot), data: { group: g }, rows: g.rows.map(rowItem) }));
  return (
    <CategoryHeatmap
      id="category-by-month" title="Category by month" hint="Each cell against its row's usual" infoLabel="category by month" switcher={switcher}
      info={<><p>Whole amounts, each against that row&apos;s own average over the complete months. Cooler means below its usual, warmer above; neither is good or bad.</p><p>Select a group name to expand its categories, or an amount to see its transactions.</p></>}
      legend={<>
        <span>Below usual</span>
        <span className="flex gap-0.5" aria-hidden>{[BELOW[4], BELOW[3], BELOW[2], BELOW[1], "var(--fi-mid)", ABOVE[1], ABOVE[2], ABOVE[3], ABOVE[4]].map((c, i) => <i key={i} className="inline-block h-2.5 w-5 rounded-sm" style={{ background: c }} />)}</span>
        <span>Above usual</span><span>· ▼ ≤ −25% · ▲ ≥ +25% · dashed = partial month</span>
      </>}
      months={monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), partial: m.partial }))} groups={items}
      renderCell={({ data }, i) => ("group" in data
        ? cell(data.group.name, data.group.byMonth, data.group.counts, i, () => groupTarget(data.group, data.group.byMonth[i], monthly[i].month))
        : cell(data.row.name, data.row.byMonth, data.row.id === null ? null : data.row.counts, i, () => rowTarget(data.row, data.row.byMonth[i], monthly[i].month)))}
      footer={<>Totals: {money(breakdown.totalMinor)} spent in the period.</>}
    />
  );
}

/** Spending: where the money went, in total, by month, by category group, by payee and category by month. */
export function SpendingTab({ data, today, onDrill }: { data: Ready; today: string; onDrill: (target: DrillTarget) => void }) {
  const { spending, monthly, period, groups, breakdown } = data;
  const [mode, setMode] = useState<"group" | "total">("group");
  const [below, setBelow] = useState<"categories" | "payees">("categories");
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const labels = monthly.map((m) => monthLabel(m.month));
  const partial = monthly.findIndex((m) => m.partial) === -1 ? null : monthly.findIndex((m) => m.partial);
  const partialNote = `Partial month: it runs to ${formatDay(period.endDate)}.`;
  const pace = spending.pace;
  const highest = monthly.reduce<{ i: number; v: number } | null>((best, m, i) => (m.hasData && !m.partial && (best === null || m.spent > best.v) ? { i, v: m.spent } : best), null);
  const totals = monthly.map((m) => (m.hasData ? m.spent : null));
  const stacked = groups.stacked;
  const series = mode === "group"
    ? stacked.map((g) => ({ key: g.name, label: g.name, colour: groupColour(g.slot), values: g.byMonth.map((v, i) => (monthly[i].hasData ? v : null)) }))
    : [{ key: "spent", label: "Spent", colour: "var(--fi-spend)", values: totals }];
  const select = (i: number, k: number) => {
    if (mode === "total") return onDrill({ kind: "spent", month: monthly[i].month });
    const g = stacked[k];
    onDrill(groupTarget(g, g.byMonth[i], monthly[i].month));
  };
  const tip = (i: number, k: number | null) => {
    const m = monthly[i];
    const entries = stacked.every((g) => g.counts) ? stacked.reduce((a, g) => a + (g.counts?.[i] ?? 0), 0) : null;
    const total = { name: <span className="font-semibold text-foreground">Total spent</span>, value: <span className="font-semibold">{money(m.spent)}</span> };
    const rows = mode === "group" ? [total, ...stacked.map((g) => ({ g, v: g.byMonth[i] })).filter((r) => r.v !== 0).sort((a, b) => b.v - a.v).map(({ g, v }) => ({ colour: groupColour(g.slot), name: <span className={k !== null && stacked[k] === g ? "font-semibold text-foreground" : undefined}>{g.name}</span>, value: `${money(v)} · ${m.spent ? ((v / m.spent) * 100).toFixed(0) : 0}%` }))] : [total];
    return monthTip({ title: labels[i], partial: m.partial, partialNote, rows, compare: { values: totals, index: i, label: "spending" }, share: { part: m.spent, whole: breakdown.totalMinor, of: "the period's spending" }, entries });
  };
  const switcher = <PillGroup options={[{ value: "categories", label: "Category by month" }, { value: "payees", label: "Frequent payees" }]} value={below} onChange={(v) => setBelow(v as typeof below)} />;
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Total spent" detail="Net of refunds, including hidden categories"><DrillLink smallDecimals label={`Total spent ${money(spending.totalMinor)}`} onClick={() => onDrill({ kind: "spent" })}>{money(spending.totalMinor)}</DrillLink></Tile>
        <Tile label="Monthly average" detail={spending.averageMonths > 0 ? `Over ${spending.averageMonths} complete ${spending.averageMonths === 1 ? "month" : "months"}${period.partial ? "; this month is not counted" : ""}` : "No complete month in this period"}>{spending.averageMinor === null ? "Unavailable" : money(spending.averageMinor)}</Tile>
        <Tile label="Largest group" detail={groups.groups[0] ? money(groups.groups[0].totalMinor) : undefined}>{groups.groups[0]?.name ?? "-"}</Tile>
        <Tile label="Highest month" detail={highest ? labels[highest.i] : "No complete month in this period"}>{highest ? money(highest.v) : "-"}</Tile>
        <Tile label="Recent pace" detail={pace.state === "ready" ? `Latest three months average ${money(pace.latestMinor)}; earliest three ${money(pace.earliestMinor)}` : pace.reason}>{pace.state === "ready" ? (pace.changePercent === null ? "-" : `${pace.changePercent > 0 ? "+" : ""}${percent(pace.changePercent)}`) : "Not enough months"}</Tile>
      </div>
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] xl:[&>*:last-child]:max-h-[34rem]">
        <ChartFrame
          id="spending-over-time" title="Spending each month" hint={mode === "group" ? "By category group" : "Monthly total"} subtitle={<p>{mode === "group" ? "By category group; the stack adds up to Money spent. Select a segment for that group in that month." : "The monthly total. Select a bar for that month's spending."}</p>}
          legend={mode === "group" ? stacked.map((g) => ({ label: g.name, colour: groupColour(g.slot) })) : [{ label: "Spent", colour: "var(--fi-spend)" }]}
          actions={<PillGroup options={[{ value: "group", label: "By group" }, { value: "total", label: "Total" }]} value={mode} onChange={(v) => setMode(v as typeof mode)} />}
          table={{ head: ["Month", ...(mode === "group" ? stacked.map((g) => g.name) : []), "Total"], rows: monthly.map((m, i) => [labels[i] + (m.partial ? " (partial)" : ""), ...(mode === "group" ? stacked.map((g) => (m.hasData ? g.byMonth[i] : null)) : []), totals[i]]) }} csvScope={scope}
          footnote={partial !== null ? `* ${labels[partial]} is partial: it runs to ${formatDay(period.endDate)}, is drawn lighter with a dashed outline and is not compared with full months.` : undefined}
        >
          <BarChart labels={labels} partialIndex={partial} height={340} stacked ariaLabel="Spending each month" series={series} tip={tip} onSelect={select} />
        </ChartFrame>
        <Ranking data={data} onDrill={onDrill} />
      </div>
      {below === "categories" ? <Heatmap data={data} onDrill={onDrill} switcher={switcher} /> : <Payees data={data} today={today} onDrill={onDrill} switcher={switcher} />}
    </div>
  );
}
