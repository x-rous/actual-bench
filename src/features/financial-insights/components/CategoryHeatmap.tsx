"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ArrowUpDown, ChevronRight, EyeOff } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import { CardTitle } from "./InfoTip";

/** Whole amounts keep the table inside the page; the tooltip and the list behind each cell have the exact figure. */
/** A quiet mark beside the name of a hidden category (or a group of them); the text is for assistive technology and the tooltip. */
export function HiddenMark({ title = "Hidden category" }: { title?: string }) {
  return <span className="inline-flex shrink-0 align-middle text-muted-foreground/70" title={title}><EyeOff className="size-3" aria-hidden /><span className="sr-only">{title}</span></span>;
}

export const whole = (minor: number) => Math.round(minor / 100).toLocaleString();

export type HeatMonth = { key: string; label: string; partial: boolean };
/** One row of the grid; `data` is whatever the caller needs to draw its cells. */
export type HeatItem<T> = { key: string; name: string; totalMinor: number; /** Position in the budget, for "Budget order". */ order?: number; hidden?: boolean; data: T };
export type HeatGroupItem<T> = HeatItem<T> & { /** The group's colour. */ colour: string; rows: HeatItem<T>[] };

export type SortKey = "spend" | "name" | "order";
const SORT_DEFAULT: Record<SortKey, boolean> = { spend: true, name: false, order: false };

/**
 * The category group by month grid shared by Spending and My budget: groups that expand into their categories, sorted by spend,
 * name or budget order (reversible), with a sticky first column and header. What a cell shows and how it is shaded belongs to the
 * caller (`renderCell` returns the `<td>`); the grid owns the layout, the sort and the expansion.
 */
