"use client";

import { formatAmount } from "../../lib/money";
import type { Deltas, Headline } from "../../lib/results";

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
  return `${repayment}; total repayments ${formatAmount(h.totalRepaidMinor, digits)}; total interest ${formatAmount(h.totalInterestMinor, digits)}; ${h.payoffDate ? `paid off ${h.payoffDate}` : "not paid off within the loan term"}.`;
}

function Tile({ label, value, delta }: { label: string; value: string; delta?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate text-lg font-semibold tabular-nums">{value}</span>
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
          label="Repayment"
          value={headline ? `${money(headline.regularRepaymentMinor)}` : "–"}
          delta={headline ? [frequencyLabel, headline.repaymentChanges ? "changes over the loan" : null, deltas?.repaymentMinor ? `${deltas.repaymentMinor > 0 ? "+" : "−"}${formatAmount(Math.abs(deltas.repaymentMinor), digits)} vs saved` : null].filter(Boolean).join(" · ") : null}
        />
        <Tile label="Total repayments" value={headline ? money(headline.totalRepaidMinor) : "–"} />
        <Tile
          label="Total interest"
          value={headline ? money(headline.totalInterestMinor) : "–"}
          delta={deltas && deltas.interestMinor !== 0 ? `${formatAmount(Math.abs(deltas.interestMinor), digits)} ${deltas.interestMinor < 0 ? "less" : "more"} than saved` : null}
        />
        <Tile label="Payoff date" value={headline ? (headline.payoffDate ?? "Not within the term") : "–"} delta={deltas?.payoffDays != null ? payoffDelta(deltas.payoffDays) : null} />
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce ?? ""}
      </p>
    </section>
  );
}
