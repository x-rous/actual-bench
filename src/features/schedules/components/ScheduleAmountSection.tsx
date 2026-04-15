"use client";

import { useWatch, type Control, type Path, type PathValue } from "react-hook-form";
import { AmountModeInput, type AmountOp } from "./AmountModeInput";
import type { ScheduleFormValues } from "../schemas/schedule.schema";

type SetScheduleValue = <K extends Path<ScheduleFormValues>>(
  key: K,
  value: PathValue<ScheduleFormValues, K>
) => void;

type Props = {
  control: Control<ScheduleFormValues>;
  errors: {
    amount?: string;
    amountNum1?: string;
    amountNum2?: string;
  };
  setFieldValue: SetScheduleValue;
};

export function ScheduleAmountSection({ control, errors, setFieldValue }: Props) {
  const amountOp = useWatch({ control, name: "amountOp" });
  const amount = useWatch({ control, name: "amount" });
  const amountNum1 = useWatch({ control, name: "amountNum1" });
  const amountNum2 = useWatch({ control, name: "amountNum2" });

  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Amount</p>
      <AmountModeInput
        amountOp={amountOp as AmountOp}
        amount={amount}
        amountNum1={amountNum1}
        amountNum2={amountNum2}
        onAmountOpChange={(value) => setFieldValue("amountOp", value)}
        onAmountChange={(value) => setFieldValue("amount", value)}
        onAmountNum1Change={(value) => setFieldValue("amountNum1", value)}
        onAmountNum2Change={(value) => setFieldValue("amountNum2", value)}
        errors={errors}
      />
    </div>
  );
}
