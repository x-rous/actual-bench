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

/** Rows shown before "show more"; the rest are one click away. */
const VISIBLE_ROWS = 13;

const STATUS_LABEL = {
  deficit: "Deficit",
  covered: "Covered by balance",
  available: "Available",
  none: "",
} as const;

/**
 * Ranked drivers, one line each. A thin bar under the line carries the share;
 * the column headings say what the share and the variance are measured against.
 * Scrolling belongs to the parent, so the heading rows stick to its top.
 */
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
  const rows = showAll ? filtered : filtered.slice(0, VISIBLE_ROWS);
  const selected = new Set(selectedIds);
  const noun = model.level === "group" ? "groups" : "categories";
  const shareHeader =
    filter === "favourable" ? v.shareHeaderFavourable : filter === "all" ? v.shareHeaderBoth : v.shareHeaderUnfavourable;
  const columns = envelope
    ? "grid-cols-[minmax(0,1fr)_4.5rem_5rem_5.25rem]"
    : "grid-cols-[minmax(0,1fr)_5.5rem_5.25rem]";

  return (
    <div className="min-w-0">
      <div className="sticky top-0 z-20 -mx-5 bg-background px-5 pb-1 pt-3 lg:[@media(min-height:900px)]:-mr-2 lg:[@media(min-height:900px)]:pr-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Drivers <span className="font-normal text-muted-foreground">· {model.drivers.length} {noun}</span>
          </h3>
          <PillGroup options={filters} value={filter} onChange={onFilter} />
        </div>
        {breadcrumb}
        <div
          className={cn(
            "mt-1.5 grid items-end gap-x-2 border-b border-border pb-1 pl-8 pr-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
            columns
          )}
        >
          <span>{model.level === "group" ? "Group" : "Category"}</span>
          {envelope && <span className="text-right">Balance</span>}
          <span className="text-right">Variance</span>
          <span className="text-right normal-case leading-tight tracking-normal" title="Each share is measured against its own side, never against the net">
            {shareHeader}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No drivers match this filter.</p>
      ) : (
        <ul>
          {rows.map((driver) => {
            const isSelected = selected.has(driver.id);
            // A variance that rounds to nothing reads as on plan, not as "0" with a share.
            const flat = driver.variance === 0 || format.isZero(driver.variance);
            const tone = flat ? "" : driver.variance > 0 ? UNFAVOURABLE_TEXT : FAVOURABLE_TEXT;
            const share = driver.share;
            const closing = driver.aggregate.envelope?.closing ?? 0;
            const word = flat ? "on plan" : driver.variance > 0 ? v.unfavourableLower : v.favourableLower;
            const shareWord = driver.variance > 0 ? v.shareUnfavourable : v.shareFavourable;
            const status = STATUS_LABEL[driver.status];
            const tip = [
              driver.name,
              status && status,
              driver.unbudgeted ? "Unbudgeted, so no percentage of budget" : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={driver.id}
                className={cn(
                  "relative rounded-md",
                  isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/60"
                )}
              >
                {onDrill && driver.kind === "group" && (
                  <button
                    type="button"
                    aria-label={`Drill into ${driver.name} categories`}
                    title="Drill into categories"
                    onClick={() => onDrill(driver)}
                    className="absolute left-1 top-0.5 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {/* One button spans the row so the whole line is the click target. */}
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${driver.name}, ${format.money(driver.variance)} ${word}${share == null || flat ? "" : `, ${Math.round(share * 100)}% ${shareWord}`}${status ? `, ${status}` : ""}`}
                  title={tip}
                  onClick={(e) => onSelect([driver.id], e.ctrlKey || e.metaKey)}
                  className={cn(
                    "grid w-full min-w-0 items-center gap-x-2 rounded py-1 pb-2 pl-8 pr-2 text-left text-[12.5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    columns
                  )}
                >
                  <span className="truncate font-medium">
                    {driver.name}
                    {driver.hidden && envelope && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">hidden</span>}
                  </span>
                  {envelope && (
                    <span className={cn("text-right tabular-nums", closing < 0 ? UNFAVOURABLE_TEXT : driver.status === "available" ? FAVOURABLE_TEXT : "text-muted-foreground")}>
                      {closing < 0 ? "−" : ""}{format.money(closing)}
                    </span>
                  )}
                  <span className={cn("text-right font-semibold tabular-nums", tone)}>
                    {flat ? "On plan" : format.money(driver.variance)}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {flat ? "" : share == null ? "–" : `${Math.round(share * 100)}%`}
                  </span>
                </button>
                <span className="pointer-events-none absolute inset-x-8 bottom-0.5 h-[3px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span
                    className={cn("block h-full rounded-full", driver.variance > 0 ? "bg-destructive" : "bg-emerald-500")}
                    style={{ width: `${Math.round((share ?? 0) * 100)}%` }}
                  />
                </span>
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
