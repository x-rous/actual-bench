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

      {/*
        The note joins the legend rather than taking a line beneath it.
        
        It is the same kind of thing as the entries beside it — a count and what
        it is — and the legend already wraps, so it costs nothing here and cost a
        whole row before. It reads as the qualifier it is, next to the totals it
        qualifies, instead of as a footnote to the bar.
      */}
      <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", segment.dot)} aria-hidden="true" />
            <dt className="text-muted-foreground">{segment.label}</dt>
            <dd className="font-medium tabular-nums">{segment.value}</dd>
          </div>
        ))}
        {note && (
          <span className="text-[11px] text-muted-foreground">{note}</span>
        )}
      </dl>
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
  const complete = decisions.pending === 0;
  const label = `${decisions.decided} of ${total} decided`;

  /*
   * One centred label over a filled track.
   *
   * The label is an overlay across the whole bar, independent of how far the
   * fill has travelled, so the count never moves as the work progresses.
   *
   * **The bar keeps its own surface in both themes**, which is why these are
   * literals rather than theme tokens. `#171717` happens to equal `--primary`
   * in light mode, but `--primary` inverts to a near-white in dark — and the
   * track does not — so the token is only equivalent in one theme, which makes
   * it the wrong thing to reach for. Fixing the surface is what keeps the label
   * legible wherever the fill happens to end:
   *
   *   #171717 on the track   #E8EAEC   14.9:1
   *   #171717 on the fill    #F2AE33    9.3:1
   *   #171717 when complete  #2FC694    8.2:1
   *
   * The fills are a step deeper than the first pass, which read washed out
   * against the track. There is room for that: the label clears 4.5:1 by a
   * wide margin, so saturation can be spent on making the fill legible from a
   * distance rather than held back for contrast that is not at risk.
   *
   * The fill's right-hand corners stay nearly square while it is short of the
   * end, so a partial bar reads as cut off mid-travel rather than as a finished
   * pill; at 100% they round to match the track and the two edges become one.
   */
  return (
    <div
      className="relative h-[22px] w-[220px] overflow-hidden rounded-[5px] bg-[#E8EAEC]"
      role="progressbar"
      aria-valuenow={decisions.decided}
      aria-valuemin={0}
      aria-valuemax={total}
      // Read out as words rather than a bare number, which on its own says
      // nothing about what is being counted.
      aria-valuetext={label}
      aria-label="Rows decided"
      title={
        decisions.automatic > 0
          ? `${decisions.automatic} more matched automatically and needed no decision`
          : undefined
      }
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width,border-radius] duration-[250ms] ease-out motion-reduce:transition-none"
        style={{
          width: `${percent}%`,
          backgroundColor: complete ? "#2FC694" : "#F2AE33",
          borderRadius: complete ? "5px" : "5px 2px 2px 5px",
        }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium tabular-nums text-[#171717]">
        {label}
      </span>
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
  blockingCount = 0,
  onShowBlocking,
  onNextUndecided,
}: {
  coverage: ReconciliationCoverage;
  /**
   * Rows whose resolution changes what the rows around them mean.
   *
   * Named rather than left implicit because the order matters: deciding a
   * dependent row before its determinant is how a duplicate gets created of a
   * transaction the next decision would have freed.
   */
  blockingCount?: number;
  /** Narrow the grid to those rows. */
  onShowBlocking?: () => void;
  onNextUndecided: () => void;
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
      <span className="text-muted-foreground">Decisions Progress</span>
      {total === 0 ? (
        <span className="text-muted-foreground">Nothing to decide</span>
      ) : (
        <DecisionProgressMeter coverage={coverage} />
      )}
      {/*
        Neither "how many are left" nor "how many matched automatically" appears
        here. The first is stated beside the Review button, where it bears on the
        decision to move on; the second is the coverage bar's Matched segment,
        directly above. Repeating either turns the row into a list of figures the
        reader has to reconcile against each other rather than a single reading
        of where the work stands. The automatic count survives as the bar's
        tooltip, which is where a qualifier belongs.
      */}
      {blockingCount > 0 && (
        // A button, not a badge. It names a set of rows, so the obvious thing to
        // do with it is look at them — and a count that cannot be clicked is a
        // fact the reader has to go and act on somewhere else.
        <button
          type="button"
          onClick={onShowBlocking}
          className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[11px] tabular-nums text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
          title="Several rows are competing for the same transactions. Settling these frees the rest, so they are what Next undecided visits first."
        >
          {blockingCount} to pair up first
        </button>
      )}

      <button
        type="button"
        onClick={onNextUndecided}
        className="inline-flex h-6 items-center rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        Next undecided
        <kbd className="ml-1.5 rounded border border-border px-1 text-[11px]">u</kbd>
      </button>
    </div>
  );
}

/**
 * The keyboard help, split out of the progress strip.
 *
 * It belongs at the far end of the toolbar rather than in the middle of the
 * decision figures: it is about the screen, not about this session's progress,
 * and sitting among the counts it read as one more of them.
 */
export function ShortcutsButton({ onShow }: { onShow: () => void }) {
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label="Keyboard shortcuts"
      className="inline-flex h-6 items-center rounded-md px-2 transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <kbd className="rounded border border-border px-1 text-[11px]">?</kbd>
    </button>
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
