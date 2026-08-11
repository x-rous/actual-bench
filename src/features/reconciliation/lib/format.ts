/**
 * Display helpers for the reconciliation workbench.
 *
 * Amounts arrive as integer minor units and are only ever converted for
 * display — never for arithmetic (AGENTS.md §6).
 */

import type { ConfidenceLabel, MatchReason } from "@/lib/reconciliation/types";

export function formatMinorUnits(minor: number): string {
  const negative = minor < 0;
  const magnitude = Math.abs(minor);
  const whole = Math.trunc(magnitude / 100);
  const fraction = String(magnitude % 100).padStart(2, "0");
  const grouped = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}

/** `03 Jul` — compact, since the workbench shows one statement period. */
export function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * How the recorded amount relates to the statement's, when the two disagree.
 *
 * Surfaced because a *recurring* ratio is diagnostic rather than random: an
 * automation that converts currency with the wrong rate produces the same
 * factor over and over, and seeing `0.375×` on several rows points at the
 * converter rather than at the individual transactions.
 *
 * Returns null when the ratio would not tell the user anything — a tiny
 * difference, or a sign flip that makes the quotient meaningless.
 */
export function amountRatio(
  statementAmount: number,
  actualAmount: number
): string | null {
  if (statementAmount === 0) return null;
  if (Math.sign(statementAmount) !== Math.sign(actualAmount)) return null;

  const ratio = Math.abs(actualAmount) / Math.abs(statementAmount);
  if (ratio > 0.95 && ratio < 1.05) return null;

  // Two significant figures is enough to spot a repeat without implying more
  // precision than a rounded pair of amounts can support.
  return ratio >= 1 ? ratio.toFixed(2).replace(/0$/, "") : ratio.toFixed(3).replace(/0$/, "");
}

export function confidenceLabelText(label: ConfidenceLabel): string {
  switch (label) {
    case "exact":
      return "Exact";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    default:
      return "Low";
  }
}

const TARGET_LABELS: Record<string, string> = {
  payeeName: "Payee",
  importedPayee: "Imported payee",
  notes: "Notes",
};

/**
 * Render one piece of match evidence as text.
 *
 * A text reason always names the field it matched — "Notes 86% similar", not
 * "86% similar". That is what makes a mis-configured profile visible: if every
 * match is carried by notes and none by payee, the user can see it and re-rank.
 */
export function describeReason(reason: MatchReason): string {
  switch (reason.kind) {
    case "amount":
      return "Amount exact";
    case "date": {
      if (reason.deltaDays === 0) return "Date exact";
      const sign = reason.deltaDays > 0 ? "+" : "−";
      const days = Math.abs(reason.deltaDays);
      return `Date ${sign}${days} day${days === 1 ? "" : "s"}`;
    }
    case "text":
      return `${TARGET_LABELS[reason.field] ?? reason.field} ${Math.round(
        reason.similarity * 100
      )}% similar`;
    case "text-skipped": {
      const field = TARGET_LABELS[reason.field] ?? reason.field;
      if (reason.why === "empty") return `${field} not compared (empty)`;
      if (reason.why === "below-needle-floor") {
        return `${field} not compared (statement text too generic)`;
      }
      return `${field} not compared (no statement text)`;
    }
    case "reference":
      return reason.where === "importedId"
        ? "Bank reference matches the imported ID"
        : "Bank reference found in notes";
    case "amount-mismatch": {
      const difference = Math.abs(reason.difference);
      const ratio = amountRatio(reason.statementAmount, reason.actualAmount);
      return (
        `Amount differs by ${formatMinorUnits(difference)} ` +
        `(statement ${formatMinorUnits(Math.abs(reason.statementAmount))}, ` +
        `Actual ${formatMinorUnits(Math.abs(reason.actualAmount))}` +
        (ratio ? ` - recorded ${ratio}× the statement` : "") +
        ")"
      );
    }
    case "original-amount":
      // The posted amount is a conversion; the match is on the original amount
      // the bank printed, so say so rather than implying the amounts agree.
      return `Original amount ${reason.currency} ${formatMinorUnits(
        Math.abs(reason.amount)
      )} exact (posted ${formatMinorUnits(Math.abs(reason.postedAmount))})`;
    default:
      return "";
  }
}
