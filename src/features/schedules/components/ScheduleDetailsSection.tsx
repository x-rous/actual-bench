"use client";

import {
  useWatch,
  type Control,
  type FieldErrors,
  type Path,
  type PathValue,
  type UseFormRegister,
} from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { ScheduleFormValues } from "../schemas/schedule.schema";

type SetScheduleValue = <K extends Path<ScheduleFormValues>>(
  key: K,
  value: PathValue<ScheduleFormValues, K>
) => void;

type Props = {
  control: Control<ScheduleFormValues>;
  errors: FieldErrors<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
  setFieldValue: SetScheduleValue;
  payeeOptions: ComboboxOption[];
  accountOptions: ComboboxOption[];
};

export function ScheduleDetailsSection({
  control,
  errors,
  register,
  setFieldValue,
  payeeOptions,
  accountOptions,
}: Props) {
  const payeeId = useWatch({ control, name: "payeeId" }) ?? "";
  const accountId = useWatch({ control, name: "accountId" }) ?? "";

  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Details</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sched-name" className="text-xs">
          Name <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input id="sched-name" placeholder="e.g. Monthly Rent" {...register("name")} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">
            Payee <span className="text-muted-foreground">(optional)</span>
          </Label>
          <SearchableCombobox
            options={payeeOptions}
            value={payeeId}
            onChange={(value) => setFieldValue("payeeId", value)}
            placeholder="— none —"
          />
          {errors.payeeId?.message && (
            <p className="text-xs text-destructive">{errors.payeeId.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">
            Account <span className="text-muted-foreground">(optional)</span>
          </Label>
          <SearchableCombobox
            options={accountOptions}
            value={accountId}
            onChange={(value) => setFieldValue("accountId", value)}
            placeholder="— none —"
          />
          {errors.accountId?.message && (
            <p className="text-xs text-destructive">{errors.accountId.message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
