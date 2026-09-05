"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { describeCronExpression, isValidCronExpression } from "@/lib/automation/cron";
import { MIN_INTERVAL_MINUTES, nextCronRun } from "@/lib/automation/schedule";
import { formatDateTime, relativeTime } from "../lib/presentation";
import { timezoneOptions } from "../lib/timezones";

/**
 * Choosing when something runs (RD-079 / RD-077).
 *
 * One picker for every scheduled thing in Bench, because "when does this run"
 * is the same question whether it is a bank sync or a backup, and two dialogs
 * answering it differently is how a product ends up with two vocabularies for
 * one idea.
 *
 * The shape of the control is the argument: **nobody should have to write
 * `0 6 * * 1-5` to say "weekdays at six"**. Four modes, in the order people
 * think of them —
 *
 *   * every few hours,
 *   * once a day at a time,
 *   * on chosen days of the week,
 *   * on a day of the month,
 *
 * — and only then a raw cron field for the people who genuinely want one. Cron
 * stays because it expresses things the simple modes cannot ("every 15 minutes
 * on weekday mornings"), and removing it would take capability away from the
 * users most able to use it.
 *
 * Whatever mode is chosen, the picker says back **what it understood** in plain
 * language and **when it will actually run**. That second line is the one that
 * catches mistakes: `0 0 * * *` reads as a reasonable guess at "midnight" until
 * the preview says the next run is 14 hours from now rather than tonight.
 */

export type ScheduleValue = {
  scheduleKind: "cron" | "interval";
  cronExpression: string | null;
  intervalMinutes: number | null;
  timezone: string;
};

type Mode = "hours" | "daily" | "weekly" | "monthly" | "cron";

const WEEKDAYS = [
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
  { value: 0, short: "Sun" },
];

const inputClass = "h-8 rounded-md px-2 text-xs md:text-xs";
const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs";

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
  if (value.scheduleKind === "interval") return "hours";
  const parts = (value.cronExpression ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return "cron";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const simpleTime = /^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour);
  if (!simpleTime || month !== "*") return "cron";

  if (dayOfMonth === "*" && dayOfWeek === "*") return "daily";
  if (dayOfMonth === "*" && /^[0-6](,[0-6])*$/.test(dayOfWeek)) return "weekly";
  if (dayOfWeek === "*" && /^\d{1,2}$/.test(dayOfMonth)) return "monthly";
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

type Props = {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  /** Snapshot of the clock — reading it during render would be impure. */
  nowMs: number;
  /** Shown when a mode cannot produce a valid schedule. */
  onValidityChange?: (valid: boolean) => void;
};

