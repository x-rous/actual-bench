"use client";

import { cn } from "@/lib/utils";
import type { ReconciliationCoverage, SideCoverage } from "@/lib/reconciliation/session/build";

/**
 * What happens to the statement, and what sits in Actual on top of it.
 *
 * The useful question is not "what percentage matched" but "of the rows the
 * bank says posted, how many are accounted for, and what does Actual hold
 * beyond them". So each side is shown as its own total broken into parts that
 * sum to it exactly, rather than as two ratios with different denominators
 * that cannot be reconciled by eye.
 */

type Segment = {
  key: string;
  label: string;
  value: number;
  /** Tailwind background for the bar; paired with text, never colour alone. */
  bar: string;
  dot: string;
};

function segmentsFor(side: SideCoverage, unaccountedLabel: string): Segment[] {
  return [
    {
      key: "matched",
      label: "Matched",
      value: side.matched,
      bar: "bg-emerald-500/70",
      dot: "bg-emerald-500/70",
    },
    {
      key: "review",
      label: "Needs review",
      value: side.needsReview,
      bar: "bg-amber-500/70",
      dot: "bg-amber-500/70",
    },
    {
      key: "unaccounted",
      label: unaccountedLabel,
      value: side.unaccounted,
      bar: "bg-sky-500/60",
      dot: "bg-sky-500/60",
    },
  ];
}

function Side({
  title,
  total,
  totalLabel,
  segments,
  note,
}: {
  title: string;
  total: number;
  totalLabel: string;
  segments: Segment[];
  note?: string;
}) {
  const accounted = segments.find((segment) => segment.key === "matched")?.value ?? 0;
  const percent = total === 0 ? 0 : Math.round((accounted / total) * 1000) / 10;

  return (
    <div className="min-w-64 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold">
          {title} <span className="tabular-nums text-muted-foreground">{total}</span>{" "}
          <span className="font-normal text-muted-foreground">{totalLabel}</span>
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">{percent}% matched</span>
      </div>

      <div
        className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${title}: ${segments
          .map((segment) => `${segment.value} ${segment.label.toLowerCase()}`)
          .join(", ")}`}
      >
        {segments.map((segment) =>
          segment.value === 0 ? null : (
            <div
              key={segment.key}
              className={cn("h-full", segment.bar)}
              style={{ width: `${total === 0 ? 0 : (segment.value / total) * 100}%` }}
            />
          )
        )}
      </div>

      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", segment.dot)} aria-hidden="true" />
            <dt className="text-muted-foreground">{segment.label}</dt>
            <dd className="font-medium tabular-nums">{segment.value}</dd>
          </div>
        ))}
      </dl>

      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export function CoverageSummary({ coverage }: { coverage: ReconciliationCoverage }) {
  const { statement, actual, decisions } = coverage;
  const statementOpen = statement.needsReview + statement.unaccounted;
  const needingDecision = decisions.decided + decisions.pending;

  const actualNote = [
    coverage.outsideStatementPeriod > 0
      ? `${coverage.outsideStatementPeriod} dated outside the statement period`
      : null,
    coverage.loadedAsHeadroom > 0
      ? `${coverage.loadedAsHeadroom} more loaded only to help matching`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label="Reconciliation coverage" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Side
          title="Statement"
          total={statement.total}
          totalLabel="rows"
          segments={segmentsFor(statement, "Not in Actual")}
          note={
            statementOpen === 0
              ? "Every statement row is accounted for."
              : `${statementOpen} still need a decision.`
          }
        />
        <Side
          title="Actual"
          total={actual.total}
          totalLabel="transactions in view"
          segments={segmentsFor(actual, "Not on statement")}
          note={actualNote || undefined}
        />
      </div>

      {/*
        Coverage answers "how much of the statement is accounted for". This
        answers "how much is left for me to do", which is the question someone
        working through a reconciliation is actually asking. An automatic match
        is counted apart from both: it never needed deciding, and folding it in
        would flatter the number.
      */}
      {needingDecision > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs">
          <span className="font-medium">
            {decisions.decided} of {needingDecision} decided
          </span>
          {decisions.pending > 0 ? (
            <span className="text-amber-600 dark:text-amber-400">
              {decisions.pending} still to decide
            </span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">
              Everything has been decided
            </span>
          )}
          <span className="text-muted-foreground">
            {decisions.automatic} matched without needing you
          </span>
        </div>
      )}
    </section>
  );
}
