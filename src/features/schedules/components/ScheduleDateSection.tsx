"use client";

import { useMemo } from "react";
import { useWatch, type Control, type Path, type PathValue } from "react-hook-form";
import { cn } from "@/lib/utils";
import { recurSummary } from "../lib/recurSummary";
import { RecurPatternEditor, type RecurValues } from "./RecurPatternEditor";
import type { ScheduleFormValues } from "../schemas/schedule.schema";

type SetScheduleValue = <K extends Path<ScheduleFormValues>>(
  key: K,
  value: PathValue<ScheduleFormValues, K>
) => void;

type RecurPatternField = keyof RecurValues & Path<ScheduleFormValues>;

type Props = {
  control: Control<ScheduleFormValues>;
  errors: {
    onceDate?: string;
    start?: string;
    endOccurrences?: string;
    endDate?: string;
  };
  setFieldValue: SetScheduleValue;
};

export function ScheduleDateSection({ control, errors, setFieldValue }: Props) {
  const dateMode = useWatch({ control, name: "dateMode" });
  const frequency = useWatch({ control, name: "frequency" });
  const interval = useWatch({ control, name: "interval" });
  const start = useWatch({ control, name: "start" });
  const endMode = useWatch({ control, name: "endMode" });
  const endOccurrences = useWatch({ control, name: "endOccurrences" });
  const endDate = useWatch({ control, name: "endDate" });
  const skipWeekend = useWatch({ control, name: "skipWeekend" });
  const weekendSolveMode = useWatch({ control, name: "weekendSolveMode" });
  const patternMode = useWatch({ control, name: "patternMode" });
  const patternDay = useWatch({ control, name: "patternDay" });
  const patternWeekNum = useWatch({ control, name: "patternWeekNum" });
  const patternWeekDay = useWatch({ control, name: "patternWeekDay" });
  const onceDate = useWatch({ control, name: "onceDate" });

  function handleRecurChange<K extends RecurPatternField>(key: K, value: RecurValues[K]) {
    setFieldValue(key, value as PathValue<ScheduleFormValues, K>);
  }

  const preview = useMemo(() => {
    return dateMode === "once"
      ? recurSummary(onceDate)
      : recurSummary({
          frequency,
          interval,
          start,
          endMode,
          endOccurrences,
          endDate,
          skipWeekend,
          weekendSolveMode,
          patterns:
            patternMode === "specific_day"
              ? [{ value: patternDay, type: "day" }]
              : patternMode === "day_of_week"
                ? [{ value: patternWeekNum, type: patternWeekDay }]
                : undefined,
        });
  }, [
    dateMode,
    endDate,
    endMode,
    endOccurrences,
    frequency,
    interval,
    onceDate,
    patternDay,
    patternMode,
    patternWeekDay,
    patternWeekNum,
    skipWeekend,
    start,
    weekendSolveMode,
  ]);

  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Date</p>
        {preview && (
          <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{preview}</span>
        )}
      </div>

      <div className="flex gap-1">
        {(["once", "recurring"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setFieldValue("dateMode", mode)}
            className={cn(
              "flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors",
              dateMode === mode
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
            )}
          >
            {mode === "once" ? "One-time" : "Recurring"}
          </button>
        ))}
      </div>

      {dateMode === "once" ? (
        <div>
          <input
            type="date"
            value={onceDate}
            onChange={(e) => setFieldValue("onceDate", e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50"
          />
          {errors.onceDate && <p className="mt-1 text-xs text-destructive">{errors.onceDate}</p>}
        </div>
      ) : (
        <RecurPatternEditor
          values={{
            frequency,
            interval,
            start,
            endMode,
            endOccurrences: endOccurrences ?? 12,
            endDate: endDate ?? "",
            skipWeekend,
            weekendSolveMode,
            patternMode,
            patternDay,
            patternWeekNum,
            patternWeekDay,
          }}
          onChange={handleRecurChange}
          errors={{
            start: errors.start,
            endOccurrences: errors.endOccurrences,
            endDate: errors.endDate,
          }}
        />
      )}
    </div>
  );
}
