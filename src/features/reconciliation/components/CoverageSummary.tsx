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

/**
 * `unaccountedTone` is passed in because the third segment means something
 * different on each side — missing from Actual, versus missing from the
 * statement — and they were sharing a colour while the filters gave them two.
 * Each now matches the filter that selects it.
 */
function segmentsFor(
  side: SideCoverage,
  unaccountedLabel: string,
  unaccountedTone: string
): Segment[] {
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
      bar: unaccountedTone,
      dot: unaccountedTone,
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

/**
 * How much of the work is done, as a compact meter.
 *
 * Separate from coverage, and deliberately small. Coverage answers "how much of
 * the statement is accounted for" and is a composition; this answers "how far
 * through am I", which is the only figure here that climbs to 100% as the user
 * works — so it belongs beside the rows rather than in the header, and it is a
 * short meter rather than a third full-width bar competing with the two above.
 */
export function DecisionProgressMeter({ coverage }: { coverage: ReconciliationCoverage }) {
  const { decisions } = coverage;
  const total = decisions.decided + decisions.pending;
  if (total === 0) return null;

  const percent = Math.round((decisions.decided / total) * 100);

  return (
    <div
      className="flex items-center gap-2 text-xs"
      title={`${decisions.automatic} more matched automatically and needed no decision`}
    >
      <span className="whitespace-nowrap tabular-nums">
        <span className="font-medium">{decisions.decided}</span>
        <span className="text-muted-foreground"> of {total} decided</span>
      </span>
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={decisions.decided}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Rows decided"
      >
        <div
          className={cn(
            "h-full transition-all",
            decisions.pending === 0 ? "bg-emerald-500/70" : "bg-amber-500/70"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {decisions.pending === 0 && (
        <span className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">All decided</span>
      )}
    </div>
  );
}

/**
 * The decision queue, as its own strip.
 *
 * Kept apart from coverage above it because it answers a different question:
 * coverage is what the statement and the account are *made of*, which barely
 * moves as you work, while this is how much of the work is done — the only
 * figure on the screen that climbs to 100% as the user decides rows.
 *
 * Composed from the existing meter rather than recalculated, so there is still
 * one definition of "decided".
 */
export function DecisionProgressStrip({
  coverage,
  onNextUndecided,
  onShowShortcuts,
}: {
  coverage: ReconciliationCoverage;
  onNextUndecided: () => void;
  onShowShortcuts: () => void;
}) {
  const { decisions } = coverage;
  const total = decisions.decided + decisions.pending;

  /*
   * Rendered even when there is nothing to decide. The meter inside it hides
   * itself in that case, but the row's actions must not go with it: a session
   * where everything matched automatically still needs its keyboard help, and
   * a jump control that disappears exactly when the queue empties is a control
   * the user cannot rely on being there.
   */
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="font-semibold text-muted-foreground">Decisions</span>
      {total === 0 ? (
        <span className="text-muted-foreground">Nothing to decide</span>
      ) : (
        <DecisionProgressMeter coverage={coverage} />
      )}
      {decisions.pending > 0 && (
        <span className="tabular-nums text-muted-foreground">{decisions.pending} left</span>
      )}
      {decisions.automatic > 0 && (
        <span className="text-muted-foreground">
          {decisions.automatic} matched automatically
        </span>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onNextUndecided}
          className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Next undecided
          <kbd className="ml-1.5 rounded border border-border px-1 text-[11px]">n</kbd>
        </button>
        <button
          type="button"
          onClick={onShowShortcuts}
          aria-label="Keyboard shortcuts"
          className="inline-flex h-6 items-center rounded-md px-2 transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <kbd className="rounded border border-border px-1 text-[11px]">?</kbd>
        </button>
      </div>
    </div>
  );
}

export function CoverageSummary({ coverage }: { coverage: ReconciliationCoverage }) {
  const { statement, actual } = coverage;

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
          // Named by direction: the two sides answer different questions, and
          // "Statement"/"Actual" alone read as two views of one number.
          title="Statement → Actual"
          total={statement.total}
          totalLabel="rows"
          segments={segmentsFor(statement, "Not in Actual", "bg-sky-500/60")}
          /*
           * No note here. It claimed to count work outstanding, but these
           * segments are classified by *why* a row landed where it did, not by
           * what the user has since decided — so the figure never moved as they
           * worked. The bar and its legend already say what this side is made
           * of, and how much is left to decide is the meter's job.
           */
        />
        <Side
          title="Actual → Statement"
          total={actual.total}
          totalLabel="transactions in view"
          segments={segmentsFor(actual, "Not on statement", "bg-violet-500/60")}
          note={actualNote || undefined}
        />
      </div>
    </section>
  );
}
