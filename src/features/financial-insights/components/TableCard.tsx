"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Download } from "lucide-react";
import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { CardTitle } from "./InfoTip";

/** Header and cell classes of the page's right-aligned figure columns: one line, never wrapped. */
export const TH = "py-1.5 pr-2 text-right font-medium whitespace-nowrap";
export const TD = "py-1.5 pr-2 text-right tabular-nums whitespace-nowrap";

/** A card around a table: title, hint and (i) beside the title, a CSV of the exact figures, and a note under it. */
export function TableCard({ id, title, hint, info, head, rows, csvScope, note, children, collapsible = false }: {
  id: string; title: string; hint?: ReactNode; info: ReactNode; head: string[]; rows: (string | number | null)[][]; csvScope: [string, string][]; note?: ReactNode; children: ReactNode;
  /** The table starts closed, with only the title showing, and opens when the title is selected. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const exportCsv = () => downloadCsv(`financial-insights-${id}.csv`, [["Financial Insights", title], ...csvScope, [], head, ...rows.map((r) => r.map((c) => (c === null ? "unavailable" : typeof c === "number" ? (c / 100).toFixed(2) : c)))]);
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card" aria-label={title}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="flex min-w-0 items-start gap-1">
          {collapsible && (
            <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${title}`} className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground" onClick={() => setOpen((v) => !v)}>
              <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
            </button>
          )}
          <CardTitle title={title} hint={hint} info={info} infoLabel={title} />
        </div>
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={exportCsv} aria-label={`Export ${title} as CSV`}><Download className="size-3.5" aria-hidden />CSV</Button>
      </header>
      {open && <OverlayScrollArea className="flex-1"><div className="px-4 py-2">{children}</div></OverlayScrollArea>}
      {open && note && <div className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">{note}</div>}
      {!open && <div className="pb-3" />}
    </section>
  );
}

/** A titled group of cards. */
export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div><h2 className="text-sm font-semibold">{title}</h2>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
      {children}
    </section>
  );
}
