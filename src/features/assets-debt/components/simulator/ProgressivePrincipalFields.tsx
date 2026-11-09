"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { paymentCount } from "@/lib/financial-models/loan/recast";
import { progressiveFirstPrincipal, progressivePrincipalAt, solveProgressiveGrowth } from "@/lib/financial-models/loan/repayment";
import { dec, fromMinor } from "@/lib/financial-models/money/kernel";
import { formatAmount } from "../../lib/money";
import { growthPercent, type SimulationState } from "../../lib/simulatorModel";
import { IntegerField, MoneyField, PercentField } from "../fields";

/** The growth field's limits (design 06 §1.1): up to 5% per repayment, 8 decimals as a percentage. */
function growthIssue(fraction: string | null, text: string | null): string | undefined {
  if (fraction === null) return text ? undefined : "Enter the growth, or work it out from your lender's table.";
  if (Number(fraction) > 0.05) return "Bench supports up to 5% growth per repayment.";
  const decimals = fraction.split(".")[1]?.length ?? 0;
  if (decimals > 10) return "Use at most 8 decimal places.";
  return undefined;
}

/**
 * Progressive principal settings inside Set calculation method (design 06 §3): the principal growth per repayment, and
 * a helper that works it out from one row of the lender's table. Changes are staged like every other setting.
 */
export function ProgressivePrincipalFields({ sim, change }: { sim: SimulationState; change: (next: SimulationState) => void }) {
  const growth = sim.progressiveGrowthDecimal ?? null;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
      <PercentField
        label="Principal growth per repayment"
        valueFraction={growth}
        issue={growthIssue(growth, null)}
        hint="Each repayment's principal is the previous one's plus this share; interest is added on top."
        onChange={(fraction) => change({ ...sim, progressiveGrowthDecimal: fraction })}
      />
      <WorkItOut sim={sim} onUse={(fraction) => change({ ...sim, progressiveGrowthDecimal: fraction })} />
    </div>
  );
}

function WorkItOut({ sim, onUse }: { sim: SimulationState; onUse: (fraction: string) => void }) {
  const total = sim.termMonths ? paymentCount(sim.profile.repaymentFrequency, sim.termMonths) : null;
  const [balance, setBalance] = useState<number | null>(sim.principalMinor);
  const [principal, setPrincipal] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(total);
  const digits = sim.minorDigits;
  const solved = balance && principal && left ? solveProgressiveGrowth(balance, principal, left, digits) : null;
  // Check the growth against the loan as set up: Bench's own principal for the same instalment.
  const check = solved?.ok && total && sim.principalMinor && left && left <= total
    ? progressivePrincipalAt(progressiveFirstPrincipal(fromMinor(sim.principalMinor, digits), dec(solved.growthDecimal), total), dec(solved.growthDecimal), total - left, { minorDigits: digits, mode: sim.profile.rounding.paymentRounding })
    : null;
  const instalment = total && left ? total - left + 1 : null;
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="link" size="sm" className="h-auto self-start gap-1 px-0 text-xs" />}>
        <Calculator aria-hidden="true" className="size-3.5" />
        Work it out…
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-3 p-4" aria-label="Work out the principal growth">
        <p className="text-xs text-muted-foreground">Take any instalment from your lender&apos;s table.</p>
        <MoneyField label="Balance before the instalment" valueMinor={balance} minorDigits={digits} onChange={setBalance} />
        <MoneyField label="Principal it repays" valueMinor={principal} minorDigits={digits} onChange={setPrincipal} />
        <IntegerField label="Instalments left, including it" value={left} min={1} onChange={setLeft} />
        {solved ? (
          solved.ok ? (
            <div className="flex flex-col gap-1 text-xs" role="status">
              <span>Growth <strong>{growthPercent(solved.growthDecimal)}%</strong> per repayment</span>
              {check !== null && principal !== null && instalment !== null ? (
                Math.abs(check - principal) <= 1
                  ? <span className="text-muted-foreground">Matches the loan as set up: instalment {instalment} repays {formatAmount(check, digits)}.</span>
                  : <span className="text-amber-700 dark:text-amber-400">With this growth, the loan as set up repays {formatAmount(check, digits)} at instalment {instalment}, not {formatAmount(principal, digits)}. Check the loan amount, term or start date against your lender&apos;s table.</span>
              ) : null}
              <Button type="button" size="sm" className="mt-1 self-start" onClick={() => onUse(solved.growthDecimal)}>Use this growth</Button>
            </div>
          ) : (
            <p className="text-xs text-destructive" role="alert">
              {solved.reason === "shrinking"
                ? "This principal is more than equal repayments would give, so it would shrink each time. Bench supports growing principal only."
                : solved.reason === "too-fast"
                  ? "That needs more than 5% growth per repayment. Check the three amounts."
                  : "Enter a balance, a principal no larger than it, and at least one instalment."}
            </p>
          )
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
