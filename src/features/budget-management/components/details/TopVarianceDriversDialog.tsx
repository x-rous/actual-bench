"use client";

import { useMemo, useState } from "react";
import { ChevronRight, ArrowUpDown, ChevronsUpDown, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMinor } from "../../lib/format";
import {
  buildVarianceTree,
  treeHasData,
  type VarianceGroup,
  type VarianceLeaf,
  type VarianceSide,
  type VarianceTree,
} from "../../lib/varianceDrivers";
import type { LoadedMonthState } from "../../types";

export type TopVarianceDriversDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Subtitle reflecting the selection, e.g. "Jan–Jul 2026 · Closed months". */
  scopeLabel: string;
  /** Open month → variance is "so far", not final. */
  provisional?: boolean;
  /** Which tab to open on. Falls back to the non-empty side if this one is empty. */
  initialSide: VarianceSide;
  /** In-scope month states, ordered oldest→newest (drives ranking + sparklines). */
  monthStates: LoadedMonthState[];
};

const TOP_N = 5;
const GRID =
  "grid items-center gap-2 px-5 min-w-[730px] " +
  "grid-cols-[minmax(160px,1fr)_80px_80px_54px_minmax(140px,1.1fr)_86px_58px]";

type Filter = "all" | "over" | "under";
type SortKey = "variance" | "pct" | "name";

function word(side: VarianceSide, favourable: boolean, provisional: boolean): string {
  const soFar = provisional ? " so far" : "";
  if (side === "expense") return favourable ? `under budget${soFar}` : `over budget${soFar}`;
  return favourable ? `above budget${soFar}` : `below budget${soFar}`;
}

