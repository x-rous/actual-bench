"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Trash2, CheckCircle2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { recurSummary } from "../lib/recurSummary";
import { scheduleFormSchema, defaultFormValues } from "../schemas/schedule.schema";
import type { ScheduleFormValues } from "../schemas/schedule.schema";
import { AmountModeInput } from "./AmountModeInput";
import type { AmountOp } from "./AmountModeInput";
import { RecurPatternEditor } from "./RecurPatternEditor";
import type { RecurValues } from "./RecurPatternEditor";
import type { Schedule, ScheduleAmountRange, RecurConfig } from "@/types/entities";
import { cn } from "@/lib/utils";

// ─── Converters ───────────────────────────────────────────────────────────────

function scheduleToForm(s: Schedule): ScheduleFormValues {
  const base = defaultFormValues();

  let dateMode: "once" | "recurring" = "once";
  let onceDate = base.onceDate;
  let frequency = base.frequency;
  let interval = base.interval;
  let start = base.start;
  let endMode = base.endMode;
  let endOccurrences = base.endOccurrences;
  let endDate = base.endDate;
  let skipWeekend = base.skipWeekend;
  let weekendSolveMode = base.weekendSolveMode;
  let patternMode = base.patternMode;
  let patternDay = base.patternDay;
  let patternWeekNum = base.patternWeekNum;
  let patternWeekDay = base.patternWeekDay;

  if (typeof s.date === "string") {
    dateMode = "once";
    onceDate = s.date;
  } else if (s.date) {
    dateMode = "recurring";
    const r = s.date;
    frequency = r.frequency;
    interval = r.interval ?? 1;
    start = r.start;
    endMode = r.endMode;
    endOccurrences = r.endOccurrences ?? 12;
    endDate = r.endDate ?? "";
    skipWeekend = r.skipWeekend ?? false;
    weekendSolveMode = r.weekendSolveMode ?? "before";

    if (r.patterns && r.patterns.length > 0) {
      const p = r.patterns[0];
      if (p.type === "day") {
        patternMode = "specific_day";
        patternDay = p.value;
      } else {
        patternMode = "day_of_week";
        patternWeekNum = p.value;
        patternWeekDay = p.type;
      }
    }
  }

  let amountOp: ScheduleFormValues["amountOp"] = "";
  let amount = "";
  let amountNum1 = "";
  let amountNum2 = "";

  if (s.amountOp) {
    amountOp = s.amountOp;
    if (s.amountOp === "isbetween" && s.amount !== undefined && typeof s.amount === "object") {
      const range = s.amount as ScheduleAmountRange;
      amountNum1 = (range.num1 / 100).toFixed(2);
      amountNum2 = (range.num2 / 100).toFixed(2);
    } else if (typeof s.amount === "number") {
      amount = (s.amount / 100).toFixed(2);
    }
  }

  return {
    name: s.name ?? "",
    payeeId: s.payeeId ?? "",
    accountId: s.accountId ?? "",
    postsTransaction: s.postsTransaction,
    dateMode, onceDate, frequency, interval, start, endMode,
    endOccurrences, endDate, skipWeekend, weekendSolveMode,
    patternMode, patternDay, patternWeekNum, patternWeekDay,
    amountOp, amount, amountNum1, amountNum2,
  };
}

