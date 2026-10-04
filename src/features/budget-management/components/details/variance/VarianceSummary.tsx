"use client";

import { cn } from "@/lib/utils";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import type { VarianceModel } from "../../../lib/varianceInvestigation";
import { FAVOURABLE_TEXT, UNFAVOURABLE_TEXT } from "./useChartFrame";

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  provisional: boolean;
};

function Term({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="min-w-16 text-center">
      <div className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

const Op = ({ children }: { children: string }) => (
  <span aria-hidden="true" className="text-base text-muted-foreground">{children}</span>
);

/**
 * The result in one line, and the equation that produces it.
 *
 * Tracking: net variance = overspent - saved (or shortfall - surplus).
 * Envelope: how many envelopes ended below zero, and what the balances add up to.
 */
export function VarianceSummary({ model, format, provisional }: Props) {
  const v = model.vocab;
  const total = model.total;
  const soFar = provisional ? " so far" : "";

  if (model.mode === "envelope") {
    const env = total.envelope;
    if (!env) return null;
    const last = model.months[model.months.length - 1];
    const inDeficit = model.categories.filter((c) => (c.cells.get(last)?.balance ?? 0) < 0).length;
    const pct = total.budget > 0 ? Math.abs(total.variance) / total.budget : null;
    const signedClosing = `${env.closing < 0 ? "−" : ""}${format.money(env.closing)}`;
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            {env.deficit > 0 ? (
              <>
                <span className={cn("text-[28px] font-bold leading-none tabular-nums", UNFAVOURABLE_TEXT)}>{format.money(env.deficit)}</span>
                <span className={cn("text-sm font-medium", UNFAVOURABLE_TEXT)}>in deficit{soFar}</span>
              </>
            ) : (
              <span className={cn("text-xl font-bold leading-none", FAVOURABLE_TEXT)}>No envelope in deficit{soFar}</span>
            )}
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
            {format.money(total.actual)} spent of {format.money(total.budget)} allocated
            {pct != null && <> · {(pct * 100).toFixed(1)}% {total.variance > 0 ? "over" : "under"} allocation</>}
            {" · "}
            {inDeficit} {inDeficit === 1 ? "envelope" : "envelopes"} below zero at the end of {formatMonthLabel(last, "long")}
          </p>
        </div>
        <div className="flex items-center gap-3.5" role="group" aria-label="Closing balance">
          <Term value={format.money(env.available)} label="available" tone={FAVOURABLE_TEXT} />
          <Op>−</Op>
          <Term value={format.money(env.deficit)} label="in deficit" tone={env.deficit > 0 ? UNFAVOURABLE_TEXT : undefined} />
          <Op>=</Op>
          <Term value={signedClosing} label="closing balance" />
        </div>
        <p className="basis-full text-[11.5px] tabular-nums text-muted-foreground">
          Balance bridge: carried in {format.money(env.carriedIn)} + allocated {format.money(total.budget)} − spent {format.money(total.actual)} + deficits cleared from To Budget {format.money(env.clearedFromToBudget)}
          {env.otherAdjustments !== 0 && <> {env.otherAdjustments > 0 ? "+" : "−"} other adjustments {format.money(env.otherAdjustments)}</>} = {signedClosing}
        </p>
      </div>
    );
  }

  const net = model.gross.net;
  const favourable = net < 0;
  const word = net === 0 ? "on budget" : favourable ? v.netFavourable : v.netUnfavourable;
  const pct = total.budget > 0 ? Math.abs(net) / total.budget : null;
  const tone = net === 0 ? undefined : favourable ? FAVOURABLE_TEXT : UNFAVOURABLE_TEXT;
  const netWord = favourable ? "net " + (model.side === "income" ? "above" : "under") : "net " + (model.side === "income" ? "below" : "over");
  const direction = favourable ? (model.side === "income" ? "above" : "under") : model.side === "income" ? "below" : "over";
  const unfavourableTerm = <Term value={format.money(model.gross.unfavourable)} label={v.unfavourableLower} tone={UNFAVOURABLE_TEXT} />;
  const favourableTerm = <Term value={format.money(model.gross.favourable)} label={v.favourableLower} tone={FAVOURABLE_TEXT} />;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-border px-5 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={cn("text-[30px] font-bold leading-none tabular-nums", tone)}>{format.money(net)}</span>
          <span className={cn("text-sm font-medium", tone)}>{word}{soFar}</span>
        </div>
        <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
          {format.money(total.actual)} {v.actualVerb} of {format.money(total.budget)} {v.budgetVerb}
          {" · "}
          {pct == null ? "–" : `${(pct * 100).toFixed(1)}% ${direction}`}
        </p>
      </div>
      {/* Net favourable reads best as the favourable amount first, so it never subtracts to a negative. */}
      <div className="flex items-center gap-3.5" role="group" aria-label="Variance equation">
        {favourable ? favourableTerm : unfavourableTerm}
        <Op>−</Op>
        {favourable ? unfavourableTerm : favourableTerm}
        <Op>=</Op>
        <Term value={format.money(net)} label={netWord} tone={tone} />
      </div>
    </div>
  );
}
