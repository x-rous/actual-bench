"use client";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { cn } from "@/lib/utils";
import { Segmented } from "./filterChips";
import {
  addDays, facetFromRows, fetchAllRows, fetchFacet, needsExactRows, resolveDateRange, weekStart, withPicks,
  type FacetDim, type FacetRow, type InsightPicks, type PickerConstraints, type PickerFilterState,
} from "./transactionPickerQuery";

/**
 * Charts above a transaction list, on demand. The left side ranks where the money came from or went (categories, groups,
 * accounts, payees); the right side is a timeline by week, month or year. They are totals of the same filter the list uses, read
 * as aggregates so they stay fast on a large budget and add up to the list (or, when a tag, a search with % or _ or an
 * Advanced condition needs an exact test, from the same rows the list shows). Selecting a row or a bar narrows the list and
 * the other chart (Ctrl or Cmd to select several); a chart keeps its own rows visible so another can be chosen.
 *
 * Averages use complete calendar months of the period, empty months included, and leave out the current month, which is
 * still running. That month is drawn hatched and marked partial.
 */
export type InsightsOptions = {
  /** Income reads as received, spending as spent (shown positive); anything else shows signed totals. */
  kind: "income" | "spending" | "mixed";
  /** Views of the left chart to leave out, for example the category view when one category is already fixed. */
  hide?: ("categories" | "groups" | "accounts" | "payees")[];
  /** The left chart's first view, for lists where categories say nothing (all uncategorized). */
  initialView?: "categories" | "groups" | "accounts" | "payees";
  /** What the total is called ("put into investments"); otherwise received, spent or net. */
  noun?: string;
  /** The colour of amounts in the list's own direction and of the opposite ones (refunds, negatives). Neutral by default. */
  colours?: { accent: string; negative: string };
};

type Reference = {
  names: { account: (id: string) => string; category: (id: string) => string; payee: (id: string) => string };
  groupOf: (categoryId: string) => string;
};
type LeftView = "categories" | "groups" | "accounts" | "payees";
const LEFT_LABEL: Record<LeftView, string> = { categories: "Categories", groups: "Groups", accounts: "Accounts", payees: "Payees" };
const DIM: Record<LeftView, FacetDim> = { categories: "category", groups: "category", accounts: "account", payees: "payee" };
const INITIAL_ROWS = 8;
const SETTLE_MS = 250;
const BAR_AREA_REM = 7;
const whole = (minor: number) => Math.round(minor / 100).toLocaleString();
const exact = (minor: number) => (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthText = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" });
/** `2026-07-27` as `27 Jul`. */
const dayText = (day: string) => `${Number(day.slice(8, 10))} ${monthText(day.slice(0, 7))}`;
const monthLong = (month: string) => `${monthText(month)} ${month.slice(0, 4)}`;
const nextMonth = (month: string) => { const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = nextMonth(m)) out.push(m);
  return out;
}

/** Changes a list of ids by one click: plain click selects only that one (or clears it), Ctrl/Cmd adds or removes it. */
function toggled(current: readonly string[], id: string, multi: boolean): string[] {
  const has = current.includes(id);
  if (multi) return has ? current.filter((x) => x !== id) : [...current, id];
  return has && current.length === 1 ? [] : [id];
}

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return settled;
}

