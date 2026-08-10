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
 * One reconciliation relationship, rendered as a single row across three
 * columns (UX §7).
 *
 * This is deliberately one synchronized table rather than two independently
 * scrolling lists: the moment one side is missing a transaction, independent
 * scrolling breaks the visual correspondence and the user can no longer tell
 * what lines up with what (UX §8).
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
        detail: "No matching transaction found",
        tone: "text-sky-600 dark:text-sky-400",
        icon: Plus,
      };
    case REASON.notOnStatement:
      return {
        label: "Actual only",
        detail: "Not on this statement",
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

  // Match reasons carry the "why", including which field the text matched.
  const reasonText = (item.match?.reasons ?? [])
    .map(describeReason)
    .filter(Boolean)
    .slice(0, 3);

  return (
    <tr
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-border/30 align-top text-xs transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/40"
      )}
    >
      {/* Bank statement */}
      <td className="px-3 py-2">
        {statementRow ? (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums text-muted-foreground">
              {formatShortDate(statementRow.postedDate)}
            </span>
            <span className="truncate font-medium">{statementRow.description}</span>
            <span className="tabular-nums">{formatMinorUnits(statementRow.amount)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground" aria-label="No statement row">
            —
          </span>
        )}
      </td>

      {/* Match */}
      <td className="px-3 py-2">
        <div className={cn("flex items-center gap-1 font-medium", state.tone)}>
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span>{state.label}</span>
        </div>
        {state.detail && <p className="mt-0.5 text-muted-foreground">{state.detail}</p>}
        {reasonText.length > 0 && (
          <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
            {reasonText.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </td>

      {/* Actual */}
      <td className="px-3 py-2">
        {primary ? (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums text-muted-foreground">
              {formatShortDate(primary.date)}
            </span>
            <span className="truncate font-medium">{primary.payeeName ?? "No payee"}</span>
            <span className="tabular-nums">{formatMinorUnits(primary.amount)}</span>

            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {item.guards.protectedReconciled && (
                <span className="flex items-center gap-0.5">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Reconciled
                </span>
              )}
              {item.guards.splitParent && (
                <span className="flex items-center gap-0.5">
                  <Split className="h-3 w-3" aria-hidden="true" />
                  {primary.splitLines.length} splits
                </span>
              )}
              {item.guards.transfer === "yes" && <span>Transfer</span>}
              {transactions.length > 1 && <span>{transactions.length} candidates</span>}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground" aria-label="No Actual transaction">
            —
          </span>
        )}
      </td>
    </tr>
  );
}
