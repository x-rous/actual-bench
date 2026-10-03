"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import type { DebtBacktestResult, PeriodMatchStatus } from "@/lib/financial-models/matching";
import { formatAmount } from "../../lib/money";

const ROW_HEIGHT = 48;

const STATUS = {
  unique: { label: "Unique", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
  missing: { label: "Missing", icon: XCircle, tone: "text-destructive" },
  multiple: { label: "Multiple - Review", icon: CircleHelp, tone: "text-amber-600 dark:text-amber-400" },
  unsafe: { label: "Unsafe - Review", icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400" },
} satisfies Record<PeriodMatchStatus, { label: string; icon: typeof CheckCircle2; tone: string }>;

export function BacktestResultsTable({ result, minorDigits }: { result: DebtBacktestResult; minorDigits: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual intentionally owns the visible row window.
  const virtualizer = useVirtualizer({
    count: result.periods.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: { width: 900, height: 420 },
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-border" role="table" aria-label={`Backtest results for ${result.periods.length} expected repayments`}>
      <div role="rowgroup">
        <div className="grid min-w-[1020px] grid-cols-[110px_160px_1fr_1fr_120px_130px] border-b border-border bg-muted/60 px-3 py-2 text-[11px] font-medium text-muted-foreground" role="row">
          <span role="columnheader">Date</span><span role="columnheader">Status</span><span role="columnheader">Matched transaction</span><span role="columnheader">Expected allocation</span><span role="columnheader" className="text-right">Difference</span><span role="columnheader" className="text-right">Balance variance</span>
        </div>
      </div>
      <div ref={scrollRef} className="h-[420px] min-w-[1020px] overflow-y-auto">
        <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const period = result.periods[item.index];
            const status = STATUS[period.status];
            const Icon = status.icon;
            const first = period.candidates[0];
            return (
              <div
                key={`${period.expected.periodKey}-${item.index}`}
                role="row"
                aria-rowindex={item.index + 2}
                className="absolute left-0 right-0 grid grid-cols-[110px_160px_1fr_1fr_120px_130px] items-center border-b border-border/60 px-3 text-xs"
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <span role="cell" className="tabular-nums">{period.expected.date}</span>
                <span role="cell" className={`flex items-center gap-1.5 font-medium ${status.tone}`}><Icon className="h-3.5 w-3.5" aria-hidden />{status.label}</span>
                <span role="cell" className="truncate text-muted-foreground">
                  {first ? `${first.candidate.date} - ${formatAmount(Math.abs(first.candidate.amountMinor), minorDigits)}${period.flags.length ? ` - ${period.flags.join(", ")}` : ""}` : period.reviewReasons[0] ?? "No candidate"}
                </span>
                <span role="cell" className="truncate text-muted-foreground tabular-nums">
                  P {formatAmount(period.expected.principalMinor ?? 0, minorDigits)} - I {formatAmount(period.expected.interestMinor ?? 0, minorDigits)} - F {formatAmount(period.expected.feesMinor ?? 0, minorDigits)}
                </span>
                <span role="cell" className="text-right tabular-nums">{first ? `${formatAmount(first.deviation.amountMinor, minorDigits)} / ${first.deviation.days >= 0 ? "+" : ""}${first.deviation.days}d` : "-"}</span>
                <span role="cell" className="text-right tabular-nums">{period.projectedBalanceVarianceMinor === null ? "-" : formatAmount(period.projectedBalanceVarianceMinor, minorDigits)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
