"use client";

import { ArrowRight, Lock, Plus, Split, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { REASON } from "@/lib/reconciliation/session/build";
import { confidenceLabelText, describeReason, formatMinorUnits, formatShortDate } from "../lib/format";

/**
 * One reconciliation relationship as a single table row.
 *
 * Laid out horizontally — date, description and amount are their own columns on
 * each side — so a row occupies one line and a day's transactions can be
 * scanned down the page. Stacking the three facts vertically tripled the row
 * height and made it hard to compare the two sides at a glance.
 *
 * It remains one synchronized table rather than two independently scrolling
 * lists: the moment one side is missing a transaction, independent scrolling
 * breaks the visual correspondence (UX §8).
 */

type MiddleState = {
  label: string;
  detail: string | null;
  tone: string;
  icon: typeof ArrowRight | null;
};

function middleState(item: ReconciliationItem): MiddleState {
  if (item.disposition === "matched") {
    const confidence = item.match?.confidence;
    const label = item.match ? confidenceLabelText(item.match.label) : "Matched";
    return {
      label: confidence != null && item.match?.label !== "exact" ? `${confidence}% ${label}` : label,
      detail: null,
      tone: "text-emerald-600 dark:text-emerald-400",
      icon: ArrowRight,
    };
  }

  switch (item.reasonCode) {
    case REASON.ambiguousMatch:
      return {
        label: "Needs review",
        detail: "Several equally likely matches",
        tone: "text-amber-600 dark:text-amber-400",
        icon: TriangleAlert,
      };
    case REASON.belowConfidenceFloor:
      return {
        label: "Needs review",
        detail: "No candidate confident enough",
        tone: "text-amber-600 dark:text-amber-400",
        icon: TriangleAlert,
      };
    case REASON.noActualCandidate:
      return {
        label: "Not in Actual",
        detail: null,
        tone: "text-sky-600 dark:text-sky-400",
        icon: Plus,
      };
    case REASON.outsideStatementPeriod:
      return {
        label: "Outside period",
        detail: null,
        tone: "text-muted-foreground",
        icon: null,
      };
    case REASON.notOnStatement:
      return {
        label: "Actual only",
        detail: null,
        tone: "text-muted-foreground",
        icon: null,
      };
    case REASON.likelyDuplicate:
      return {
        label: "Likely duplicate",
        detail: "Another transaction matches too",
        tone: "text-amber-600 dark:text-amber-400",
        icon: TriangleAlert,
      };
    default:
      return { label: "Unresolved", detail: null, tone: "text-muted-foreground", icon: null };
  }
}

const EMPTY = (
  <span className="text-muted-foreground/60" aria-hidden="true">
    —
  </span>
);

export type WorkbenchRowProps = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transactions: ActualTransactionSnapshot[];
  selected: boolean;
  onSelect: () => void;
};

export function WorkbenchRow({
  item,
  statementRow,
  transactions,
  selected,
  onSelect,
}: WorkbenchRowProps) {
  const state = middleState(item);
  const Icon = state.icon;
  const primary = transactions[0];

  // The single strongest reason keeps the row to one line; the inspector shows
  // the full evidence list.
  const topReason = (item.match?.reasons ?? [])
    .filter((reason) => reason.kind === "text" || reason.kind === "reference" || reason.kind === "original-amount")
    .map(describeReason)
    .filter(Boolean)[0];

  return (
    <tr
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-border/30 text-xs transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/40"
      )}
    >
      {/* Bank statement */}
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
        {statementRow ? formatShortDate(statementRow.postedDate) : EMPTY}
      </td>
      <td className="max-w-0 truncate px-3 py-1.5" title={statementRow?.description}>
        {statementRow ? statementRow.description : EMPTY}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
        {statementRow ? formatMinorUnits(statementRow.amount) : EMPTY}
      </td>

      {/* Match */}
      <td className="border-x border-border/40 px-3 py-1.5">
        <div className={cn("flex items-center gap-1 font-medium", state.tone)}>
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{state.label}</span>
        </div>
        {(state.detail || topReason) && (
          <p className="truncate text-[11px] text-muted-foreground" title={topReason ?? undefined}>
            {state.detail ?? topReason}
          </p>
        )}
      </td>

      {/* Actual */}
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
        {primary ? formatShortDate(primary.date) : EMPTY}
      </td>
      <td className="max-w-0 px-3 py-1.5">
        {primary ? (
          <div className="flex items-center gap-1.5">
            <span className="truncate" title={primary.notes ?? primary.payeeName ?? undefined}>
              {primary.payeeName ?? primary.notes ?? "No payee"}
            </span>
            {item.guards.protectedReconciled && (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Reconciled" />
            )}
            {item.guards.splitParent && (
              <Split
                className="h-3 w-3 shrink-0 text-muted-foreground"
                aria-label={`${primary.splitLines.length} splits`}
              />
            )}
            {item.guards.transfer === "yes" && (
              <span className="shrink-0 text-[11px] text-muted-foreground">Transfer</span>
            )}
            {transactions.length > 1 && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                +{transactions.length - 1}
              </span>
            )}
          </div>
        ) : (
          EMPTY
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
        {primary ? formatMinorUnits(primary.amount) : EMPTY}
      </td>
    </tr>
  );
}
