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