/** Direction words per side — expenses read over/under, income reads above/below. */
function sideWords(side: VarianceSide): { fav: string; unfav: string } {
  return side === "expense" ? { fav: "under", unfav: "over" } : { fav: "above", unfav: "below" };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TopVarianceDriversDialog({
  open,
  onClose,
  scopeLabel,
  provisional = false,
  initialSide,
  monthStates,
}: TopVarianceDriversDialogProps) {
  const expenseTree = useMemo(
    () => buildVarianceTree(monthStates, "expense"),
    [monthStates]
  );
  const incomeTree = useMemo(
    () => buildVarianceTree(monthStates, "income"),
    [monthStates]
  );
  const expenseHasData = treeHasData(expenseTree);
  const incomeHasData = treeHasData(incomeTree);

  const resolvedInitial: VarianceSide =
    initialSide === "expense"
      ? expenseHasData || !incomeHasData
        ? "expense"
        : "income"
      : incomeHasData || !expenseHasData
        ? "income"
        : "expense";

  const [side, setSide] = useState<VarianceSide>(resolvedInitial);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("variance");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const tree = side === "expense" ? expenseTree : incomeTree;

  function switchSide(next: VarianceSide) {
    if (next === side) return;
    setSide(next);
    setFilter("all");
    setShowAll(false);
    setExpanded(new Set());
  }

  const view = useMemo(
    () => buildView(tree, { filter, sortKey, showAll, topN: TOP_N }),
    [tree, filter, sortKey, showAll]
  );

  function toggleGroup(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpandAll() {
    setExpanded((prev) =>
      prev.size === view.rows.length && prev.size > 0
        ? new Set()
        : new Set(view.rows.map((g) => g.id))
    );
  }

  const allExpanded = expanded.size > 0 && expanded.size >= view.rows.length;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[86vh] flex-col gap-0 p-0 sm:max-w-5xl">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
          <DialogHeader className="gap-0.5 space-y-0 pr-8 text-left">
            <DialogTitle className="text-[15px]">Variance Drivers</DialogTitle>
            <DialogDescription className="text-xs">{scopeLabel}</DialogDescription>
          </DialogHeader>

          <div className="flex gap-0.5 self-start rounded-lg bg-muted p-0.5" role="group" aria-label="Variance side">
            <Tab active={side === "expense"} disabled={!expenseHasData} onClick={() => switchSide("expense")}>
              Expenses
            </Tab>
            <Tab active={side === "income"} disabled={!incomeHasData} onClick={() => switchSide("income")}>
              Income
            </Tab>
          </div>

          <CompositionHero tree={tree} side={side} provisional={provisional} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Filter">
              {(["all", "over", "under"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f === "all" ? "All" : f === "over" ? cap(sideWords(side).unfav) : cap(sideWords(side).fav)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <ToolButton
                onClick={() => setSortKey((s) => (s === "variance" ? "pct" : s === "pct" ? "name" : "variance"))}
                icon={<ArrowUpDown className="size-3" />}
              >
                {sortKey === "variance" ? "Variance" : sortKey === "pct" ? "% of budget" : "Name"}
              </ToolButton>
              <ToolButton onClick={toggleExpandAll} icon={<ChevronsUpDown className="size-3" />}>
                {allExpanded ? "Collapse all" : "Expand all"}
              </ToolButton>
              <ToolButton
                onClick={() => exportCsv(tree, side)}
                icon={<Download className="size-3" />}
              >
                Export
              </ToolButton>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto border-t border-border">
          <div className={cn(GRID, "sticky top-0 z-10 h-7 bg-muted text-[9px] font-semibold uppercase tracking-wide text-muted-foreground")}>
            <span>{side === "expense" ? "Category group" : "Income group"}</span>
            <span className="text-right">Budgeted</span>
            <span className="text-right">Actual</span>
            <span className="text-center">Trend</span>
            <span className="grid grid-cols-[32px_1fr_32px] items-center">
              <span className="text-center">◄ {sideWords(side).fav}</span>
              <span />
              <span className="text-center">{sideWords(side).unfav} ►</span>
            </span>
            <span className="text-right">Variance</span>
            <span className="text-right">% budget</span>
          </div>

          {view.rows.map((group) => (
            <GroupRowView
              key={group.id}
              group={group}
              monthCount={tree.monthCount}
              globalMax={view.globalMax}
              expanded={expanded.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
            />
          ))}

          {view.other && (
            <div className={cn(GRID, "h-8 border-b border-border/50 bg-muted/30")}>
              <span className="text-[11.5px] font-semibold text-muted-foreground">
                Other · {view.other.count} {view.other.count === 1 ? "group" : "groups"}
              </span>
              <span className="text-right text-[10.5px] tabular-nums text-muted-foreground">{formatMinor(view.other.budgetedMinor)}</span>
              <span className="text-right text-[10.5px] tabular-nums text-muted-foreground">{formatMinor(view.other.actualMinor)}</span>
              <span />
              <DivergingBar variance={view.other.varianceMinor} globalMax={view.globalMax} share={null} />
              <VarianceCell variance={view.other.varianceMinor} />
              <PctCell pct={null} />
            </div>
          )}
        </div>

        {/* Totals + footer */}
        <div className={cn(GRID, "h-8 shrink-0 border-t border-border bg-muted")}>
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
            Total · {tree.groups.length} {tree.groups.length === 1 ? "group" : "groups"}
          </span>
          <span className="text-right text-[11px] font-bold tabular-nums">{formatMinor(tree.totals.budgetedMinor)}</span>
          <span className="text-right text-[11px] font-bold tabular-nums">{formatMinor(tree.totals.actualMinor)}</span>
          <span />
          <span />
          <span
            className={cn(
              "text-right text-[11px] font-bold tabular-nums",
              tree.totals.varianceMinor >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            )}
            aria-label={`${tree.totals.varianceMinor >= 0 ? "favourable" : "unfavourable"} total variance ${formatMinor(Math.abs(tree.totals.varianceMinor))}`}
          >
            {tree.totals.varianceMinor > 0 ? "+" : tree.totals.varianceMinor < 0 ? "−" : ""}
            {formatMinor(Math.abs(tree.totals.varianceMinor))}
          </span>
          <span />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
            <Legend className="bg-destructive">{sideWords(side).unfav}</Legend>
            <Legend className="bg-emerald-500">{sideWords(side).fav}</Legend>
            <span>% = share of that side</span>
          </div>
          {view.other && (
            <button
              type="button"
              className="text-[11.5px] font-semibold text-primary hover:underline"
              onClick={() => setShowAll(true)}
            >
              Show all groups
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function GroupRowView({
  group,
  monthCount,
  globalMax,
  expanded,
  onToggle,
}: {
  group: VarianceGroup;
  monthCount: number;
  globalMax: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(GRID, "h-8 w-full border-b border-border/50 text-left hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none")}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          <span className="truncate text-[12px] font-semibold">{group.name}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[9.5px] leading-4 text-muted-foreground">
            {group.children.length}
          </span>
        </span>
        <span className="text-right text-[11px] tabular-nums text-muted-foreground">{formatMinor(group.budgetedMinor)}</span>
        <span className="text-right text-[11px] tabular-nums text-muted-foreground">{formatMinor(group.actualMinor)}</span>
        <span className="flex justify-center">
          {monthCount >= 2 ? <Sparkline series={group.monthly} favourable={group.favourable} /> : null}
        </span>
        <DivergingBar variance={group.varianceMinor} globalMax={globalMax} share={group.contribution} />
        <VarianceCell variance={group.varianceMinor} />
        <PctCell pct={group.pctOfBudget} />
      </button>

      {expanded &&
        group.children.map((child) => (
          <ChildRowView key={child.id} child={child} globalMax={globalMax} />
        ))}
    </>
  );
}

function ChildRowView({ child, globalMax }: { child: VarianceLeaf; globalMax: number }) {
  return (
    <div className={cn(GRID, "h-7 border-b border-border/40 bg-muted/40")}>
      <span className="truncate pl-[18px] text-[11.5px] text-muted-foreground">{child.name}</span>
      <span className="text-right text-[10.5px] tabular-nums text-muted-foreground">{formatMinor(child.budgetedMinor)}</span>
      <span className="text-right text-[10.5px] tabular-nums text-muted-foreground">{formatMinor(child.actualMinor)}</span>
      <span />
      <DivergingBar variance={child.varianceMinor} globalMax={globalMax} share={child.contribution} dim />
      <VarianceCell variance={child.varianceMinor} />
      <PctCell pct={child.pctOfBudget} />
    </div>
  );
}

// ── Cells ────────────────────────────────────────────────────────────────────

function DivergingBar({
  variance,
  globalMax,
  share,
  dim = false,
}: {
  variance: number;
  globalMax: number;
  share: number | null;
  dim?: boolean;
}) {
  const favourable = variance >= 0;
  // Clamp to the half-width so an aggregate (e.g. Other) or a 0-actual income
  // group can never overflow the axis.
  const width = `${Math.min(50, (Math.abs(variance) / Math.max(1, globalMax)) * 50)}%`;
  const pct = share != null ? `${Math.round(share * 100)}%` : "";
  const fillColor = favourable
    ? dim ? "bg-emerald-500/50" : "bg-emerald-500/80"
    : dim ? "bg-destructive/50" : "bg-destructive/80";

  return (
    <span className="grid grid-cols-[32px_1fr_32px] items-center">
      <span className="pr-1.5 text-right font-mono text-[10px] font-semibold text-muted-foreground">
        {favourable ? pct : ""}
      </span>
      <span className="relative h-2.5">
        <span className="absolute left-1/2 -top-3 -bottom-3 w-px bg-border" />
        <span
          className={cn("absolute top-0 h-full", fillColor, favourable ? "right-1/2 rounded-l-sm" : "left-1/2 rounded-r-sm")}
          style={{ width }}
        />
      </span>
      <span className="pl-1.5 text-left font-mono text-[10px] font-semibold text-muted-foreground">
        {favourable ? "" : pct}
      </span>
    </span>
  );
}

function VarianceCell({ variance }: { variance: number }) {
  const favourable = variance >= 0;
  // Direction is also carried by a +/− glyph (and the diverging bar) so it isn't
  // colour-only.
  const sign = variance > 0 ? "+" : variance < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "text-right text-[11.5px] font-medium tabular-nums",
        favourable ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
      )}
      aria-label={`${favourable ? "favourable" : "unfavourable"} variance ${formatMinor(Math.abs(variance))}`}
    >
      {sign}
      {formatMinor(Math.abs(variance))}
    </span>
  );
}

function PctCell({ pct }: { pct: number | null }) {
  return (
    <span className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">
      {pct != null ? `${(Math.abs(pct) * 100).toFixed(1)}%` : ""}
    </span>
  );
}

function CompositionHero({
  tree,
  side,
  provisional,
}: {
  tree: VarianceTree;
  side: VarianceSide;
  provisional: boolean;
}) {
  const { overspendMinor, savedMinor, varianceMinor } = tree.totals;
  const favourable = varianceMinor >= 0;
  const heroColor = favourable ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
  const overLabel = side === "expense" ? "Overspend" : "Below budget";
  const underLabel = side === "expense" ? "Saved" : "Above budget";

  return (
    <div className="flex flex-col gap-2">
      {/* Hero net variance */}
      <div className="flex items-baseline gap-2">
        <span className={cn("text-[26px] font-bold leading-none tabular-nums", heroColor)}>
          {formatMinor(Math.abs(varianceMinor))}
        </span>
        <span className={cn("text-sm font-medium", heroColor)}>{word(side, favourable, provisional)}</span>
      </div>

      {(overspendMinor > 0 || savedMinor > 0) && (
        <>
          {/* Proportional bar — amounts live in the legend below to avoid clipping. */}
          <div
            className="flex h-2 gap-px overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${overLabel} ${formatMinor(overspendMinor)} versus ${underLabel} ${formatMinor(savedMinor)}`}
          >
            {overspendMinor > 0 && <div className="bg-destructive" style={{ flex: `${overspendMinor} 1 0` }} />}
            {savedMinor > 0 && <div className="bg-emerald-500" style={{ flex: `${savedMinor} 1 0` }} />}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
            {overspendMinor > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-[2px] bg-destructive" />
                {overLabel}{" "}
                <b className="font-mono font-semibold text-foreground tabular-nums">{formatMinor(overspendMinor)}</b>
              </span>
            )}
            {savedMinor > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-[2px] bg-emerald-500" />
                {underLabel}{" "}
                <b className="font-mono font-semibold text-foreground tabular-nums">{formatMinor(savedMinor)}</b>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Sparkline({ series, favourable }: { series: number[]; favourable: boolean }) {
  const w = 46;
  const h = 18;
  const mid = h / 2;
  const maxAbs = Math.max(1, ...series.map((v) => Math.abs(v)));
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const points = series
    .map((v, i) => `${(i * step).toFixed(1)},${(mid - (v / maxAbs) * (mid - 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden="true">
      <line x1="0" y1={mid} x2={w} y2={mid} stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" className="text-border" />
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={favourable ? "stroke-emerald-500" : "stroke-destructive"}
      />
    </svg>
  );
}

// ── Small controls ───────────────────────────────────────────────────────────

function Tab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-[11.5px] font-semibold transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}

function ToolButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
    >
      {icon}
      {children}
    </button>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-[2px]", className)} />
      {children}
    </span>
  );
}

// ── View model (filter / sort / top-N + Other) ───────────────────────────────

type ViewOther = { count: number; budgetedMinor: number; actualMinor: number; varianceMinor: number };

function buildView(
  tree: VarianceTree,
  opts: { filter: Filter; sortKey: SortKey; showAll: boolean; topN: number }
): { rows: VarianceGroup[]; other: ViewOther | null; globalMax: number } {
  let groups = tree.groups;
  if (opts.filter === "over") groups = groups.filter((g) => !g.favourable && g.varianceMinor !== 0);
  if (opts.filter === "under") groups = groups.filter((g) => g.favourable && g.varianceMinor !== 0);

  const sorted = [...groups].sort((a, b) => {
    if (opts.sortKey === "name") return a.name.localeCompare(b.name);
    if (opts.sortKey === "pct")
      return Math.abs(b.pctOfBudget ?? 0) - Math.abs(a.pctOfBudget ?? 0);
    return Math.abs(b.varianceMinor) - Math.abs(a.varianceMinor);
  });

  // Other bucket only in the default, unfiltered view.
  const bucketize = !opts.showAll && opts.filter === "all" && sorted.length > opts.topN;
  const rows = bucketize ? sorted.slice(0, opts.topN) : sorted;
  const rest = bucketize ? sorted.slice(opts.topN) : [];
  const other: ViewOther | null = bucketize
    ? {
        count: rest.length,
        budgetedMinor: rest.reduce((a, g) => a + g.budgetedMinor, 0),
        actualMinor: rest.reduce((a, g) => a + g.actualMinor, 0),
        varianceMinor: rest.reduce((a, g) => a + g.varianceMinor, 0),
      }
    : null;

  // Scale bars to the widest thing actually shown — including the Other
  // aggregate, whose summed magnitude can exceed any single group.
  const globalMax = Math.max(
    1,
    ...rows.map((g) => Math.abs(g.varianceMinor)),
    ...(other ? [Math.abs(other.varianceMinor)] : [])
  );

  return { rows, other, globalMax };
}

// ── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(tree: VarianceTree, side: VarianceSide) {
  if (typeof document === "undefined") return;
  const rows = [["Group", "Category", "Budgeted", "Actual", "Variance", "% of budget"]];
  for (const g of tree.groups) {
    rows.push([g.name, "", minor(g.budgetedMinor), minor(g.actualMinor), minor(g.varianceMinor), pct(g.pctOfBudget)]);
    for (const c of g.children) {
      rows.push([g.name, c.name, minor(c.budgetedMinor), minor(c.actualMinor), minor(c.varianceMinor), pct(c.pctOfBudget)]);
    }
  }
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `variance-drivers-${side}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const minor = (v: number) => (v / 100).toFixed(2);
const pct = (v: number | null) => (v == null ? "" : (v * 100).toFixed(1));
const csvCell = (s: string) => {
  // Neutralize spreadsheet formula injection — category/group names are user
  // data, and a leading =, +, -, @, tab, or CR can execute as a formula in
  // Excel/Sheets. Prefix such a cell with an apostrophe, but leave genuine
  // numbers (e.g. "-300.00") untouched so the numeric columns still parse.
  const isNumber = /^-?\d+(\.\d+)?$/.test(s);
  const guarded = !isNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};