export function CategoryHeatmap<T>({ id, title, hint, info, infoLabel, switcher, beforeSort, flat = false, legend, months, groups, renderCell, footer, totalLabel = "Total", sortLabel = "Spend", initialGroups, defaultSort = "spend", firstColumnLabel = "Category group", orderLabel = "Budget order", formatTotal = whole }: {
  id: string;
  title: string;
  hint?: ReactNode;
  info: ReactNode;
  infoLabel: string;
  /** Beside the title, for example the switch between this grid and another view. */
  switcher?: ReactNode;
  /** Controls on the second line, just before Sort by. */
  beforeSort?: ReactNode;
  /** Every row is a single item: no group is opened into rows (income by category). */
  flat?: boolean;
  /** The colour key, placed before the sort controls. */
  legend: ReactNode;
  months: HeatMonth[];
  groups: HeatGroupItem<T>[];
  /** The `<td>` of one cell. `monthIndex` is the position in `months`. */
  renderCell: (item: HeatItem<T>, monthIndex: number, isGroup: boolean) => ReactNode;
  footer?: ReactNode;
  totalLabel?: string;
  /** What the "spend" sort is called. */
  sortLabel?: string;
  /** Show this many groups, with a button for the rest, and let the card grow to its height instead of scrolling. */
  initialGroups?: number;
  /** The sort the grid opens with; "spend" (highest first) unless the caller says otherwise. */
  defaultSort?: SortKey;
  /** The header of the name column, for grids of something other than category groups. */
  firstColumnLabel?: string;
  /** What the "order" sort is called. */
  orderLabel?: string;
  /** How the total column and the sort of it are written; whole units unless the caller needs exact figures. */
  formatTotal?: (minor: number) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: defaultSort, descending: SORT_DEFAULT[defaultSort] });
  const compare = <U extends { name: string; totalMinor: number; order?: number }>(a: U, b: U) => {
    const d = sort.descending ? -1 : 1;
    const byName = a.name.localeCompare(b.name);
    const by = sort.key === "spend" ? a.totalMinor - b.totalMinor : sort.key === "name" ? byName : (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    return by * d || byName;
  };
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const cells = (item: HeatItem<T>, isGroup: boolean) => months.map((m, i) => <Fragment key={m.key}>{renderCell(item, i, isGroup)}</Fragment>);
  return (
    <section id={id} className="min-w-0 scroll-mt-4 rounded-lg border border-border bg-card p-4" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle title={title} hint={hint} info={info} infoLabel={infoLabel} />
        {switcher}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Legend">
        {legend}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {beforeSort}
          <span>Sort by</span>
          <PillGroup options={[{ value: "spend", label: sortLabel }, { value: "name", label: "Name" }, { value: "order", label: orderLabel }]} value={sort.key} onChange={(v) => setSort({ key: v as SortKey, descending: SORT_DEFAULT[v as SortKey] })} />
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 hover:bg-muted" onClick={() => setSort((x) => ({ ...x, descending: !x.descending }))} aria-label={`Sorted ${sort.key === "spend" ? (sort.descending ? "highest spend first" : "lowest spend first") : sort.key === "name" ? (sort.descending ? "Z to A" : "A to Z") : (sort.descending ? "last to first" : "first to last")}. Reverse the order`}>
            <ArrowUpDown className="size-3" aria-hidden />{sort.key === "spend" ? (sort.descending ? "Highest first" : "Lowest first") : sort.key === "name" ? (sort.descending ? "Z → A" : "A → Z") : (sort.descending ? "Last first" : orderLabel)}
          </button>
        </span>
      </div>
      <div className={initialGroups ? "mt-1 overflow-x-auto" : "mt-1 max-h-[34rem] overflow-auto"}>
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th scope="col" className="sticky left-0 z-20 min-w-64 bg-card px-2 py-1 text-left font-medium text-muted-foreground">{firstColumnLabel}</th>
              {months.map((m) => <th key={m.key} scope="col" className="whitespace-nowrap px-1 py-1 text-right font-medium text-muted-foreground">{m.label}{m.partial ? "*" : ""}</th>)}
              <th scope="col" className="px-2 py-1 text-right font-medium text-muted-foreground">{totalLabel}</th>
            </tr>
          </thead>
          <tbody>
            {[...groups].sort(compare).slice(0, initialGroups && !showAll ? initialGroups : undefined).flatMap((g) => {
              const isOpen = open.has(g.key);
              return [
                <tr key={g.key} className="border-t border-border/40">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-0.5 text-left font-normal">
                    {flat ? (
                      <span className="flex items-center gap-1.5 px-1 py-0.5">
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: g.colour }} aria-hidden />
                        <span className="max-w-72 break-words" title={g.name}>{g.name}</span>{g.hidden && <HiddenMark title="Hidden category" />}
                      </span>
                    ) : (
                      <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${g.name}`} className="-ml-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/60" onClick={() => toggle(g.key)}>
                        <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: g.colour }} aria-hidden />
                        <span className="max-w-72 break-words" title={g.name}>{g.name}</span>{g.hidden && <HiddenMark title="Hidden group" />}
                      </button>
                    )}
                  </th>
                  {cells(g, true)}
                  <td className="px-2 py-0.5 text-right tabular-nums">{formatTotal(g.totalMinor)}</td>
                </tr>,
                ...(isOpen && !flat ? [...g.rows].sort(compare).map((r) => (
                  <tr key={`${g.key}/${r.key}`} className="border-t border-border/20">
                    <th scope="row" className="sticky left-0 z-10 bg-card py-0.5 pl-8 pr-2 text-left font-normal text-muted-foreground"><span className="flex max-w-64 items-center gap-1.5" title={r.name}><span className="break-words">{r.name}</span>{r.hidden && <HiddenMark />}</span></th>
                    {cells(r, false)}
                    <td className="px-2 py-0.5 text-right tabular-nums">{formatTotal(r.totalMinor)}</td>
                  </tr>
                )) : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      {initialGroups && groups.length > initialGroups && <button type="button" className="mt-1 w-full border-t border-border/50 pt-1.5 text-center text-xs text-muted-foreground underline" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer groups" : `Show all ${groups.length} groups`}</button>}
      {footer && <p className="mt-2 text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}