/** The facet for one dimension: an aggregate query, or the exact rows when the filter needs a test the query cannot make. */
function useFacet(dim: FacetDim, state: PickerFilterState, constraints: PickerConstraints, picks: InsightPicks, today: string, active = true) {
  const connection = useConnectionStore(selectActiveInstance);
  const wanted = useMemo(() => ({ state, constraints, picks }), [state, constraints, picks]);
  const settled = useSettled(wanted, SETTLE_MS);
  const exactMode = needsExactRows(settled.state);
  const aggregate = useQuery({
    queryKey: ["pickerInsights", connection?.id, dim, JSON.stringify([settled, today])],
    enabled: active && !!connection && !exactMode, gcTime: 60_000, placeholderData: keepPreviousData,
    queryFn: () => fetchFacet(connection!, settled.state, withPicks(settled.constraints, settled.picks, dim), today, dim),
  });
  // The rows do not depend on the chart selections, so selecting never reads them again.
  const rows = useQuery({
    queryKey: ["pickerInsightsRows", connection?.id, JSON.stringify([settled.state, settled.constraints, today])],
    enabled: active && !!connection && exactMode, gcTime: 60_000, placeholderData: keepPreviousData,
    queryFn: () => fetchAllRows(connection!, settled.state, settled.constraints, today),
  });
  const fromRows = useMemo(() => (rows.data && !rows.data.truncated ? facetFromRows(rows.data.rows, settled.picks, dim) : undefined), [rows.data, settled.picks, dim]);
  if (!active) return { data: undefined, isPending: false, isError: false, tooMany: false };
  return exactMode
    ? { data: fromRows, isPending: rows.isPending, isError: rows.isError, tooMany: !!rows.data?.truncated }
    : { data: aggregate.data, isPending: aggregate.isPending, isError: aggregate.isError, tooMany: false };
}

/** What is selected in the charts, as removable chips (the result bar above the list shows them). */
export function pickChips(picks: InsightPicks, onPicks: (next: InsightPicks) => void, names: Reference["names"]): { key: string; label: string; remove: () => void }[] {
  return [
    ...picks.categories.map((id) => ({ key: `c${id}`, label: `Category: ${names.category(id)}`, remove: () => onPicks({ ...picks, categories: picks.categories.filter((x) => x !== id) }) })),
    ...(picks.uncategorized ? [{ key: "uncat", label: "Uncategorized", remove: () => onPicks({ ...picks, uncategorized: false }) }] : []),
    ...picks.accounts.map((id) => ({ key: `a${id}`, label: `Account: ${names.account(id)}`, remove: () => onPicks({ ...picks, accounts: picks.accounts.filter((x) => x !== id) }) })),
    ...picks.payees.map((id) => ({ key: `p${id}`, label: `Payee: ${names.payee(id)}`, remove: () => onPicks({ ...picks, payees: picks.payees.filter((x) => x !== id) }) })),
    ...(picks.noPayee ? [{ key: "nopayee", label: "No payee", remove: () => onPicks({ ...picks, noPayee: false }) }] : []),
    ...picks.months.map((m) => ({ key: `m${m}`, label: monthLong(m), remove: () => onPicks({ ...picks, months: picks.months.filter((x) => x !== m) }) })),
    ...picks.weeks.map((w) => ({ key: `w${w}`, label: `Week of ${dayText(w)}`, remove: () => onPicks({ ...picks, weeks: picks.weeks.filter((x) => x !== w) }) })),
  ];
}

type Row = { id: string; label: string; amountMinor: number; averageMinor: number; count: number; selected: boolean; pick: (multi: boolean) => void };
type Bar = { id: string; top: string; bottom: string; amountMinor: number; members: string[]; partial: boolean; /** The text of its tooltip and screen reader label. */ name: string };
type Range = "week" | "month" | "year";

