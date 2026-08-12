"use client";

import { ArrowRight, Ban, Check, Lock, Pencil, Plus, Split, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { REASON } from "@/lib/reconciliation/session/build";
import { statementText } from "@/lib/reconciliation/statement/text";
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

/**
 * A decision the user has taken outranks the reason the row was flagged.
 *
 * Once someone has said "create this", the row's job is to say what will
 * happen, not to keep restating the problem that prompted it. Leaving the
 * original reason on screen makes decided work look outstanding.
 */
function decidedState(item: ReconciliationItem): MiddleState | null {
  switch (item.disposition) {
    case "create":
      return {
        label: "Will create",
        detail: null,
        tone: "text-sky-600 dark:text-sky-400",
        icon: Plus,
      };
    case "delete":
      return {
        label: "Will delete",
        detail: null,
        tone: "text-destructive",
        icon: Trash2,
      };
    case "keep":
      return { label: "Keep", detail: null, tone: "text-muted-foreground", icon: Check };
    case "correct-amount":
      return {
        label: "Will fix amount",
        detail: null,
        tone: "text-sky-600 dark:text-sky-400",
        icon: Pencil,
      };
    case "ignored":
      return { label: "Ignored", detail: null, tone: "text-muted-foreground", icon: Ban };
    default:
      return null;
  }
}

function middleState(item: ReconciliationItem): MiddleState {
  const decided = decidedState(item);
  if (decided) return decided;

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
    case REASON.amountMismatch:
      return {
        label: "Amount differs",
        detail: null,
        tone: "text-amber-600 dark:text-amber-400",
        icon: TriangleAlert,
      };
    case REASON.sameMerchantDate:
      return {
        label: "Amount looks wrong",
        detail: "Same merchant and date",
        tone: "text-amber-600 dark:text-amber-400",
        icon: TriangleAlert,
      };
    case REASON.merchantCluster:
      return {
        label: "Several here",
        detail: "Same merchant and date, amounts unclear",
        tone: "text-amber-600 dark:text-amber-400",
        icon: TriangleAlert,
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
    -
  </span>
);

export type WorkbenchRowProps = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transactions: ActualTransactionSnapshot[];
  selected: boolean;
  checked: boolean;
  onToggleChecked: (checked: boolean) => void;
  onSelect: () => void;
};

export function WorkbenchRow({
  item,
  statementRow,
  transactions,
  selected,
  checked,
  onToggleChecked,
  onSelect,
}: WorkbenchRowProps) {
  const state = middleState(item);
  const Icon = state.icon;
  const primary = transactions[0];

  // The single strongest reason keeps the row to one line; the inspector shows
  // the full evidence list.
  const topReason = (item.match?.reasons ?? [])
    .filter(
      (reason) =>
        reason.kind === "text" ||
        reason.kind === "reference" ||
        reason.kind === "original-amount" ||
        reason.kind === "amount-mismatch"
    )
    .map(describeReason)
    .filter(Boolean)[0];

  return (
    <tr
      // Addressable so keyboard movement can bring the selected row into view;
      // moving the selection to a row nobody can see is worse than not moving.
      data-item-id={item.id}
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-border/30 text-xs transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/40"
      )}
    >
      <td className="px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggleChecked(event.target.checked)}
          aria-label={
            statementRow
              ? `Select ${statementText(statementRow)}`
              : `Select ${primary?.payeeName ?? "transaction"}`
          }
        />
      </td>

      {/* Bank statement */}
      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
        {statementRow ? formatShortDate(statementRow.postedDate) : EMPTY}
      </td>
      <td
        className="max-w-0 truncate px-2 py-1.5"
        title={
          statementRow
            ? [statementRow.importedPayee, statementRow.bankNotes].filter(Boolean).join(" · ")
            : undefined
        }
      >
        {statementRow ? statementText(statementRow) || EMPTY : EMPTY}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
        {statementRow ? formatMinorUnits(statementRow.amount) : EMPTY}
      </td>

      {/* Match */}
      <td className="border-x border-border/40 px-2 py-1.5">
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
      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
        {primary ? formatShortDate(primary.date) : EMPTY}
      </td>
      <td className="max-w-0 px-2 py-1.5">
        {primary ? (
          <div className="flex items-center gap-1.5">
            <span className="truncate" title={primary.payeeName ?? undefined}>
              {primary.payeeName ?? (
                <span className="text-muted-foreground/70">No payee</span>
              )}
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
            {item.stagedChanges && Object.keys(item.stagedChanges).length > 0 && (
              <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">
                edited
              </span>
            )}
          </div>
        ) : (
          EMPTY
        )}
      </td>
      <td
        className="max-w-0 truncate px-2 py-1.5 text-muted-foreground"
        title={primary?.notes ?? undefined}
      >
        {primary?.notes ?? EMPTY}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
        {primary ? formatMinorUnits(primary.amount) : EMPTY}
      </td>
    </tr>
  );
}
