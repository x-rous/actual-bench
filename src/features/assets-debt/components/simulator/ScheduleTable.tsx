"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";
import { cn } from "@/lib/utils";
import { fractionToPercent, formatMinor } from "../../lib/money";
import { aggregateSchedule, principalLabel, rateCell, scheduleColumns, type ColumnId, type ScheduleRow, type ScheduleView } from "../../lib/schedule";

/**
 * The amortization / event schedule (P1.3b T212; FR-224, O2, O5). Columns
 * appear only when the projection holds values for them; figures come
 * straight from engine fields (lib/schedule.ts). Virtualized, with sticky
 * headers and table semantics for assistive technology.
 */

const EVENT_LABELS: Record<string, string> = {
  repayment: "Repayment",
  "final-payment": "Final payment",
  "extra-repayment": "Extra repayment",
  draw: "Draw",
  fee: "Fee",
  "interest-charge": "Interest charged",
  "negative-amortization": "Unpaid interest added",
  "rate-change": "Rate change",
  recast: "Payment recalculated",
  balloon: "Balloon",
  residual: "Residual",
};

const VIEWS: { id: ScheduleView; label: string }[] = [
  { id: "events", label: "All events" },
  { id: "month", label: "Monthly" },
  { id: "year", label: "Yearly" },
];

export function ScheduleTable({ events, profile, currency, digits }: { events: readonly DebtProjectionEvent[]; profile: Pick<CalculationProfile, "chargeFrequency">; currency: string; digits: number }) {
  "use no memo";
  const [view, setView] = useState<ScheduleView>("month");
  const rows = useMemo(() => aggregateSchedule(events, view), [events, view]);
  const columns = useMemo(() => scheduleColumns(rows, view), [rows, view]);
  const principal = principalLabel(profile);
  const money = (m: number) => (m === 0 ? "" : formatMinor(m, digits, currency));
  const heading: Record<ColumnId, string> = {
    period: view === "events" ? "Date" : "Period",
    event: "Event",
    payment: "Payment",
    principal: principal.label,
    interest: "Interest",
    balance: "Balance",
    extra: "Extra repayment",
    fees: "Fees",
    offset: "Offset applied",
    interestBearing: "Interest-bearing balance",
    rate: "Rate",
    draw: "Draw / Redraw",
    unpaidInterest: "Unpaid interest added",
    balloon: "Balloon",
    residual: "Residual",
  };
  const cell = (r: ScheduleRow, c: ColumnId): string => {
    switch (c) {
      case "period":
        return r.period;
      case "event":
        return EVENT_LABELS[r.eventType ?? ""] ?? r.eventType ?? "";
      case "payment":
        return money(r.paymentMinor);
      case "principal":
        return money(r.principalMinor);
      case "interest":
        return money(r.interestMinor);
      case "balance":
        return formatMinor(r.closingBalanceMinor, digits, currency);
      case "extra":
        return money(r.extraRepaymentMinor);
      case "fees":
        return money(r.feesMinor);
      case "offset":
        return r.offsetAppliedMinor === null ? "" : formatMinor(r.offsetAppliedMinor, digits, currency);
      case "interestBearing":
        return r.interestBearingMinor === null ? "" : formatMinor(r.interestBearingMinor, digits, currency);
      case "rate": {
        const shown = rateCell(r.rates);
        return shown === "Multiple" || shown === "" ? shown : `${fractionToPercent(shown)}%`;
      }
      case "draw":
        return money(r.drawMinor);
      case "unpaidInterest":
        return money(r.unpaidInterestMinor);
      case "balloon":
        return money(r.balloonMinor);
      case "residual":
        return money(r.residualMinor);
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual; the compiler skips this component, which is what it needs.
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 30, overscan: 12, initialRect: { width: 1000, height: 480 } });
  const template = `repeat(${columns.length}, minmax(7rem, 1fr))`;

  return (
    <section aria-labelledby="schedule-heading" className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="schedule-heading" className="text-sm font-semibold">
          Schedule
        </h2>
        <div role="radiogroup" aria-label="Schedule view" className="flex gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={view === v.id}
              onClick={() => setView(v.id)}
              className={cn("rounded border border-border px-2 py-1 text-xs", view === v.id ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground")}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {principal.help ? <p className="text-[11px] text-muted-foreground">{principal.help}</p> : null}
      <div role="table" aria-label={`Schedule, ${VIEWS.find((v) => v.id === view)!.label.toLowerCase()}`} aria-rowcount={rows.length + 1} aria-colcount={columns.length} className="rounded-md border border-border">
        <div ref={scrollRef} className="max-h-[480px] overflow-auto">
          <div role="rowgroup" className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <div role="row" aria-rowindex={1} className="grid gap-2 px-3 py-1.5 text-[11px] font-medium" style={{ gridTemplateColumns: template }}>
              {columns.map((c) => (
                <span key={c} role="columnheader" className={c === "period" || c === "event" ? "" : "text-right"} title={c === "principal" ? (principal.help ?? undefined) : undefined}>
                  {heading[c]}
                </span>
              ))}
            </div>
          </div>
          <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = rows[item.index];
              return (
                <div
                  key={r.key}
                  role="row"
                  aria-rowindex={item.index + 2}
                  className="absolute inset-x-0 grid items-center gap-2 border-b border-border/40 px-3 text-xs tabular-nums"
                  style={{ gridTemplateColumns: template, height: 30, transform: `translateY(${item.start}px)` }}
                >
                  {columns.map((c) => (
                    <span key={c} role="cell" className={c === "period" || c === "event" ? "truncate" : "truncate text-right"} title={c === "rate" && r.rates.length > 1 ? `Rates: ${r.rates.map((x) => `${fractionToPercent(x)}%`).join(" then ")}` : undefined}>
                      {cell(r, c)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
