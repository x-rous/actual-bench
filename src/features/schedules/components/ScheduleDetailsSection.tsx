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
import { AccountPicker, PayeePicker } from "@/components/ui/entity-picker";
import { useStagedAccounts, useStagedPayees } from "@/hooks/useStagedEntities";
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
};

export function ScheduleDetailsSection({
  control,
  errors,
  register,
  setFieldValue,
}: Props) {
  const payees = useStagedPayees();
  const { accounts, groups } = useStagedAccounts();
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
          <PayeePicker
            payees={payees}
            transfers="exclude"
            value={payeeId}
            onChange={(value) => setFieldValue("payeeId", value)}
            ariaLabel="Payee"
            allowNone
          />
          {errors.payeeId?.message && (
            <p className="text-xs text-destructive">{errors.payeeId.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">
            Account <span className="text-muted-foreground">(optional)</span>
          </Label>
          <AccountPicker
            accounts={accounts}
            groups={groups}
            value={accountId}
            onChange={(value) => setFieldValue("accountId", value)}
            ariaLabel="Account"
            allowNone
          />
          {errors.accountId?.message && (
            <p className="text-xs text-destructive">{errors.accountId.message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
