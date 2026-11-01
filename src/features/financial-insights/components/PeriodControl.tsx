"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MonthRangePicker } from "@/components/ui/monthrangepicker";
import { cn } from "@/lib/utils";
import { PERIOD_PRESETS, type PeriodChoice, type ResolvedPeriod } from "@/lib/financial-insights/period";

const toDate = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
const toMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/** One period for every tab: a preset, or a custom range of whole months. */
export function PeriodControl({ choice, period, today, firstMonth, onChange }: {
  choice: PeriodChoice;
  period: ResolvedPeriod;
  today: string;
  firstMonth: string | null;
  onChange: (choice: PeriodChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 min-w-56 items-center justify-between gap-2 rounded-md border border-input bg-background px-2 text-left text-xs"
            aria-label={`Period: ${period.label}, ${period.startDate} to ${period.endDate}. Change the period`}
          >
            <span className="truncate"><span className="font-medium">{period.label}</span><span className="ml-2 tabular-nums text-muted-foreground">{period.startDate} – {period.endDate}</span></span>
            <CalendarRange className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <div className="grid grid-cols-2 gap-1 border-b border-border p-2" role="group" aria-label="Preset periods">
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
        <p className="px-3 pt-2 text-xs font-medium">Custom range</p>
        <MonthRangePicker
          selectedMonthRange={{ start: toDate(period.startMonth), end: toDate(period.endMonth) }}
          minDate={firstMonth ? toDate(firstMonth) : undefined}
          maxDate={toDate(today.slice(0, 7))}
          showQuickSelectors={false}
          onMonthRangeSelect={({ start, end }) => { onChange({ kind: "custom", startMonth: toMonth(start), endMonth: toMonth(end) }); setOpen(false); }}
        />
        <p className="px-3 pb-2 text-xs text-muted-foreground">Last 6 and 12 months are complete months. This month and This year run to today.</p>
      </PopoverContent>
    </Popover>
  );
}
