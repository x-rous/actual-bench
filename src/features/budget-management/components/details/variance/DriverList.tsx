"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PillGroup } from "@/components/ui/pill-group";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import {
  filterDrivers,
  type Driver,
  type DriverFilter,
  type VarianceModel,
} from "../../../lib/varianceInvestigation";
import { FAVOURABLE_TEXT, UNFAVOURABLE_TEXT } from "./useChartFrame";

const VISIBLE_ROWS = 8;

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  selectedIds: readonly string[];
  filter: DriverFilter;
  onFilter: (filter: DriverFilter) => void;
  onSelect: (ids: string[], additive: boolean) => void;
  /** Open a group's own categories. Absent when the rows are already categories. */
  onDrill?: (driver: Driver) => void;
  /** Where the scope came from, with a way back. */
  breadcrumb?: ReactNode;
};

const STATUS_LABEL = {
  deficit: "Deficit",
  covered: "Covered by balance",
  available: "Available",
  none: "",
} as const;

export function DriverList({ model, format, selectedIds, filter, onFilter, onSelect, onDrill, breadcrumb }: Props) {
  const [showAll, setShowAll] = useState(false);
  const v = model.vocab;
  const envelope = model.mode === "envelope";
  const filters: { value: DriverFilter; label: string }[] = envelope
    ? [
        { value: "all", label: "All" },
        { value: "deficit", label: "Deficit" },
        { value: "unfavourable", label: "Over allocation" },
        { value: "favourable", label: "Unspent" },
      ]
    : [
        { value: "all", label: "All" },
        { value: "unfavourable", label: v.unfavourable },
        { value: "favourable", label: v.favourable },
      ];
  const filtered = filterDrivers(model.drivers, filter);
  const shown = showAll ? filtered : filtered.slice(0, VISIBLE_ROWS);
  const selected = new Set(selectedIds);
  const noun = model.level === "group" ? "group" : "category";

  return (
    <div className="min-w-0">
      <div className="mb-1">
        <h3 className="text-sm font-semibold">Drivers</h3>
        <p className="text-xs text-muted-foreground">How each {noun} contributed to the variance</p>
      </div>
      {breadcrumb}
      <PillGroup options={filters} value={filter} onChange={onFilter} className="my-2 w-fit" />

      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No drivers match this filter.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((driver) => {
            const isSelected = selected.has(driver.id);
            const tone = driver.variance > 0 ? UNFAVOURABLE_TEXT : driver.variance < 0 ? FAVOURABLE_TEXT : "";
            const share = driver.share;
            const status = STATUS_LABEL[driver.status];
            const sub = envelope
              ? status
                ? `${status} · balance ${(driver.aggregate.envelope?.closing ?? 0) < 0 ? "−" : ""}${format.money(driver.aggregate.envelope?.closing ?? 0)}`
                : ""
              : driver.unbudgeted
                ? "Unbudgeted · % of budget –"
                : "";
            return (
              <li key={driver.id} className={cn("flex items-center rounded-md border-b border-border/60 last:border-b-0", isSelected ? "bg-primary/10" : "hover:bg-muted/60")}>
                {onDrill && driver.kind === "group" ? (
                  <button
                    type="button"
                    aria-label={`Drill into ${driver.name} categories`}
                    title="Drill into categories"
                    onClick={() => onDrill(driver)}
                    className="flex h-8 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="w-6 shrink-0" aria-hidden="true" />
                )}
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={(e) => onSelect([driver.id], e.ctrlKey || e.metaKey)}
                  className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-2 py-1.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium sm:truncate">
                      {driver.name}
                      {driver.hidden && envelope && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px align-middle text-[10px] font-semibold text-muted-foreground">Hidden</span>
                      )}
                    </span>
                    {sub && (
                      <span
                        className={cn(
                          "block text-[10.5px]",
                          driver.status === "deficit" ? UNFAVOURABLE_TEXT : driver.status === "available" ? FAVOURABLE_TEXT : "text-muted-foreground"
                        )}
                      >
                        {sub}
                      </span>
                    )}
                  </span>
                  <span className="text-right leading-tight tabular-nums">
                    <span className={cn("block text-[12.5px] font-semibold", tone)}>
                      {driver.variance === 0 ? "On plan" : format.money(driver.variance)}
                    </span>
                    {driver.variance !== 0 && (
                      <span className="block text-[10.5px] text-muted-foreground">
                        {share == null ? "–" : `${Math.round(share * 100)}% ${driver.variance > 0 ? v.shareUnfavourable : v.shareFavourable}`}
                      </span>
                    )}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted max-sm:hidden" aria-hidden="true">
                    <span
                      className={cn("block h-full rounded-full", driver.variance > 0 ? "bg-destructive" : "bg-emerald-500")}
                      style={{ width: `${Math.round((share ?? 0) * 100)}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!showAll && filtered.length > VISIBLE_ROWS && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground">
          + {filtered.length - VISIBLE_ROWS} more
        </button>
      )}
    </div>
  );
}
