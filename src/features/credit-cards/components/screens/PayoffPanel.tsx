"use client";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { Input } from "@/components/ui/input";
import { formatCardMonth } from "../../lib/displayDates";
import { payoffPlan, type PayoffDebt, type PayoffResult, type PayoffStrategy } from "../../lib/payoff";
import { formatPercentBps } from "../../lib/percent";
import { money, plural } from "../primitives/format";

const STRATEGIES: { value: PayoffStrategy; label: string; hint: string }[] = [
  { value: "avalanche", label: "Highest APR first", hint: "Least interest" },
  { value: "snowball", label: "Smallest balance first", hint: "Cards cleared sooner" },
];

const months = (count: number) => (count < 12 ? plural(count, "month")
  : `${plural(Math.floor(count / 12), "year")}${count % 12 ? ` ${plural(count % 12, "month")}` : ""}`);

function outcome(result: PayoffResult) {
  if (result.feasible) return `${months(result.months)} · ${money(result.interestMinor)} interest`;
  return result.reason === "below-minimums" ? `Below the minimums (${money(result.minimumsMinor)})` : "Never paid off at this amount";
}

/**
 * What-if across all cards: one monthly amount, minimums on every card, the rest to one card at a time.
 * Uses each card's balance today, purchase APR and minimum rule; plan instalments are not included.
 */
export function PayoffPanel({ debts, today }: { debts: PayoffDebt[]; today: string }) {
  const id = useId();
  const owed = debts.reduce((sum, debt) => sum + debt.balanceMinor, 0);
  // Start from roughly 5% of what is owed, rounded up to a whole hundred.
  const [text, setText] = useState(() => minorToMajorText(Math.max(10_000, Math.ceil(owed * 0.05 / 10_000) * 10_000), 2));
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");
  const parsed = parseMajorToMinor(text, 2);
  const monthly = parsed.ok ? parsed.value : null;
  const missingApr = debts.filter((debt) => debt.aprBps === null);
  if (!debts.length) return <p className="p-4 text-sm text-muted-foreground">No card balances to pay off.</p>;
  const results = monthly && monthly > 0
    ? Object.fromEntries(STRATEGIES.map(({ value }) => [value, payoffPlan(debts, monthly, value)])) as Record<PayoffStrategy, PayoffResult>
    : null;
  const chosen = results?.[strategy];
  return <div className="space-y-4 p-4 text-sm">
    <div className="space-y-1">
      <label htmlFor={`${id}-monthly`} className="text-xs font-medium">Paid across all cards each month</label>
      <Input id={`${id}-monthly`} inputMode="decimal" className="w-40" value={text} onChange={(event) => setText(event.target.value)}
        aria-invalid={!parsed.ok || monthly === 0} />
      <p className="text-xs text-muted-foreground">{plural(debts.length, "card")} · {money(owed)} owed today</p>
    </div>
    <div role="group" aria-label="Strategy" className="grid grid-cols-2 gap-2">
      {STRATEGIES.map((option) => <button
        key={option.value}
        type="button"
        aria-pressed={strategy === option.value}
        onClick={() => setStrategy(option.value)}
        className={cn("rounded-md border px-3 py-2 text-left", strategy === option.value ? "border-foreground bg-muted/60" : "hover:bg-muted/40")}
      >
        <span className="block font-medium">{option.label}</span>
        <span className="block text-xs text-muted-foreground">{option.hint}</span>
        <span className="mt-1 block text-xs tabular-nums">{results ? outcome(results[option.value]) : "-"}</span>
      </button>)}
    </div>
    {chosen?.feasible && <div className="space-y-2">
      <p>Debt-free in <span className="font-semibold">{formatCardMonth(addMonths(today, chosen.months))}</span>
        {results && results.avalanche.feasible && results.snowball.feasible && results.avalanche.interestMinor !== results.snowball.interestMinor
          && <span className="text-muted-foreground"> · highest APR first saves {money(Math.abs(results.snowball.interestMinor - results.avalanche.interestMinor))}</span>}
      </p>
      <ol aria-label="Payoff order" className="divide-y rounded-md border">
        {chosen.order.map((entry, index) => {
          const debt = debts.find((item) => item.id === entry.id)!;
          return <li key={entry.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate">{index + 1}. {entry.name}
              <span className="text-xs text-muted-foreground"> · {money(debt.balanceMinor)}{debt.aprBps !== null ? ` · ${formatPercentBps(debt.aprBps)}%` : ""}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums">{formatCardMonth(addMonths(today, entry.month))}</span>
          </li>;
        })}
      </ol>
    </div>}
    <p className="text-xs text-muted-foreground">
      An estimate: interest is the purchase APR monthly on today&apos;s balance, with no new spending; instalment plans are not included.
      {missingApr.length ? ` No APR set for ${missingApr.map((debt) => debt.name).join(", ")}, so it counts as 0%.` : ""}
    </p>
  </div>;
}