function formToSchedule(values: ScheduleFormValues, existingId?: string): Schedule {
  const id = existingId ?? generateId();

  let date: string | RecurConfig;
  if (values.dateMode === "once") {
    date = values.onceDate ?? "";
  } else {
    const config: RecurConfig = {
      frequency: values.frequency,
      interval: values.interval,
      start: values.start,
      endMode: values.endMode,
    };
    if (values.endMode === "after_n_occurrences") config.endOccurrences = values.endOccurrences;
    if (values.endMode === "on_date") config.endDate = values.endDate;
    if (values.skipWeekend) {
      config.skipWeekend = true;
      config.weekendSolveMode = values.weekendSolveMode;
    }
    if (values.frequency === "monthly" && values.patternMode !== "none") {
      if (values.patternMode === "specific_day") {
        config.patterns = [{ value: values.patternDay, type: "day" }];
      } else {
        config.patterns = [{ value: values.patternWeekNum, type: values.patternWeekDay }];
      }
    }
    date = config;
  }

  let amount: number | ScheduleAmountRange | undefined;
  let amountOp: Schedule["amountOp"];

  if (values.amountOp === "is" || values.amountOp === "isapprox") {
    const val = parseFloat(values.amount);
    if (!isNaN(val)) {
      amount = Math.round(val * 100);
      amountOp = values.amountOp;
    }
  } else if (values.amountOp === "isbetween") {
    const n1 = parseFloat(values.amountNum1);
    const n2 = parseFloat(values.amountNum2);
    if (!isNaN(n1) && !isNaN(n2)) {
      amount = { num1: Math.round(n1 * 100), num2: Math.round(n2 * 100) };
      amountOp = "isbetween";
    }
  }

  return {
    id,
    name: values.name?.trim() || undefined,
    payeeId: values.payeeId || null,
    accountId: values.accountId || null,
    postsTransaction: values.postsTransaction,
    completed: false,
    date,
    amount,
    amountOp,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string | null;
  onEditAsRule?: (ruleId: string) => void;
};

export function ScheduleFormDrawer({ open, onOpenChange, scheduleId, onEditAsRule }: Props) {
  const stagedSchedules = useStagedStore((s) => s.schedules);
  const stagedPayees    = useStagedStore((s) => s.payees);
  const stagedAccounts  = useStagedStore((s) => s.accounts);
  const stageNew    = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const pushUndo    = useStagedStore((s) => s.pushUndo);

  const existingSchedule = scheduleId ? stagedSchedules[scheduleId]?.entity : null;
  const isNew = !scheduleId;

  const {
    register, handleSubmit, reset, watch, setValue,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: defaultFormValues(),
  });

  useEffect(() => {
    if (!open) return;
    if (existingSchedule) {
      reset(scheduleToForm(existingSchedule));
    } else {
      reset(defaultFormValues());
    }
  }, [open, scheduleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dateMode         = watch("dateMode");
  const amountOp         = watch("amountOp");
  const amount           = watch("amount");
  const amountNum1       = watch("amountNum1");
  const amountNum2       = watch("amountNum2");
  const frequency        = watch("frequency");
  const interval         = watch("interval");
  const start            = watch("start");
  const endMode          = watch("endMode");
  const endOccurrences   = watch("endOccurrences");
  const endDate          = watch("endDate");
  const skipWeekend      = watch("skipWeekend");
  const weekendSolveMode = watch("weekendSolveMode");
  const patternMode      = watch("patternMode");
  const patternDay       = watch("patternDay");
  const patternWeekNum   = watch("patternWeekNum");
  const patternWeekDay   = watch("patternWeekDay");
  const onceDate         = watch("onceDate");

  const recurValues: RecurValues = {
    frequency, interval, start, endMode, endOccurrences: endOccurrences ?? 12,
    endDate: endDate ?? "", skipWeekend, weekendSolveMode,
    patternMode, patternDay, patternWeekNum, patternWeekDay,
  };

  // ── Selectors ────────────────────────────────────────────────────────────────
  const payeeOptions: ComboboxOption[] = Object.values(stagedPayees)
    .filter((s) => !s.isDeleted && !s.entity.transferAccountId)
    .map((s) => ({ id: s.entity.id, name: s.entity.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const accountOptions: ComboboxOption[] = Object.values(stagedAccounts)
    .filter((s) => !s.isDeleted)
    .map((s) => ({ id: s.entity.id, name: s.entity.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── Preview summary ──────────────────────────────────────────────────────────
  const preview = dateMode === "once"
    ? recurSummary(onceDate)
    : recurSummary({ frequency, interval, start, endMode, endOccurrences, endDate, skipWeekend, weekendSolveMode,
        patterns: patternMode === "specific_day" ? [{ value: patternDay, type: "day" }]
                : patternMode === "day_of_week"  ? [{ value: patternWeekNum, type: patternWeekDay }]
                : undefined });

  // ── Submit ───────────────────────────────────────────────────────────────────
  function onSubmit(values: ScheduleFormValues) {
    pushUndo();
    if (isNew) {
      stageNew("schedules", formToSchedule(values));
    } else {
      const updated = formToSchedule(values, scheduleId!);
      stageUpdate("schedules", scheduleId!, {
        name: updated.name,
        postsTransaction: updated.postsTransaction,
        payeeId: updated.payeeId,
        accountId: updated.accountId,
        amount: updated.amount,
        amountOp: updated.amountOp,
        date: updated.date,
        completed: existingSchedule?.completed ?? false,
      });
    }
    onOpenChange(false);
  }

  function handleDelete() {
    if (!scheduleId) return;
    pushUndo();
    stageDelete("schedules", scheduleId);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-lg flex flex-col overflow-hidden p-0 gap-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <SheetTitle>{isNew ? "New Schedule" : "Edit Schedule"}</SheetTitle>
            {!isNew && existingSchedule?.completed && (
              <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <CheckCircle2 className="h-3 w-3" />
                Completed
              </span>
            )}
          </div>
          <SheetDescription className="sr-only">
            {isNew ? "Create a new schedule" : "Edit schedule details"}
          </SheetDescription>
        </SheetHeader>

        <form
          id="schedule-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-1 flex-col overflow-y-auto"
        >
          {/* ── DETAILS section ─────────────────────────────────────────── */}
          <div className="px-4 py-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Details</p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sched-name" className="text-xs">Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="sched-name" placeholder="e.g. Monthly Rent" {...register("name")} />
            </div>

            {/* Payee + Account side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Payee <span className="text-muted-foreground">(optional)</span></Label>
                <SearchableCombobox
                  options={payeeOptions}
                  value={watch("payeeId") ?? ""}
                  onChange={(v) => setValue("payeeId", v)}
                  placeholder="— none —"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Account <span className="text-muted-foreground">(optional)</span></Label>
                <SearchableCombobox
                  options={accountOptions}
                  value={watch("accountId") ?? ""}
                  onChange={(v) => setValue("accountId", v)}
                  placeholder="— none —"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border" />

          {/* ── DATE section ────────────────────────────────────────────── */}
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Date</p>
              {preview && (
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{preview}</span>
              )}
            </div>

            {/* Mode toggle */}
            <div className="flex gap-1">
              {(["once", "recurring"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setValue("dateMode", mode)}
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
                  onChange={(e) => setValue("onceDate", e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50"
                />
                {errors.onceDate && <p className="mt-1 text-xs text-destructive">{errors.onceDate.message}</p>}
              </div>
            ) : (
              <RecurPatternEditor
                values={recurValues}
                onChange={(key, val) => setValue(key as keyof ScheduleFormValues, val as never)}
                errors={{
                  start: errors.start?.message,
                  endOccurrences: errors.endOccurrences?.message,
                  endDate: errors.endDate?.message,
                }}
              />
            )}
          </div>

          <div className="border-t border-border" />

          {/* ── AMOUNT section ──────────────────────────────────────────── */}
          <div className="px-4 py-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Amount</p>
            <AmountModeInput
              amountOp={amountOp as AmountOp}
              amount={amount}
              amountNum1={amountNum1}
              amountNum2={amountNum2}
              onAmountOpChange={(v) => setValue("amountOp", v)}
              onAmountChange={(v) => setValue("amount", v)}
              onAmountNum1Change={(v) => setValue("amountNum1", v)}
              onAmountNum2Change={(v) => setValue("amountNum2", v)}
              errors={{
                amount: errors.amount?.message,
                amountNum1: errors.amountNum1?.message,
                amountNum2: errors.amountNum2?.message,
              }}
            />
          </div>

          <div className="border-t border-border" />

          {/* ── OPTIONS section ─────────────────────────────────────────── */}
          <div className="px-4 py-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Options</p>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 accent-primary"
                {...register("postsTransaction")}
              />
              <span>
                <span className="font-medium">Automatically add transaction</span>
                <span className="block text-muted-foreground">
                  When enabled, Actual Budget creates a transaction when this schedule is due.
                </span>
              </span>
            </label>
          </div>
        </form>

        <SheetFooter className="border-t border-border px-4 pt-3 pb-4">
          <div className="flex w-full items-center gap-2">
            {/* Left side: delete + edit-as-rule */}
            <div className="flex gap-1">
              {!isNew && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  title="Delete schedule"
                  onClick={handleDelete}
                >
                  <Trash2 />
                </Button>
              )}
              {!isNew && existingSchedule?.ruleId && onEditAsRule && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { onEditAsRule(existingSchedule.ruleId!); onOpenChange(false); }}
                  title="Open underlying rule in Rules editor"
                >
                  <ExternalLink className="h-3 w-3" />
                  Edit as Rule
                </Button>
              )}
            </div>

            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" form="schedule-form">
                {isNew ? "Add Schedule" : "Save Changes"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
