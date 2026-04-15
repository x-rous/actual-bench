"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, type Path, type PathValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableDrawer } from "@/components/ui/editable-drawer";
import type { ComboboxOption } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useDrawerCloseGuard } from "@/hooks/useDrawerCloseGuard";
import { scheduleFormSchema, defaultFormValues } from "../schemas/schedule.schema";
import type { ScheduleFormValues } from "../schemas/schedule.schema";
import type { Schedule, ScheduleAmountRange, RecurConfig } from "@/types/entities";
import { buildScheduleDeleteWarning } from "@/lib/usageWarnings";
import { ScheduleDetailsSection } from "./ScheduleDetailsSection";
import { ScheduleDateSection } from "./ScheduleDateSection";
import { ScheduleAmountSection } from "./ScheduleAmountSection";

// ─── Converters ───────────────────────────────────────────────────────────────

function getDisplayAmountState(schedule: Schedule): {
  amountOp: ScheduleFormValues["amountOp"];
  amount: string;
  amountNum1: string;
  amountNum2: string;
} {
  if (schedule.amountOp === "isbetween" && schedule.amount != null && typeof schedule.amount === "object") {
    const range = schedule.amount as ScheduleAmountRange;
    return {
      amountOp: "isbetween",
      amount: "",
      amountNum1: (range.num1 / 100).toFixed(2),
      amountNum2: (range.num2 / 100).toFixed(2),
    };
  }

  if ((schedule.amountOp === "is" || schedule.amountOp === "isapprox") && typeof schedule.amount === "number") {
    return {
      amountOp: schedule.amountOp,
      amount: (schedule.amount / 100).toFixed(2),
      amountNum1: "",
      amountNum2: "",
    };
  }

  return {
    amountOp: "isapprox",
    amount: "0.00",
    amountNum1: "",
    amountNum2: "",
  };
}

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

  const { amountOp, amount, amountNum1, amountNum2 } = getDisplayAmountState(s);

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

type ScheduleEditableSnapshot = {
  name?: string;
  payeeId: string | null;
  accountId: string | null;
  postsTransaction: boolean;
  amount: number | ScheduleAmountRange;
  amountOp: Schedule["amountOp"];
  date?: string | RecurConfig;
};

function normalizeRecurConfig(config: RecurConfig): RecurConfig {
  return {
    frequency: config.frequency,
    interval: config.interval ?? 1,
    start: config.start,
    endMode: config.endMode,
    ...(config.endMode === "after_n_occurrences"
      ? { endOccurrences: config.endOccurrences ?? 12 }
      : {}),
    ...(config.endMode === "on_date" && config.endDate ? { endDate: config.endDate } : {}),
    ...(config.skipWeekend
      ? {
          skipWeekend: true,
          weekendSolveMode: config.weekendSolveMode ?? "before",
        }
      : {}),
    ...(config.patterns && config.patterns.length > 0 ? { patterns: config.patterns } : {}),
  };
}

function toEditableSnapshot(schedule: Schedule): ScheduleEditableSnapshot {
  const amountState = getDisplayAmountState(schedule);
  return {
    name: schedule.name?.trim() || undefined,
    payeeId: schedule.payeeId ?? null,
    accountId: schedule.accountId ?? null,
    postsTransaction: schedule.postsTransaction ?? false,
    amount:
      amountState.amountOp === "isbetween"
        ? {
            num1: Math.round(parseFloat(amountState.amountNum1) * 100),
            num2: Math.round(parseFloat(amountState.amountNum2) * 100),
          }
        : Math.round(parseFloat(amountState.amount) * 100),
    amountOp: amountState.amountOp,
    date:
      typeof schedule.date === "string"
        ? schedule.date
        : schedule.date
          ? normalizeRecurConfig(schedule.date)
          : undefined,
  };
}