export function SchedulePicker({ value, onChange, nowMs, onValidityChange }: Props) {
  const [mode, setMode] = useState<Mode>(() => modeForSchedule(value));
  const [time, setTime] = useState(() => {
    const parts = (value.cronExpression ?? "").trim().split(/\s+/);
    return parts.length === 5 ? timeFrom(parts[0], parts[1]) : "02:00";
  });
  const [weekdays, setWeekdays] = useState<number[]>(() => readWeekdays(value.cronExpression));
  const [dayOfMonth, setDayOfMonth] = useState(() => {
    const parts = (value.cronExpression ?? "").trim().split(/\s+/);
    return parts.length === 5 && /^\d{1,2}$/.test(parts[2]) ? Number(parts[2]) : 1;
  });
  const [hours, setHours] = useState(() =>
    value.intervalMinutes ? Math.max(1, Math.round(value.intervalMinutes / 60)) : 6
  );
  const [cron, setCron] = useState(() => value.cronExpression ?? "0 2 * * *");

  const timezones = useMemo(() => timezoneOptions(new Date(nowMs)), [nowMs]);

  function emit(next: Partial<{ mode: Mode; time: string; weekdays: number[]; dayOfMonth: number; hours: number; cron: string; timezone: string }>) {
    const state = {
      mode: next.mode ?? mode,
      time: next.time ?? time,
      weekdays: next.weekdays ?? weekdays,
      dayOfMonth: next.dayOfMonth ?? dayOfMonth,
      hours: next.hours ?? hours,
      cron: next.cron ?? cron,
      timezone: next.timezone ?? value.timezone,
    };

    const [hh, mm] = state.time.split(":");
    const minute = Number(mm);
    const hour = Number(hh);
    const timeIsValid = Number.isInteger(minute) && Number.isInteger(hour) && hour < 24 && minute < 60;

    let scheduleKind: ScheduleValue["scheduleKind"] = "cron";
    let cronExpression: string | null = null;
    let intervalMinutes: number | null = null;

    if (state.mode === "hours") {
      scheduleKind = "interval";
      // The unattended floor: below it a run spends its time reopening the
      // budget rather than doing the work.
      intervalMinutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(state.hours * 60));
    } else if (state.mode === "cron") {
      cronExpression = state.cron.trim();
    } else if (!timeIsValid) {
      // An incomplete time is not a schedule. Emitting an empty expression
      // fails validation rather than quietly meaning midnight.
      cronExpression = "";
    } else if (state.mode === "daily") {
      cronExpression = `${minute} ${hour} * * *`;
    } else if (state.mode === "weekly") {
      const days = state.weekdays.length > 0 ? [...state.weekdays].sort((a, b) => a - b) : [1];
      cronExpression = `${minute} ${hour} * * ${days.join(",")}`;
    } else {
      cronExpression = `${minute} ${hour} ${state.dayOfMonth} * *`;
    }

    onValidityChange?.(
      scheduleKind === "interval" ? true : isValidCronExpression(cronExpression ?? "")
    );
    onChange({ scheduleKind, cronExpression, intervalMinutes, timezone: state.timezone });
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
  const timeMissing = mode !== "cron" && mode !== "hours" && expression === "";

  const upcoming = useMemo(() => {
    if (value.scheduleKind === "interval") {
      const minutes = value.intervalMinutes ?? MIN_INTERVAL_MINUTES;
      return [1, 2, 3].map((index) => nowMs + index * minutes * 60_000);
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

  const summary =
    value.scheduleKind === "interval"
      ? `Every ${hours} hour${hours === 1 ? "" : "s"}`
      : cronValid && expression
        ? describeCronExpression(expression)
        : null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectClass}
          value={mode}
          onChange={(event) => {
            const next = event.target.value as Mode;
            setMode(next);
            emit({ mode: next });
          }}
          aria-label="How often"
        >
          <option value="hours">Every few hours</option>
          <option value="daily">Every day</option>
          <option value="weekly">On chosen days of the week</option>
          <option value="monthly">Once a month</option>
          <option value="cron">Custom (cron)</option>
        </select>

        {mode === "hours" && (
          <label className="flex items-center gap-1.5">
            <Input
              className={`${inputClass} w-16`}
              type="number"
              min={1}
              max={24}
              value={hours}
              onChange={(event) => {
                // Not clamped here: the floor belongs at the point the schedule
                // is built, so a typed 0.1 becomes the 15-minute minimum rather
                // than being silently rounded up to an hour.
                const next = Number(event.target.value);
                setHours(Number.isFinite(next) && next > 0 ? next : 1);
                emit({ hours: Number.isFinite(next) && next > 0 ? next : 1 });
              }}
              aria-label="Hours between runs"
            />
            <span className="text-muted-foreground">hours apart</span>
          </label>
        )}

        {mode === "monthly" && (
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">on day</span>
            <select
              className={selectClass}
              value={dayOfMonth}
              onChange={(event) => {
                const next = Number(event.target.value);
                setDayOfMonth(next);
                emit({ dayOfMonth: next });
              }}
              aria-label="Day of the month"
            >
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}

        {(mode === "daily" || mode === "weekly" || mode === "monthly") && (
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">at</span>
            <Input
              className={`${inputClass} w-24`}
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

        {mode === "cron" && (
          <Input
            className={`${inputClass} w-44 font-mono`}
            value={cron}
            onChange={(event) => {
              setCron(event.target.value);
              emit({ cron: event.target.value });
            }}
            aria-label="Cron expression"
            aria-invalid={!cronValid}
          />
        )}
      </div>

      {mode === "weekly" && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((day) => {
            const selected = weekdays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleWeekday(day.value)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs transition-colors",
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

      {/* A time zone only changes anything for a clock-based schedule. Asking
          for it beside "every 6 hours" would be a question whose answer cannot
          matter. */}
      {mode !== "hours" && (
        <label className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Time zone</span>
          <select
            className={selectClass}
            value={value.timezone}
            onChange={(event) => emit({ timezone: event.target.value })}
            aria-label="Time zone"
          >
            {timezones.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Saying back what was understood, and when it will actually happen.
          `0 0 * * *` looks like a fair guess at midnight until the preview
          shows the next run is fourteen hours away rather than tonight. */}
      <div className="rounded-md bg-muted/50 px-2 py-1.5">
        {timeMissing ? (
          <p className="text-destructive">Enter a time of day, such as 06:00.</p>
        ) : !cronValid ? (
          <p className="text-destructive">
            That is not a valid cron expression. Five fields, e.g. <code>0 6 * * 1-5</code> for
            weekdays at 06:00.
          </p>
        ) : upcoming.length === 0 ? (
          <p className="text-destructive">That schedule never comes around.</p>
        ) : (
          <>
            <p className="font-medium">
              {summary}
              {mode !== "hours" && value.timezone ? ` · ${value.timezone}` : ""}
            </p>
            <p className="text-muted-foreground">
              Next: {relativeTime(new Date(upcoming[0]).toISOString(), nowMs)} - {formatDateTime(new Date(upcoming[0]).toISOString())}
              {upcoming[1] ? `, then ${formatDateTime(new Date(upcoming[1]).toISOString())}` : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
