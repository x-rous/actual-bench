"use client";

import { formatAmount } from "../../lib/money";
import type { Deltas, Headline } from "../../lib/results";
import { formatChartDate } from "../chart/chartMeta";

/**
 * The four headline results (P1.3b T210; FR-219). Deltas are in words and
 * signs, never colour alone. One polite sentence is announced after each
 * settled recalculation; the tiles themselves are not a live region, so
 * typing never triggers a stream of announcements.
 */

const months = (days: number) => Math.round(Math.abs(days) / 30.4375);

function payoffDelta(days: number): string {
  if (days === 0) return "same payoff date";
  const m = months(days);
  const span = m >= 12 ? `${Math.floor(m / 12)} yr ${m % 12} mo` : m > 0 ? `${m} mo` : `${Math.abs(days)} days`;
  return days < 0 ? `${span} earlier` : `${span} later`;
}

export function headlineSentence(h: Headline, digits: number, frequencyLabel: string): string {
  const repayment = h.regularRepaymentMinor === null ? "no scheduled repayment" : `repayment ${formatAmount(h.regularRepaymentMinor, digits)} ${frequencyLabel}${h.repaymentChanges ? ", changing over the loan" : ""}`;
  return `${repayment}; total repayments ${formatAmount(h.totalRepaidMinor, digits)}; total interest ${formatAmount(h.totalInterestMinor, digits)}; ${h.payoffDate ? `paid off ${formatChartDate(h.payoffDate)}` : "not paid off within the loan term"}.`;
}

function AmountValue({ value }: { value: string }) {
  const parts = value.match(/^(.*)([.,]\d+)$/);
  if (!parts) return value;
  return <>{parts[1]}<span className="text-base">{parts[2]}</span></>;
}

function Tile({ label, labelDetail, value, delta, amount = false }: { label: string; labelDetail?: string; value: string; delta?: string | null; amount?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {label}{labelDetail ? ` (${labelDetail})` : null}
      </span>
      <span className="truncate text-2xl font-semibold leading-tight tabular-nums">{amount ? <AmountValue value={value} /> : value}</span>
      {delta ? <span className="text-[11px] text-muted-foreground">{delta}</span> : null}
    </div>
  );
}

export function HeadlineMetrics({
  headline,
  deltas,
  digits,
  frequencyLabel,
  announce,
  calculating,
}: {
  headline: Headline | null;
  deltas: Deltas | null;
  digits: number;
  frequencyLabel: string;
  /** The settled sentence to announce, or null while inputs are incomplete or calculating. */
  announce: string | null;
  calculating: boolean;
}) {
  const money = (m: number | null) => (m === null ? "None" : formatAmount(m, digits));
  return (
    <section aria-labelledby="headline-heading" className="flex flex-col gap-2">
      <h2 id="headline-heading" className="sr-only">
        Results
      </h2>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-busy={calculating || undefined}>
        <Tile
          label={/^[a-z]+ly$/.test(frequencyLabel) ? `${frequencyLabel.charAt(0).toUpperCase()}${frequencyLabel.slice(1)} repayment` : "Repayment"}
          labelDetail={/^[a-z]+ly$/.test(frequencyLabel) ? undefined : frequencyLabel}
          value={headline ? `${money(headline.regularRepaymentMinor)}` : "–"}
          delta={headline ? [headline.repaymentChanges ? "Changes over the loan" : null, deltas?.repaymentMinor ? `${deltas.repaymentMinor > 0 ? "+" : "−"}${formatAmount(Math.abs(deltas.repaymentMinor), digits)} vs saved` : null].filter(Boolean).join(" · ") : null}
          amount
        />
        <Tile label="Total repayments" value={headline ? money(headline.totalRepaidMinor) : "–"} amount />
        <Tile
          label="Total interest"
          value={headline ? money(headline.totalInterestMinor) : "–"}
          delta={deltas && deltas.interestMinor !== 0 ? `${formatAmount(Math.abs(deltas.interestMinor), digits)} ${deltas.interestMinor < 0 ? "less" : "more"} than saved` : null}
          amount
        />
        <Tile label="Payoff date" value={headline ? (headline.payoffDate ? formatChartDate(headline.payoffDate) : "Not within the term") : "–"} delta={deltas?.payoffDays != null ? payoffDelta(deltas.payoffDays) : null} />
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce ?? ""}
      </p>
    </section>
  );
}
