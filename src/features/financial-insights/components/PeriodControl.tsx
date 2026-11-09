"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MonthRangePicker } from "@/components/ui/monthrangepicker";
import { cn } from "@/lib/utils";
import { PERIOD_PRESETS, type PeriodChoice, type ResolvedPeriod } from "@/lib/financial-insights/period";
import { formatDay } from "../format";

const toDate = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
const toMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/** One period for every tab: a preset, or a custom range of whole months. */
export function PeriodControl({ choice, period, today, firstMonth, onChange, hideDates = false }: {
  choice: PeriodChoice;
  period: ResolvedPeriod;
  today: string;
  firstMonth: string | null;
  onChange: (choice: PeriodChoice) => void;
  /** Show only the period's name, not its dates (the Progress tab with Show dates off). */
  hideDates?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // A custom period is named by its dates, so with dates hidden it is only "Custom range".
  const name = hideDates ? (choice.kind === "custom" ? "Custom range" : period.label) : period.label;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 min-w-56 items-center justify-between gap-2 rounded-md border border-input bg-background px-2 text-left text-xs"
            aria-label={hideDates ? `Period: ${name}. Change the period` : `Period: ${period.label}, ${formatDay(period.startDate)} to ${formatDay(period.endDate)}. Change the period`}
          >
            <span className="truncate"><span className="font-medium">{name}</span>{!hideDates && <span className="ml-2 tabular-nums text-muted-foreground">{formatDay(period.startDate)} – {formatDay(period.endDate)}</span>}</span>
            <CalendarRange className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex items-stretch">
          <div className="border-r border-border">
            <p className="px-3 pt-2 text-xs font-medium">Custom range</p>
            <MonthRangePicker
              selectedMonthRange={{ start: toDate(period.startMonth), end: toDate(period.endMonth) }}
              minDate={firstMonth ? toDate(firstMonth) : undefined}
              maxDate={toDate(today.slice(0, 7))}
              showQuickSelectors={false}
              onMonthRangeSelect={({ start, end }) => { onChange({ kind: "custom", startMonth: toMonth(start), endMonth: toMonth(end) }); setOpen(false); }}
            />
          </div>
          <div className="flex w-[22rem] flex-col p-2">
            <p className="px-1 pb-1.5 text-xs font-medium">Ready-made periods</p>
            <div className="grid grid-cols-2 gap-1" role="group" aria-label="Preset periods">
              {PERIOD_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={choice.kind === "preset" && choice.id === preset.id}
                  onClick={() => { onChange({ kind: "preset", id: preset.id }); setOpen(false); }}
                  className={cn("rounded px-2 py-1.5 text-left text-xs hover:bg-muted", choice.kind === "preset" && choice.id === preset.id && "bg-muted font-medium")}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="mt-auto px-1 pt-3 text-xs text-muted-foreground">The last 6 and 12 months and the last 2 years are complete months. This month and This year run to today.</p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