export function PickerInsights({ options, state, constraints, picks, onPicks, reference, today, onHide }: {
  options: InsightsOptions;
  state: PickerFilterState;
  constraints: PickerConstraints;
  picks: InsightPicks;
  onPicks: (next: InsightPicks) => void;
  reference: Reference;
  today: string;
  /** Hides the charts (the panel shows them again from its result bar). */
  onHide?: () => void;
}) {
  const views = (Object.keys(LEFT_LABEL) as LeftView[]).filter((v) => !options.hide?.includes(v) && (v !== "groups" || options.kind === "spending"));
  const [view, setView] = useState<LeftView>(options.initialView && views.includes(options.initialView) ? options.initialView : views[0] ?? "categories");
  // A list that covers a single month opens on weeks, because a one-bar monthly chart says nothing; the user can still change it.
  const wantedRange = resolveDateRange(state.date, today);
  const singleMonth = !!wantedRange.from && wantedRange.from.slice(0, 7) === (wantedRange.to ?? today).slice(0, 7);
  const [chosen, setRange] = useState<Range | null>(null);
  const range: Range = chosen ?? (singleMonth ? "week" : "month");
  const [showAll, setShowAll] = useState(false);
  const left = useFacet(DIM[view], state, constraints, picks, today);
  const timeline = useFacet("month", state, constraints, picks, today);
  const daily = useFacet("day", state, constraints, picks, today, range === "week");
  const shown = (minor: number) => (options.kind === "spending" ? 0 - minor : minor);
  const current = today.slice(0, 7);

  // ── The calendar of the period: every month, empty ones included ──
  const byMonth = useMemo(() => new Map((timeline.data ?? []).filter((r): r is FacetRow & { key: string } => r.key !== null).map((r) => [r.key, r])), [timeline.data]);
  const calendar = useMemo(() => {
    const dated = [...byMonth.keys()].sort();
    if (dated.length === 0) return [];
    const wanted = resolveDateRange(state.date, today);
    const start = wanted.from ? wanted.from.slice(0, 7) : dated[0];
    const end = wanted.to && wanted.to < today ? wanted.to.slice(0, 7) : current;
    return monthsBetween(start, end < dated.at(-1)! ? dated.at(-1)! : end);
  }, [byMonth, state.date, today, current]);
  /** The months that count towards an average: complete ones, and only the selected ones when months are selected. */
  const averaged = useMemo(() => calendar.filter((m) => m !== current && (picks.months.length === 0 || picks.months.includes(m))), [calendar, current, picks.months]);
  const monthsUsed = averaged.length;

  const bars = useMemo((): Bar[] => {
    if (range === "week") {
      const byDay = new Map((daily.data ?? []).filter((r): r is FacetRow & { key: string } => r.key !== null).map((r) => [r.key, r.amountMinor]));
      const days = [...byDay.keys()].sort();
      if (days.length === 0) return [];
      const from = wantedRange.from ?? days[0];
      const to = wantedRange.to && wantedRange.to < today ? wantedRange.to : today;
      const sums = new Map<string, number>();
      for (const [day, amount] of byDay) sums.set(weekStart(day), (sums.get(weekStart(day)) ?? 0) + amount);
      const out: Bar[] = [];
      for (let w = weekStart(from < days[0] ? from : days[0]); w <= to && out.length < 400; w = addDays(w, 7)) {
        // A week cut by either end of the list, or still running, is partial: it is hatched and left out of the average.
        const partial = w < from || addDays(w, 6) > to || addDays(w, 6) >= today;
        out.push({ id: w, top: dayText(w), bottom: partial ? "partial" : "week", amountMinor: sums.get(w) ?? 0, members: [w], partial, name: `Week of ${dayText(w)} ${w.slice(0, 4)}` });
      }
      return out;
    }
    if (range === "month") return calendar.map((m) => ({ id: m, top: monthText(m), bottom: m.slice(0, 4), amountMinor: byMonth.get(m)?.amountMinor ?? 0, members: [m], partial: m === current, name: monthLong(m) }));
    const years = new Map<string, Bar>();
    for (const m of calendar) {
      const y = m.slice(0, 4);
      const bar = years.get(y) ?? { id: y, top: y, bottom: "", amountMinor: 0, members: [], partial: false, name: y };
      bar.amountMinor += byMonth.get(m)?.amountMinor ?? 0; bar.members.push(m); bar.partial = bar.partial || m === current; years.set(y, bar);
    }
    return [...years.values()];
  }, [calendar, byMonth, daily.data, range, current, today, wantedRange.from, wantedRange.to]);
  const pickedIds = range === "week" ? picks.weeks : picks.months;
  const barSelected = (members: string[]) => members.every((m) => pickedIds.includes(m));
  const pickBar = (members: string[], multi: boolean) => {
    const all = barSelected(members);
    const rest = multi ? pickedIds.filter((m) => !members.includes(m)) : [];
    const next = all && (multi || pickedIds.length === members.length) ? rest : [...rest, ...members];
    // Weeks and months are two ways to pick a period; picking one replaces the other.
    onPicks(range === "week" ? { ...picks, weeks: next, months: [] } : { ...picks, months: next, weeks: [] });
  };
  // Averages: each bar's complete part, so the running month or year is left out.
  const averagedBars = bars.filter((b) => !b.partial && (pickedIds.length === 0 || b.members.some((m) => pickedIds.includes(m))));
  const average = averagedBars.length ? averagedBars.reduce((a, b) => a + shown(b.amountMinor), 0) / averagedBars.length : 0;
  const values = bars.map((b) => shown(b.amountMinor));
  // Every bar rises from the bottom by its size, as in any bar chart; a negative amount is the opposite colour and keeps its sign in the label.
  const span = Math.max(1, ...values.map((v) => Math.abs(v)));

  // ── Summary: what the timeline holds for the months in view ──
  const inScope = picks.months.length ? [...byMonth.values()].filter((m) => picks.months.includes(m.key!)) : [...byMonth.values()];
  const total = inScope.reduce((a, m) => a + m.amountMinor, 0);
  const count = inScope.reduce((a, m) => a + m.count, 0);
  const completeTotal = averaged.reduce((a, m) => a + (byMonth.get(m)?.amountMinor ?? 0), 0);
  const perMonth = monthsUsed ? shown(completeTotal) / monthsUsed : null;

  // ── Left chart rows: totals, and the complete months' share for the monthly average ──
  const rows = useMemo((): Row[] => {
    const averagedSet = new Set(averaged);
    const sums = new Map<string | null, { amountMinor: number; complete: number; count: number }>();
    for (const r of left.data ?? []) {
      const s = sums.get(r.key) ?? { amountMinor: 0, complete: 0, count: 0 };
      s.amountMinor += r.amountMinor; s.count += r.count;
      if (r.month && averagedSet.has(r.month)) s.complete += r.amountMinor;
      sums.set(r.key, s);
    }
    const avg = (complete: number) => (monthsUsed ? complete / monthsUsed : 0);
    const data = [...sums].map(([key, s]) => ({ key, ...s }));
    if (view === "categories") {
      return data.map((r) => r.key === null
        ? { id: "none", label: "Uncategorized", amountMinor: r.amountMinor, averageMinor: avg(r.complete), count: r.count, selected: picks.uncategorized, pick: (multi) => onPicks({ ...picks, uncategorized: multi ? !picks.uncategorized : !(picks.uncategorized && picks.categories.length === 0), categories: multi ? picks.categories : [] }) }
        : { id: r.key, label: reference.names.category(r.key), amountMinor: r.amountMinor, averageMinor: avg(r.complete), count: r.count, selected: picks.categories.includes(r.key), pick: (multi) => onPicks({ ...picks, categories: toggled(picks.categories, r.key!, multi), uncategorized: multi ? picks.uncategorized : false }) });
    }
    if (view === "groups") {
      const groups = new Map<string, { amountMinor: number; complete: number; count: number; ids: string[]; uncategorized: boolean }>();
      for (const r of data) {
        const name = r.key === null ? "Uncategorized" : reference.groupOf(r.key);
        const g = groups.get(name) ?? { amountMinor: 0, complete: 0, count: 0, ids: [], uncategorized: false };
        g.amountMinor += r.amountMinor; g.complete += r.complete; g.count += r.count;
        if (r.key === null) g.uncategorized = true; else g.ids.push(r.key);
        groups.set(name, g);
      }
      return [...groups].map(([name, g]) => {
        const selected = (g.ids.length > 0 || g.uncategorized) && g.ids.every((id) => picks.categories.includes(id)) && (!g.uncategorized || picks.uncategorized);
        return {
          id: name, label: name, amountMinor: g.amountMinor, averageMinor: avg(g.complete), count: g.count, selected,
          pick: (multi) => {
            const base = multi ? picks.categories.filter((id) => !g.ids.includes(id)) : [];
            onPicks({ ...picks, categories: selected && (multi || picks.categories.length === g.ids.length) ? base : [...base, ...g.ids], uncategorized: g.uncategorized ? (selected ? false : true) : multi ? picks.uncategorized : false });
          },
        };
      });
    }
    if (view === "accounts") {
      return data.filter((r) => r.key !== null).map((r) => ({ id: r.key!, label: reference.names.account(r.key!), amountMinor: r.amountMinor, averageMinor: avg(r.complete), count: r.count, selected: picks.accounts.includes(r.key!), pick: (multi) => onPicks({ ...picks, accounts: toggled(picks.accounts, r.key!, multi) }) }));
    }
    return data.map((r) => r.key === null
      ? { id: "none", label: "No payee", amountMinor: r.amountMinor, averageMinor: avg(r.complete), count: r.count, selected: picks.noPayee, pick: (multi) => onPicks({ ...picks, noPayee: multi ? !picks.noPayee : !(picks.noPayee && picks.payees.length === 0), payees: multi ? picks.payees : [] }) }
      : { id: r.key, label: reference.names.payee(r.key), amountMinor: r.amountMinor, averageMinor: avg(r.complete), count: r.count, selected: picks.payees.includes(r.key), pick: (multi) => onPicks({ ...picks, payees: toggled(picks.payees, r.key!, multi), noPayee: multi ? picks.noPayee : false }) });
  }, [left.data, view, picks, onPicks, reference, averaged, monthsUsed]);
  const ranked = useMemo(() => [...rows].sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor)), [rows]);
  const sumAbs = ranked.reduce((a, r) => a + Math.abs(r.amountMinor), 0) || 1;
  const anySelected = ranked.some((r) => r.selected);
  const visible = showAll ? ranked : ranked.slice(0, INITIAL_ROWS);

  const failed = left.isError || timeline.isError || daily.isError;
  const tooMany = left.tooMany || timeline.tooMany || daily.tooMany;
  const loading = (left.isPending || timeline.isPending) && !failed && !tooMany;
  const accent = options.colours?.accent ?? "var(--primary)", negativeColour = options.colours?.negative ?? "var(--destructive)";
  const hasPartial = bars.some((b) => b.partial);
  const unit = range;
  const heightOf = (v: number) => (Math.abs(v) / span) * BAR_AREA_REM;

  return (
    <section aria-label="Charts" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground" role="group" aria-label="Averages for the entries in view">
        <span>Per entry <span className="font-semibold tabular-nums text-foreground">{count ? whole(shown(total) / count) : "-"}</span></span>
        <span>Per month <span className="font-semibold tabular-nums text-foreground">{perMonth === null ? "-" : whole(perMonth)}</span> {monthsUsed ? `over ${monthsUsed} complete ${monthsUsed === 1 ? "month" : "months"}` : "(no complete month)"}</span>
        {onHide && <button type="button" className="ml-auto hover:text-foreground" onClick={onHide}>Hide charts</button>}
      </div>

      {failed ? (
        <p role="alert" className="rounded-lg border border-border p-3 text-xs text-muted-foreground">The charts could not be read. The list below is not affected.</p>
      ) : tooMany ? (
        <p role="status" className="rounded-lg border border-border p-3 text-xs text-muted-foreground">These filters (tags, a search with % or _, or advanced conditions) can only be checked exactly on the entries themselves, and more than 20,000 match. Narrow them to see charts. The list below is not affected.</p>
      ) : loading ? (
        <p role="status" className="rounded-lg border border-border p-3 text-xs text-muted-foreground">Reading the charts…</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-xs font-semibold">{options.kind === "income" ? "Where it came from" : options.kind === "spending" ? "Where it went" : "Where it moved"}</h3><p className="text-[11px] text-muted-foreground">Select to filter · Ctrl or Cmd for several</p></div>
              {views.length > 1 && <Segmented label="Chart view" value={view} options={views.map((v) => ({ value: v, label: LEFT_LABEL[v] }))} onChange={(v) => { setView(v); setShowAll(false); }} />}
            </div>
            {ranked.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">Nothing to show for these filters.</p> : (
              <div className="mt-2 max-h-[17rem] overflow-y-auto" role="list" aria-label={LEFT_LABEL[view]}>
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_3rem_3rem] gap-2 px-1 pb-1 text-[11px] text-muted-foreground" aria-hidden>
                  <span>{{ categories: "Category", groups: "Group", accounts: "Account", payees: "Payee" }[view]}</span><span className="text-right">Amount</span><span className="text-right" title={`Complete months only (${monthsUsed})`}>Avg/mo</span><span className="text-right">Txns</span><span className="text-right">%</span>
                </div>
                {visible.map((r) => (
                  <div key={r.id} role="listitem"><button
                    type="button" aria-pressed={r.selected} onClick={(e) => r.pick(e.ctrlKey || e.metaKey)} title={r.label}
                    className={cn("grid w-full grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_3rem_3rem] items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted/60", r.selected && "bg-accent", anySelected && !r.selected && "opacity-50")}
                  >
                    <span className="min-w-0"><span className="block truncate">{r.label}</span><span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full" style={{ width: `${(Math.abs(r.amountMinor) / sumAbs) * 100}%`, background: shown(r.amountMinor) < 0 ? negativeColour : accent }} /></span></span>
                    <span className="text-right tabular-nums">{whole(shown(r.amountMinor))}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{whole(shown(r.averageMinor))}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{r.count.toLocaleString()}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{Math.round((Math.abs(r.amountMinor) / sumAbs) * 100)}%</span>
                  </button></div>
                ))}
                {ranked.length > INITIAL_ROWS && <button type="button" className="mt-1 w-full py-1 text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show ${ranked.length - INITIAL_ROWS} more`}</button>}
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold">{options.kind === "income" ? "When it arrived" : options.kind === "spending" ? "When it happened" : "Over time"}</h3>
                <p className="text-[11px] text-muted-foreground">Dashed line: average of {averagedBars.length} complete {unit}{averagedBars.length === 1 ? "" : "s"} ({averagedBars.length ? whole(average) : "-"}){hasPartial ? ` · hatched: ${range === "week" ? "first, last or running week" : range === "month" ? "this month" : "this year"}, partial` : ""}</p>
              </div>
              <Segmented label="Timeline grouping" value={range} options={[{ value: "week", label: "Weeks" }, { value: "month", label: "Months" }, { value: "year", label: "Years" }]} onChange={setRange} />
            </div>
            {bars.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">{range === "week" && daily.isPending ? "Reading the weeks…" : "Nothing to show for these filters."}</p> : (
              <div className="relative mt-2 overflow-x-auto" role="list" aria-label="Timeline">
                <div className="relative flex gap-1 px-1" style={{ minWidth: `${Math.min(bars.length, 200) * 44}px`, height: `${BAR_AREA_REM + 3.4}rem` }}>
                  {averagedBars.length > 0 && <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/40" style={{ bottom: `calc(2.125rem + ${(Math.abs(average) / span) * BAR_AREA_REM}rem)` }} aria-hidden />}
                  
                  {bars.map((b) => {
                    const selected = barSelected(b.members);
                    const v = shown(b.amountMinor);
                    const label = `${b.name}${b.partial ? " (partial)" : ""}: ${exact(v)}`;
                    const h = heightOf(v);
                    return (
                      <div key={b.id} role="listitem" className="flex h-full min-w-10 flex-1"><button
                        type="button" aria-pressed={selected} onClick={(e) => pickBar(b.members, e.ctrlKey || e.metaKey)} aria-label={label} title={label}
                        className={cn("relative flex h-full w-full flex-col items-center rounded text-[10px] hover:bg-muted/50", pickedIds.length > 0 && !selected && "opacity-50")}
                      >
                        <span className="relative mt-4 block w-full" style={{ height: `${BAR_AREA_REM}rem` }}>
                          {v !== 0 && (
                            <span
                              className="absolute inset-x-0 block rounded-t"
                              style={{ height: `max(${h}rem, 2px)`, bottom: 0, background: v < 0 ? negativeColour : accent, opacity: selected ? 1 : 0.72, backgroundImage: b.partial ? "repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,0.55) 3px 6px)" : undefined }} aria-hidden
                            />
                          )}
                          {v !== 0 && <span className="absolute inset-x-0 block text-center tabular-nums text-muted-foreground" style={{ bottom: `calc(${h}rem + 1px)` }} aria-hidden>{whole(v)}</span>}
                        </span>
                        <span className="mt-1 block h-[1.875rem] leading-tight text-muted-foreground"><span className="block">{b.top}</span><span className="block">{b.partial ? "partial" : b.bottom}</span></span>
                      </button></div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
