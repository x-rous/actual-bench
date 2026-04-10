"use client";

import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

export type AmountOp = "" | "is" | "isapprox" | "isbetween";

const MODE_OPTIONS: { value: AmountOp; label: string }[] = [
  { value: "",          label: "No amount" },
  { value: "is",        label: "Exact" },
  { value: "isapprox",  label: "Approx." },
  { value: "isbetween", label: "Range" },
];

type Props = {
  amountOp: AmountOp;
  amount: string;
  amountNum1: string;
  amountNum2: string;
  onAmountOpChange: (v: AmountOp) => void;
  onAmountChange: (v: string) => void;
  onAmountNum1Change: (v: string) => void;
  onAmountNum2Change: (v: string) => void;
  errors?: {
    amountOp?: string;
    amount?: string;
    amountNum1?: string;
    amountNum2?: string;
  };
};

export function AmountModeInput({
  amountOp, amount, amountNum1, amountNum2,
  onAmountOpChange, onAmountChange, onAmountNum1Change, onAmountNum2Change,
  errors = {},
}: Props) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIdx = MODE_OPTIONS.findIndex((o) => o.value === amountOp);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (currentIdx + 1) % MODE_OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (currentIdx - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      onAmountOpChange(MODE_OPTIONS[nextIdx]!.value);
      buttonRefs.current[nextIdx]?.focus();
    }
  }, [amountOp, onAmountOpChange]);

  return (
    <div className="flex flex-col gap-2">
      {/* Mode selector — roving tabindex radiogroup */}
      <div
        role="radiogroup"
        aria-label="Amount mode"
        className="flex gap-1"
        aria-invalid={!!errors.amountOp}
        aria-describedby={errors.amountOp ? "amount-op-error" : undefined}
        onKeyDown={handleKeyDown}
      >
        {MODE_OPTIONS.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={amountOp === opt.value}
            tabIndex={amountOp === opt.value ? 0 : -1}
            ref={(el) => { buttonRefs.current[i] = el; }}
            onClick={() => onAmountOpChange(opt.value)}
            className={cn(
              "flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors",
              amountOp === opt.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
              errors.amountOp && "border-destructive"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {errors.amountOp && (
        <p id="amount-op-error" className="text-xs text-destructive">{errors.amountOp}</p>
      )}

      {/* Amount inputs */}
      {(amountOp === "is" || amountOp === "isapprox") && (
        <div className="flex flex-col gap-1">
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder={amountOp === "isapprox" ? "~0.00" : "0.00"}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50"
          />
          {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
          <p className="text-[11px] text-muted-foreground">Negative = expense · Positive = income</p>
        </div>
      )}

      {amountOp === "isbetween" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <input
                type="number"
                step="0.01"
                value={amountNum1}
                onChange={(e) => onAmountNum1Change(e.target.value)}
                placeholder="Min"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50"
              />
              {errors.amountNum1 && <p className="text-xs text-destructive">{errors.amountNum1}</p>}
            </div>
            <span className="text-xs text-muted-foreground">–</span>
            <div className="flex flex-1 flex-col gap-1">
              <input
                type="number"
                step="0.01"
                value={amountNum2}
                onChange={(e) => onAmountNum2Change(e.target.value)}
                placeholder="Max"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50"
              />
              {errors.amountNum2 && <p className="text-xs text-destructive">{errors.amountNum2}</p>}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Negative = expense · Positive = income</p>
        </div>
      )}
    </div>
  );
}
