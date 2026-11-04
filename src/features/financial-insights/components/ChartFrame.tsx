"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, ChevronRight, Download, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";
import { cn } from "@/lib/utils";
import { MISSING, money } from "../format";
import { CardTitle } from "./InfoTip";

export type LegendItem = {
  label: string; colour: string; dashed?: boolean;
  /** A round marker rather than a square swatch. */ dot?: boolean;
  /** A short dashed line with a marker, for a series drawn as a line. */ line?: boolean;
  /** Present when the entry switches its series on and off. */ onToggle?: () => void;
  /** Switched off: the swatch is hollow and the label struck through. */ off?: boolean;
};
export type FrameTable = { head: string[]; rows: (string | number | null)[][] };

/**
 * The card every chart sits in: title and subtitle, a legend that names every colour, a CSV of the exact figures, and an
 * optional detail section (the full reconciliation) that opens under the chart. The figures are also in the page as a table
 * that only assistive technology reads, so the chart has a text alternative without a second view competing with it.
 * The long explanation sits behind an (i) beside the title with a short grey hint next to it, and a quiet "View data" opens
 * the same figures as a table under the chart. Numbers are integer minor units; a missing value is shown as unavailable, never as zero. The card fills the height its grid
 * row gives it, so cards side by side line up.
 */
export function ChartFrame({ id, title, subtitle, hint, legend, table, csvScope, footnote, actions, children, className, detail, tableShown }: {
  id: string;
  title: ReactNode;
  /** The full explanation, shown in the (i) popover. */
  subtitle?: ReactNode;
  /** A few words beside the title, in small grey type. */
  hint?: ReactNode;
  legend?: LegendItem[];
  table: FrameTable;
  csvScope: [string, string][];
  footnote?: ReactNode;
  /** Extra controls beside the CSV button. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** A section that opens under the chart on request, for example the reconciliation table. */
  detail?: { label: string; content: ReactNode };
  /** The figures are already on screen as a table, so the hidden copy for assistive technology is left out. */
  tableShown?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const label = typeof title === "string" ? title : id;
  const exportCsv = () => downloadCsv(`financial-insights-${id}.csv`, [
    ["Financial Insights", label], ...csvScope, [],
    table.head,
    ...table.rows.map((r) => r.map((c) => (c === null ? "unavailable" : typeof c === "number" ? (c / 100).toFixed(2) : c))),
  ]);
  return (
    <section className={cn("flex h-full min-w-0 flex-col rounded-lg border border-border bg-card", className)} aria-label={label}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title={title} hint={hint} info={subtitle} infoLabel={label} />
        <div className="flex items-center gap-2">
          {actions}
          {!tableShown && <Button size="xs" variant="ghost" className="text-muted-foreground" aria-expanded={dataOpen} onClick={() => setDataOpen((v) => !v)}>{dataOpen ? <BarChart3 className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}{dataOpen ? "View chart" : "View data"}</Button>}
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={exportCsv} aria-label={`Export ${label} as CSV`}><Download className="size-3.5" aria-hidden />CSV</Button>
        </div>
      </header>
      {legend && legend.length > 0 && !dataOpen && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-xs text-muted-foreground" aria-label="Legend">
          {legend.map((l) => {
            const swatch = l.line
              ? <svg width="22" height="10" aria-hidden className="shrink-0"><line x1="0" x2="22" y1="5" y2="5" stroke={l.colour} strokeWidth="1.5" strokeDasharray="4 3" /><circle cx="11" cy="5" r="3" fill="var(--card)" stroke={l.colour} strokeWidth="1.5" /></svg>
              : <span className={cn("size-2.5 shrink-0", l.dot ? "rounded-full" : "rounded-sm")} style={{ background: l.dashed || l.off ? "transparent" : l.colour, border: l.dashed || l.off ? `1.5px ${l.dashed ? "dashed" : "solid"} ${l.colour}` : undefined }} aria-hidden />;
            return l.onToggle
              ? <li key={l.label}><button type="button" aria-pressed={!l.off} onClick={l.onToggle} title={l.off ? `Show ${l.label}` : `Hide ${l.label}`} className={cn("flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground", l.off && "line-through opacity-60")}>{swatch}{l.label}</button></li>
              : <li key={l.label} className="flex items-center gap-1.5">{swatch}{l.label}</li>;
          })}
        </ul>
      )}
      {!dataOpen && <div className="min-h-0 flex-1 px-3 pb-2 pt-2">{children}</div>}
      {!tableShown && (dataOpen
        ? <OverlayScrollArea className="mt-2 max-h-[32rem] border-t border-border/60"><div className="px-4 py-2">
          <table className="w-full border-collapse text-xs">
            <caption className={dataOpen ? "pb-1 text-left text-muted-foreground" : undefined}>{label}, exact figures</caption>
            <thead><tr className="border-b border-border text-muted-foreground">{table.head.map((h, i) => <th key={h + i} scope="col" className={cn("py-1 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, ri) => <tr key={ri} className="border-b border-border/40">{r.map((c, ci) => (ci === 0 ? <th key={ci} scope="row" className="py-1 text-left font-normal">{c}</th> : <td key={ci} className="text-right tabular-nums">{c === null ? MISSING : typeof c === "number" ? money(c) : c}</td>))}</tr>)}</tbody>
          </table>
        </div></OverlayScrollArea>
        : <div className="sr-only">
          <table className="w-full border-collapse text-xs">
            <caption className={dataOpen ? "pb-1 text-left text-muted-foreground" : undefined}>{label}, exact figures</caption>
            <thead><tr className="border-b border-border text-muted-foreground">{table.head.map((h, i) => <th key={h + i} scope="col" className={cn("py-1 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, ri) => <tr key={ri} className="border-b border-border/40">{r.map((c, ci) => (ci === 0 ? <th key={ci} scope="row" className="py-1 text-left font-normal">{c}</th> : <td key={ci} className="text-right tabular-nums">{c === null ? MISSING : typeof c === "number" ? money(c) : c}</td>))}</tr>)}</tbody>
          </table>
        </div>)}
      {detail && (
        <div className="border-t border-border/60 px-4 py-2">
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />{detail.label}
          </button>
          {open && <div className="mt-2">{detail.content}</div>}
        </div>
      )}
      {footnote && <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">{footnote}</p>}
    </section>
  );
}
