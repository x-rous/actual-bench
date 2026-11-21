"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PillGroup } from "@/components/ui/pill-group";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { describeCronExpression, isValidCronExpression } from "@/lib/automation/cron";
import { MIN_INTERVAL_MINUTES, nextCronRun } from "@/lib/automation/schedule";
import { readCronFields } from "@/lib/automation/cronFields";
import { formatDateTime, relativeTime } from "../lib/presentation";
import { timezoneOptions } from "../lib/timezones";

/**
 * Choosing when something runs (RD-079 / RD-077).
 *
 * One picker for every scheduled thing in Bench, because "when does this run"
 * is the same question whether it is a bank sync, a backup or a budget sync,
 * and two dialogs answering it differently is how a product ends up with two
 * vocabularies for one idea.
 *
 * Two ways in, over one value:
 *
 *   * **Simple** - repeating every so many minutes or hours, daily, on chosen
 *     weekdays, or monthly, each with its own plain fields. Nobody should have
 *     to write `0 6 * * 1-5` to say "weekdays at six".
 *   * **Cron** - the five-field expression, for what the simple modes cannot
 *     say ("every 15 minutes on weekday mornings"), with presets to start from
 *     and each field read back on its own, so a typo shows where it is.
 *
 * Switching carries the schedule across where it can: a simple schedule
 * becomes its cron expression, and a cron expression the simple modes can
 * express opens in them.
 *
 * Whichever way it was entered, the picker says back what it understood and
 * when it will next run. That is the check: `0 0 * * *` reads as a fair guess
 * at "midnight" until the preview says the next run is tomorrow, not tonight.
 */

export type ScheduleValue = {
  scheduleKind: "cron" | "interval";
  cronExpression: string | null;
  intervalMinutes: number | null;
  timezone: string;
};

type Frequency = "interval" | "daily" | "weekly" | "monthly";
type Mode = Frequency | "cron";
type Unit = "minutes" | "hours";

const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];

const CRON_PRESETS = [
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "0 6 * * 1-5", label: "Weekdays at 06:00" },
  { value: "*/30 8-18 * * 1-5", label: "Every 30 minutes, weekday working hours" },
  { value: "0 3 * * 0", label: "Sundays at 03:00" },
  { value: "0 4 1 * *", label: "The 1st of each month at 04:00" },
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `HH:MM` from a cron minute/hour pair, or a default when they are not simple. */
function timeFrom(minute: string, hour: string, fallback = "02:00"): string {
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return fallback;
  return `${pad(Number(hour))}:${pad(Number(minute))}`;
}

/**
 * Work out which simple mode an existing schedule corresponds to.
 *
 * Editing something created as "weekdays at 06:00" must open on that, not on a
 * cron box containing `0 6 * * 1-5` — otherwise every edit teaches the user
 * that the simple modes are a one-way door.
 */
export function modeForSchedule(value: ScheduleValue): Mode {
  if (value.scheduleKind === "interval") return "interval";
  const parts = (value.cronExpression ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return "cron";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const simpleTime = /^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour);
  if (!simpleTime || month !== "*") return "cron";

  if (dayOfMonth === "*" && dayOfWeek === "*") return "daily";
  if (dayOfMonth === "*" && /^[0-6](,[0-6])*$/.test(dayOfWeek)) return "weekly";
  if (dayOfWeek === "*" && /^\d{1,2}$/.test(dayOfMonth) && Number(dayOfMonth) <= 28) return "monthly";
  return "cron";
}

function readWeekdays(expression: string | null): number[] {
  const dayOfWeek = (expression ?? "").trim().split(/\s+/)[4] ?? "";
  const days = dayOfWeek
    .split(",")
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
  return days.length > 0 ? days : [1];
}

/** The cron expression an interval is, when one exists: every 6 hours is `0 *\/6 * * *`. */
function intervalAsCron(minutes: number): string | null {
  if (minutes < 60 && 60 % minutes === 0) return `*/${minutes} * * * *`;
  if (minutes % 60 === 0 && 24 % (minutes / 60) === 0) return minutes === 60 ? "0 * * * *" : `0 */${minutes / 60} * * *`;
  return null;
}

type Props = {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  /** Snapshot of the clock — reading it during render would be impure. */
  nowMs: number;
  /** Shown when a mode cannot produce a valid schedule. */
  onValidityChange?: (valid: boolean) => void;
  /**
   * Only "every so often": for a job whose engine runs on an interval and
   * nothing else (Cross Budget Sync). Hides the other modes and cron.
   */
  intervalOnly?: boolean;
};

