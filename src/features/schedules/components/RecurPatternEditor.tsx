"use client";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
export type EndMode = "never" | "after_n_occurrences" | "on_date";
export type PatternMode = "none" | "specific_day" | "day_of_week";

export type RecurValues = {
  frequency: Frequency;
  interval: number;
  start: string;
  endMode: EndMode;
  endOccurrences: number;
  endDate: string;
  skipWeekend: boolean;
  weekendSolveMode: "before" | "after";
  patternMode: PatternMode;
  patternDay: number;
  patternWeekNum: number;
  patternWeekDay: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "daily",   label: "Daily"   },
  { value: "weekly",  label: "Weekly"  },
  { value: "monthly", label: "Monthly" },
  { value: "yearly",  label: "Yearly"  },
];

const WEEKDAYS = [
  { value: "MO", label: "Mon" },
  { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" },
  { value: "TH", label: "Thu" },
  { value: "FR", label: "Fri" },
  { value: "SA", label: "Sat" },
  { value: "SU", label: "Sun" },
];

const WEEK_NUMS = [
  { value: 1,  label: "1st"  },
  { value: 2,  label: "2nd"  },
  { value: 3,  label: "3rd"  },
  { value: 4,  label: "4th"  },
  { value: -1, label: "Last" },
];

const DAY_OPTIONS = [
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
  { value: -1, label: "Last" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inputCls(error?: string) {
  return cn(
    "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50",
    error && "border-destructive"
  );
}

function selectCls() {
  return "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50";
}

// ─── RecurPatternEditor ───────────────────────────────────────────────────────

type Props = {
  values: RecurValues;
  onChange: <K extends keyof RecurValues>(key: K, value: RecurValues[K]) => void;
  errors?: Partial<Record<keyof RecurValues, string>>;
};

export function RecurPatternEditor({ values, onChange, errors = {} }: Props) {
  const { frequency, interval, start, endMode, endOccurrences, endDate,
          skipWeekend, weekendSolveMode, patternMode, patternDay,
          patternWeekNum, patternWeekDay } = values;

  return (
    <div className="flex flex-col gap-3">
      {/* Frequency */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Frequency</Label>
        <div className="flex gap-1">
          {FREQUENCY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange("frequency", opt.value)}
              className={cn(
                "flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors",
                frequency === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Interval + Start */}
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Every</Label>
          <input
            type="number"
            min={1}
            value={interval}
            onChange={(e) => onChange("interval", Math.max(1, parseInt(e.target.value) || 1))}
            className={cn(inputCls(errors.interval), "w-16")}
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <Label className="text-xs">Starting</Label>
          <input
            type="date"
            value={start}
            onChange={(e) => onChange("start", e.target.value)}
            className={cn(inputCls(errors.start), "w-full")}
          />
          {errors.start && <p className="text-xs text-destructive">{errors.start}</p>}
        </div>
      </div>

      {/* Monthly patterns */}
      {frequency === "monthly" && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs">Day of month</Label>
          <div className="flex gap-1">
            {(["none", "specific_day", "day_of_week"] as PatternMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange("patternMode", mode)}
                className={cn(
                  "rounded border px-2 py-1 text-xs font-medium transition-colors",
                  patternMode === mode
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                {mode === "none" ? "Same as start" : mode === "specific_day" ? "Specific day" : "Day of week"}
              </button>
            ))}
          </div>

          {patternMode === "specific_day" && (
            <select
              value={patternDay}
              onChange={(e) => onChange("patternDay", parseInt(e.target.value))}
              className={selectCls()}
            >
              {DAY_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          )}

          {patternMode === "day_of_week" && (
            <div className="flex gap-2">
              <select
                value={patternWeekNum}
                onChange={(e) => onChange("patternWeekNum", parseInt(e.target.value))}
                className={cn(selectCls(), "flex-1")}
              >
                {WEEK_NUMS.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
              <select
                value={patternWeekDay}
                onChange={(e) => onChange("patternWeekDay", e.target.value)}
                className={cn(selectCls(), "flex-1")}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Weekend handling */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={skipWeekend}
            onChange={(e) => onChange("skipWeekend", e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Shift weekend dates
        </label>
        {skipWeekend && (
          <div className="ml-5 flex gap-1">
            {(["before", "after"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => onChange("weekendSolveMode", dir)}
                className={cn(
                  "rounded border px-2 py-1 text-xs font-medium transition-colors",
                  weekendSolveMode === dir
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50"
                )}
              >
                {dir === "before" ? "← To Friday" : "To Monday →"}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Weekend shifting is supported; public holidays are not handled.
        </p>
      </div>

      {/* End mode */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Ends</Label>
        <div className="flex gap-1">
          {([
            { value: "never",                label: "Never" },
            { value: "after_n_occurrences",  label: "After N times" },
            { value: "on_date",              label: "On date" },
          ] as { value: EndMode; label: string }[]).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange("endMode", opt.value)}
              className={cn(
                "flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors",
                endMode === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {endMode === "after_n_occurrences" && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={endOccurrences}
              onChange={(e) => onChange("endOccurrences", Math.max(1, parseInt(e.target.value) || 1))}
              className={cn(inputCls(errors.endOccurrences), "w-20")}
            />
            <span className="text-xs text-muted-foreground">occurrences</span>
            {errors.endOccurrences && <p className="text-xs text-destructive">{errors.endOccurrences}</p>}
          </div>
        )}

        {endMode === "on_date" && (
          <div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => onChange("endDate", e.target.value)}
              className={cn(inputCls(errors.endDate), "w-full")}
            />
            {errors.endDate && <p className="text-xs text-destructive">{errors.endDate}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