function editableScheduleSignature(schedule: Schedule): string {
  return JSON.stringify(toEditableSnapshot(schedule));
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
  const [deleteRequested, setDeleteRequested] = useState(false);

  const {
    control, register, handleSubmit, reset, setValue,
    formState: { errors, isDirty },
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

  const setFieldValue = useCallback(
    <K extends Path<ScheduleFormValues>>(key: K, value: PathValue<ScheduleFormValues, K>) => {
      setValue(key, value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    },
    [setValue]
  );

  // ── Selectors ────────────────────────────────────────────────────────────────
  const payeeOptions: ComboboxOption[] = useMemo(
    () =>
      Object.values(stagedPayees)
        .filter((s) => !s.isDeleted && !s.entity.transferAccountId)
        .map((s) => ({ id: s.entity.id, name: s.entity.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stagedPayees]
  );

  const accountOptions: ComboboxOption[] = useMemo(
    () =>
      Object.values(stagedAccounts)
        .filter((s) => !s.isDeleted)
        .map((s) => ({ id: s.entity.id, name: s.entity.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stagedAccounts]
  );

  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "schedule",
    existingSchedule && !isNew ? [existingSchedule.id] : [],
    { enabled: deleteRequested && !!existingSchedule && !isNew }
  );

  const deleteTxTotal = existingSchedule && !isNew
    ? (txCounts ? [...txCounts.values()].reduce((a, b) => a + b, 0) : undefined)
    : 0;

  const deleteConfirmState: ConfirmState | null =
    deleteRequested && existingSchedule
      ? {
          title: "Delete schedule?",
          message: buildScheduleDeleteWarning(
            existingSchedule.name ?? "Unnamed",
            existingSchedule.ruleId,
            existingSchedule.postsTransaction ?? false,
            deleteTxTotal,
            txLoading && !isNew
          ),
          onConfirm: () => {
            pushUndo();
            stageDelete("schedules", scheduleId!);
            closeDrawer();
          },
        }
      : null;

  const {
    confirmDialog,
    setConfirmDialog,
    closeNow,
    requestClose,
    handleOpenChange,
  } = useDrawerCloseGuard({
    isDirty,
    onClose: () => onOpenChange(false),
    title: "Discard schedule changes?",
    message: "Your unsaved edits in this schedule drawer will be lost.",
  });

  function closeDrawer() {
    setDeleteRequested(false);
    closeNow();
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  function onSubmit(values: ScheduleFormValues) {
    if (isNew) {
      pushUndo();
      stageNew("schedules", formToSchedule(values));
    } else {
      const updated = formToSchedule(values, scheduleId!);
      if (existingSchedule && editableScheduleSignature(existingSchedule) === editableScheduleSignature(updated)) {
        closeDrawer();
        return;
      }

      pushUndo();
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
    closeDrawer();
  }

  function handleDelete() {
    if (!scheduleId || !existingSchedule) return;
    setDeleteRequested(true);
  }

  function handleEditAsRule() {
    if (!existingSchedule?.ruleId || !onEditAsRule) return;
    requestClose(() => onEditAsRule(existingSchedule.ruleId!));
  }

  return (
    <>
    <EditableDrawer
      open={open}
      onOpenChange={(nextOpen) => handleOpenChange(nextOpen, () => onOpenChange(true))}
      title={isNew ? "New Schedule" : "Edit Schedule"}
      description={isNew ? "Create a new schedule" : "Edit schedule details"}
      descriptionClassName="sr-only"
      contentClassName="data-[side=right]:sm:max-w-lg"
      footerClassName="pt-3 pb-4"
      footer={
        <div className="flex w-full items-center gap-2">
          <div className="flex gap-1">
            {!isNew && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                title="Delete schedule"
                aria-label="Delete schedule"
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
                onClick={handleEditAsRule}
                title="Open underlying rule in Rules editor"
              >
                <ExternalLink className="h-3 w-3" />
                Edit as Rule
              </Button>
            )}
          </div>

          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={() => requestClose()}>
              Cancel
            </Button>
            <Button type="submit" form="schedule-form">
              {isNew ? "Add Schedule" : "Save Changes"}
            </Button>
          </div>
        </div>
      }
    >
        <form
          id="schedule-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-1 flex-col overflow-y-auto"
        >
          <ScheduleDetailsSection
            control={control}
            errors={errors}
            register={register}
            setFieldValue={setFieldValue}
            payeeOptions={payeeOptions}
            accountOptions={accountOptions}
          />

          <div className="border-t border-border" />

          <ScheduleDateSection
            control={control}
            errors={{
              onceDate: errors.onceDate?.message,
              start: errors.start?.message,
              endOccurrences: errors.endOccurrences?.message,
              endDate: errors.endDate?.message,
            }}
            setFieldValue={setFieldValue}
          />

          <div className="border-t border-border" />

          <ScheduleAmountSection
            control={control}
            errors={{
              amount: errors.amount?.message,
              amountNum1: errors.amountNum1?.message,
              amountNum2: errors.amountNum2?.message,
            }}
            setFieldValue={setFieldValue}
          />

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
    </EditableDrawer>
    <ConfirmDialog
      open={confirmDialog !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setConfirmDialog(null);
      }}
      state={confirmDialog}
    />
    <ConfirmDialog
      open={deleteRequested}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setDeleteRequested(false);
      }}
      state={deleteConfirmState}
    />
    </>
  );
}