export function SchedulePicker({ value, onChange, nowMs, onValidityChange, intervalOnly = false }: Props) {
  const initialMode = intervalOnly ? "interval" : modeForSchedule(value);
  const [mode, setMode] = useState<Mode>(initialMode);
  // The simple mode last used, so Cron → Simple returns to it.
  const [frequency, setFrequency] = useState<Frequency>(initialMode === "cron" ? "daily" : initialMode);
  const [time, setTime] = useState(() => {
    const parts = (value.cronExpression ?? "").trim().split(/\s+/);
    return parts.length === 5 ? timeFrom(parts[0], parts[1]) : "02:00";
  });
  const [weekdays, setWeekdays] = useState<number[]>(() => readWeekdays(value.cronExpression));
  const [dayOfMonth, setDayOfMonth] = useState(() => {
    const parts = (value.cronExpression ?? "").trim().split(/\s+/);
    return parts.length === 5 && /^\d{1,2}$/.test(parts[2]) ? Math.min(28, Number(parts[2])) : 1;
  });
  const [unit, setUnit] = useState<Unit>(() =>
    value.intervalMinutes && value.intervalMinutes % 60 !== 0 ? "minutes" : "hours"
  );
  const [every, setEvery] = useState(() => {
    const minutes = value.intervalMinutes ?? 360;
    return minutes % 60 === 0 ? minutes / 60 : minutes;
  });
  const [cron, setCron] = useState(() => value.cronExpression ?? "0 2 * * *");
  // Set when Simple → Cron could not carry the schedule across exactly.
  const [conversionNote, setConversionNote] = useState<string | null>(null);

  const timezones = useMemo(() => timezoneOptions(new Date(nowMs)), [nowMs]);

  type State = {
    mode: Mode;
    time: string;
    weekdays: number[];
    dayOfMonth: number;
    every: number;
    unit: Unit;
    cron: string;
    timezone: string;
  };

  function build(state: State): ScheduleValue {
    const [hh, mm] = state.time.split(":");
    const minute = Number(mm);
    const hour = Number(hh);
    const timeIsValid = Number.isInteger(minute) && Number.isInteger(hour) && hour < 24 && minute < 60;

    if (state.mode === "interval") {
      // The unattended floor: below it a run spends its time reopening the
      // budget rather than doing the work.
      const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(state.every * (state.unit === "hours" ? 60 : 1)));
      return { scheduleKind: "interval", cronExpression: null, intervalMinutes: minutes, timezone: state.timezone };
    }

    let cronExpression: string;
    if (state.mode === "cron") cronExpression = state.cron.trim();
    // An incomplete time is not a schedule. Emitting an empty expression
    // fails validation rather than quietly meaning midnight.
    else if (!timeIsValid) cronExpression = "";
    else if (state.mode === "daily") cronExpression = `${minute} ${hour} * * *`;
    else if (state.mode === "weekly") {
      const days = state.weekdays.length > 0 ? [...state.weekdays].sort((a, b) => a - b) : [1];
      cronExpression = `${minute} ${hour} * * ${days.join(",")}`;
    } else cronExpression = `${minute} ${hour} ${state.dayOfMonth} * *`;
    return { scheduleKind: "cron", cronExpression, intervalMinutes: null, timezone: state.timezone };
  }

  function emit(next: Partial<State>) {
    const state: State = { mode, time, weekdays, dayOfMonth, every, unit, cron, timezone: value.timezone, ...next };
    const built = build(state);
    onValidityChange?.(built.scheduleKind === "interval" ? true : isValidCronExpression(built.cronExpression ?? ""));
    onChange(built);
  }

  function chooseFrequency(next: Frequency) {
    setFrequency(next);
    setMode(next);
    emit({ mode: next });
  }

  function switchTo(target: "simple" | "cron") {
    if (target === "cron") {
      if (mode === "cron") return;
      // Carry the schedule across: the cron of what is set now.
      const current = build({ mode, time, weekdays, dayOfMonth, every, unit, cron, timezone: value.timezone });
      const exact = current.scheduleKind === "interval" ? intervalAsCron(current.intervalMinutes ?? 360) : current.cronExpression;
      const expression = exact || cron;
      // Said, not done silently: "every 90 minutes" has no cron form, and the
      // expression left in the box is a different schedule.
      setConversionNote(
        exact ? null : "That interval has no exact cron form, so this is not the same schedule. Check it before saving."
      );
      setCron(expression);
      setMode("cron");
      emit({ mode: "cron", cron: expression });
      return;
    }
    if (mode !== "cron") return;
    setConversionNote(null);
    // A cron expression the simple modes can say opens in them.
    const readable = modeForSchedule({ ...value, scheduleKind: "cron", cronExpression: cron });
    if (readable !== "cron") {
      const parts = cron.trim().split(/\s+/);
      const nextTime = timeFrom(parts[0], parts[1], time);
      const nextWeekdays = readable === "weekly" ? readWeekdays(cron) : weekdays;
      const nextDay = readable === "monthly" ? Number(parts[2]) : dayOfMonth;
      setTime(nextTime);
      setWeekdays(nextWeekdays);
      setDayOfMonth(nextDay);
      setFrequency(readable);
      setMode(readable);
      emit({ mode: readable, time: nextTime, weekdays: nextWeekdays, dayOfMonth: nextDay });
      return;
    }
    setMode(frequency);
    emit({ mode: frequency });
  }

  function toggleWeekday(day: number) {
    const next = weekdays.includes(day) ? weekdays.filter((entry) => entry !== day) : [...weekdays, day];
    // Never leave it with no days: that is a schedule that never comes around.
    const applied = next.length > 0 ? next : weekdays;
    setWeekdays(applied);
    emit({ weekdays: applied });
  }

  const expression = value.scheduleKind === "cron" ? value.cronExpression ?? "" : null;
  const cronValid = expression === null || isValidCronExpression(expression);
  // A cleared time input reads as "" and must not quietly become midnight, so
  // it produces an empty expression — which is a missing *time*, not a broken
  // cron expression, and the message has to say the right one of those.
  const timeMissing = mode !== "cron" && mode !== "interval" && expression === "";
  const cronIsSimple = mode === "cron" && modeForSchedule({ ...value, scheduleKind: "cron", cronExpression: cron }) !== "cron";

  const upcoming = useMemo(() => {
    if (value.scheduleKind === "interval") {
      const minutes = value.intervalMinutes ?? MIN_INTERVAL_MINUTES;
      return [0, 1, 2].map((index) => nowMs + index * minutes * 60_000);
    }
    if (!expression || !cronValid) return [];
    const runs: number[] = [];
    let cursor = nowMs;
    for (let index = 0; index < 3; index += 1) {
      try {
        const next = nextCronRun(expression, value.timezone, cursor);
        if (next === null) break;
        runs.push(next);
        cursor = next;
      } catch {
        break;
      }
    }
    return runs;
  }, [expression, cronValid, value.scheduleKind, value.intervalMinutes, value.timezone, nowMs]);

  const intervalMinutes = value.intervalMinutes ?? MIN_INTERVAL_MINUTES;
  const summary =
    value.scheduleKind === "interval"
      ? intervalMinutes % 60 === 0
        ? `Every ${intervalMinutes / 60} hour${intervalMinutes === 60 ? "" : "s"}`
        : `Every ${intervalMinutes} minutes`
      : cronValid && expression
        ? describeCronExpression(expression)
        : null;
  const fields = mode === "cron" ? readCronFields(cron) : [];

  return (
    <div className="space-y-2">
      {!intervalOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <PillGroup
            value={mode === "cron" ? "cron" : "simple"}
            onChange={switchTo}
            options={[
              { value: "simple", label: "Simple" },
              { value: "cron", label: "Cron" },
            ]}
          />
          {mode !== "cron" && (
            <PillGroup
              value={frequency}
              onChange={chooseFrequency}
              options={[
                { value: "interval", label: "Repeating" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
          )}
        </div>
      )}

      {mode !== "cron" && (
        <div className="flex flex-wrap items-center gap-2">
          {mode === "interval" && (
            <>
              <span className="text-muted-foreground">Every</span>
              <Input
                className="w-16"
                type="number"
                min={1}
                value={every}
                onChange={(event) => {
                  // Not clamped here: the floor belongs at the point the
                  // schedule is built, so a typed 0.1 becomes the 15-minute
                  // minimum rather than being silently rounded up to an hour.
                  const next = Number(event.target.value);
                  const applied = Number.isFinite(next) && next > 0 ? next : 1;
                  setEvery(applied);
                  emit({ every: applied });
                }}
                aria-label={unit === "hours" ? "Hours between runs" : "Minutes between runs"}
              />
              <Select
                className="w-auto"
                value={unit}
                onValueChange={(next) => {
                  setUnit(next as Unit);
                  emit({ unit: next as Unit });
                }}
                aria-label="Unit"
                options={[
                  { value: "minutes", label: "minutes" },
                  { value: "hours", label: "hours" },
                ]}
              />
              <span className="text-muted-foreground">at least {MIN_INTERVAL_MINUTES} minutes apart</span>
            </>
          )}

          {mode === "weekly" && (
            <div className="flex gap-1" role="group" aria-label="Days of the week">
              {WEEKDAYS.map((day) => {
                const selected = weekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={selected}
                    aria-label={day.long}
                    onClick={() => toggleWeekday(day.value)}
                    className={cn(
                      "h-7 w-9 rounded-md border text-xs transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          )}

          {mode === "monthly" && (
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">On day</span>
              <Select
                className="w-auto"
                value={String(dayOfMonth)}
                onValueChange={(next) => {
                  setDayOfMonth(Number(next));
                  emit({ dayOfMonth: Number(next) });
                }}
                aria-label="Day of the month"
                // To the 28th: every month has one, so the schedule never
                // skips a month without saying so.
                options={Array.from({ length: 28 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
              />
            </label>
          )}

          {(mode === "daily" || mode === "weekly" || mode === "monthly") && (
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">at</span>
              <Input
                className="w-28"
                type="time"
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  emit({ time: event.target.value });
                }}
                aria-label="Time of day"
              />
            </label>
          )}
        </div>
      )}

      {mode === "cron" && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-48 font-mono"
              value={cron}
              onChange={(event) => {
                setCron(event.target.value);
                setConversionNote(null);
                emit({ cron: event.target.value });
              }}
              aria-label="Cron expression"
              aria-invalid={!cronValid}
              spellCheck={false}
            />
            <Select
              className="w-auto"
              value=""
              onValueChange={(preset) => {
                if (!preset) return;
                setCron(preset);
                setConversionNote(null);
                emit({ cron: preset });
              }}
              aria-label="Start from a preset"
              options={[{ value: "", label: "Start from a preset…" }, ...CRON_PRESETS]}
            />
          </div>
          {/* Each field read back on its own, so a typo shows where it is. */}
          <dl className="grid grid-cols-5 gap-1" aria-label="What each field means">
            {fields.slice(0, 5).map((field) => (
              <div
                key={field.key}
                className={cn(
                  "min-w-0 rounded border px-1.5 py-1",
                  field.valid ? "border-border" : "border-destructive/50 bg-destructive/5"
                )}
              >
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{field.label}</dt>
                <dd className="truncate font-mono">{field.token || "-"}</dd>
                <dd className={cn("truncate text-[11px]", field.valid ? "text-muted-foreground" : "text-destructive")} title={field.reading}>
                  {field.reading}
                </dd>
              </div>
            ))}
          </dl>
          {conversionNote && <p className="text-amber-700 dark:text-amber-400">{conversionNote}</p>}
          {fields.length > 5 && <p className="text-destructive">Only five fields: {fields[5].token} is one too many.</p>}
          {cronIsSimple && (
            <p className="text-muted-foreground">This is a simple schedule too: switch to Simple to edit it with plain fields.</p>
          )}
        </div>
      )}

      {/* A time zone only changes anything for a clock-based schedule. Asking
          for it beside "every 6 hours" would be a question whose answer cannot
          matter. */}
      {mode !== "interval" && (
        <label className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Time zone</span>
          <Select
            className="w-auto"
            value={value.timezone}
            onValueChange={(timezone) => emit({ timezone })}
            aria-label="Time zone"
            options={timezones.map((zone) => ({ value: zone.value, label: zone.label }))}
          />
        </label>
      )}

      {/* Saying back what was understood, and when it will actually happen. */}
      <div className="space-y-2 rounded-md bg-muted/50 px-2.5 py-2">
        {timeMissing ? (
          <p className="text-destructive">Enter a time of day, such as 06:00.</p>
        ) : !cronValid ? (
          <p className="text-destructive">
            That is not a valid cron expression. Five fields, e.g. <code>0 6 * * 1-5</code> for weekdays at 06:00.
          </p>
        ) : upcoming.length === 0 ? (
          <p className="text-destructive">That schedule never comes around.</p>
        ) : (
          <>
            <div>
              <p className="font-medium">
                {summary}
                {mode !== "interval" && value.timezone ? ` · ${value.timezone}` : ""}
              </p>
              <p className="text-muted-foreground">
                Next:{" "}
                {value.scheduleKind === "interval"
                  ? "this long after the last run; something that has never run starts as soon as it is saved"
                  : `${relativeTime(new Date(upcoming[0]).toISOString(), nowMs)} - ${formatDateTime(new Date(upcoming[0]).toISOString())}${
                      upcoming[1] ? `, then ${formatDateTime(new Date(upcoming[1]).toISOString())}` : ""
                    }`}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
