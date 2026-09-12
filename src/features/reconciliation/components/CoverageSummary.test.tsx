"use client";

import { cleanup, render, screen } from "@testing-library/react";
import type { ReconciliationCoverage } from "@/lib/reconciliation/session/build";
import { DecisionProgressStrip } from "./CoverageSummary";

function coverage(decisions: Partial<ReconciliationCoverage["decisions"]>): ReconciliationCoverage {
  const side = { total: 0, matched: 0, needsReview: 0, unaccounted: 0 };
  return {
    statement: side,
    actual: side,
    decisions: { decided: 0, pending: 0, automatic: 0, ...decisions },
    outsideStatementPeriod: 0,
    likelyDuplicates: 0,
    loadedAsHeadroom: 0,
  };
}

function renderStrip(
  decisions: Partial<ReconciliationCoverage["decisions"]>,
  blockingCount = 0
) {
  render(
    <DecisionProgressStrip
      coverage={coverage(decisions)}
      blockingCount={blockingCount}
      onShowBlocking={() => {}}
      onNextUndecided={() => {}}
    />
  );
}

/*
 * The one figure on this screen that climbs to 100% as the user works. It sat
 * at the far right among the sort and row-count controls, reading as another of
 * the row's small facts rather than as progress.
 */
describe("the decisions progress strip", () => {
  it("carries the count inside the bar, and announces it in words", () => {
    renderStrip({ decided: 12, pending: 30 });

    const bar = screen.getByRole("progressbar", { name: "Rows decided" });
    expect(bar).toHaveTextContent("12 of 42 decided");
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(bar).toHaveAttribute("aria-valuemax", "42");
    // A bare number says nothing about what is being counted.
    expect(bar).toHaveAttribute("aria-valuetext", "12 of 42 decided");
  });

  it("keeps the label in one place, independent of the fill", () => {
    // An overlay across the whole bar rather than something that travels with
    // the fill: the count stays where the eye already is.
    renderStrip({ decided: 12, pending: 30 });

    expect(screen.getAllByText("12 of 42 decided")).toHaveLength(1);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "12 of 42 decided"
    );
  });

  it("fills to the calculated percentage", () => {
    renderStrip({ decided: 12, pending: 30 });
    // 12/42 = 29%. The bar is the only thing on screen that says how far along
    // the work is, so the width has to be the real figure rather than a step.
    const fill = screen.getByRole("progressbar").firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("29%");
  });

  it("squares the leading edge until the work is finished", () => {
    /*
     * A partial bar with both ends fully rounded reads as a finished pill that
     * happens to be short. Keeping the travelling edge nearly square says the
     * fill is cut off mid-travel; at 100% it rounds to match the track and the
     * two edges become one.
     */
    renderStrip({ decided: 12, pending: 30 });
    const partial = screen.getByRole("progressbar").firstElementChild as HTMLElement;
    expect(partial.style.borderRadius).toBe("5px 2px 2px 5px");

    cleanup();
    renderStrip({ decided: 42, pending: 0 });
    const done = screen.getByRole("progressbar").firstElementChild as HTMLElement;
    expect(done.style.borderRadius).toBe("5px");
  });

  it("states progress in figures, not only in colour", () => {
    // The green at the end confirms; it is never the message (WCAG 1.4.1).
    renderStrip({ decided: 42, pending: 0 });
    expect(screen.getByRole("progressbar")).toHaveTextContent("42 of 42 decided");
  });

  it("does not repeat how many are left", () => {
    // Already stated beside the Review button, where it bears on the decision
    // to move on; the bar says the same thing in the form the eye reads faster.
    renderStrip({ decided: 12, pending: 30 });
    expect(screen.queryByText("30 left")).not.toBeInTheDocument();
  });

  it("repeats neither the remainder nor the automatic count", () => {
    /*
     * Both are already on screen: "N left" beside the Review button, and the
     * automatic matches as the coverage bar's Matched segment directly above.
     * Restating them turns this row into a set of figures the reader has to
     * reconcile against each other rather than one reading of where the work
     * stands. The automatic count survives as the bar's tooltip.
     */
    renderStrip({ decided: 2, pending: 1, automatic: 40 });

    expect(screen.queryByText(/matched automatically/)).not.toBeInTheDocument();
    expect(screen.queryByText("1 left")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Rows decided" })).toHaveAttribute(
      "title",
      expect.stringContaining("40")
    );
  });

  it("keeps its actions when there is nothing left to decide", () => {
    // A jump control that disappears exactly when the queue empties is one the
    // user cannot rely on being there.
    renderStrip({ decided: 0, pending: 0, automatic: 0 });

    expect(screen.getByText("Nothing to decide")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next undecided/i })).toBeInTheDocument();
  });

  it("offers the blocking rows as something to click", () => {
    renderStrip({ decided: 0, pending: 8 }, 4);
    expect(screen.getByRole("button", { name: /4 to pair up first/ })).toBeInTheDocument();
  });
});

/*
 * `n` used to jump the queue here while `useKeyboardShortcuts` bound bare `n`
 * to Quick Create on the window. `preventDefault()` there does not stop a
 * sibling listener, so the key did both: the dialog opened and the selection
 * moved behind it.
 */
describe("the queue jump's advertised key", () => {
  it("offers u, not the globally claimed n", () => {
    renderStrip({ decided: 0, pending: 8 });

    const jump = screen.getByRole("button", { name: /next undecided/i });
    // The badge itself, not the button's text - "Next undecided" contains an n.
    const badge = jump.querySelector("kbd");
    expect(badge).toHaveTextContent("u");
    expect(badge).not.toHaveTextContent("n");
  });
});
