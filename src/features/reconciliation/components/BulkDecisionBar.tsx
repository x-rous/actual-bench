"use client";

import { Ban, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canStageDelete, canStageField } from "@/lib/reconciliation/session/staging";
import type {
  ActualTransactionSnapshot,
  ReconciliationDisposition,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";

/**
 * Decide many rows at once.
 *
 * Reconciliation is repetitive by nature — fifty fee rows that all need
 * creating, a dozen amounts that all need correcting — and deciding them one at
 * a time is the tedium the feature exists to remove.
 *
 * Two rules keep it safe:
 *
 * 1. **Only offer an action every selected row can take.** A button that
 *    silently skips half the selection teaches the user not to trust the counts,
 *    so each action states how many rows it applies to and why the rest are out.
 * 2. **Choosing between candidates is never bulk.** Picking which of several
 *    transactions a statement row refers to is exactly the judgement that has to
 *    be made row by row.
 */

export type BulkAction = {
  id: string;
  label: string;
  icon: typeof Plus;
  /** Rows this action can act on, of those selected. */
  eligible: ReconciliationItem[];
  /** Why the remaining rows are excluded, when any are. */
  excludedReason: string | null;
  destructive?: boolean;
  run: () => void;
};

export type BulkDecisionBarProps = {
  selected: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  onClear: () => void;
  onBulkDisposition: (itemIds: string[], disposition: ReconciliationDisposition) => void;
  onBulkCorrectAmount: (items: { itemId: string; transactionId: string; amount: number }[]) => void;
};

export function BulkDecisionBar({
  selected,
  statementRows,
  transactions,
  onClear,
  onBulkDisposition,
  onBulkCorrectAmount,
}: BulkDecisionBarProps) {
  if (selected.length === 0) return null;

  // A row can be created when it has a statement row and nothing in Actual.
  const creatable = selected.filter(
    (item) => item.statementRowIds.length > 0 && item.actualTransactionIds.length === 0
  );

  // Keep and ignore apply to anything, but keep only reads sensibly for rows
  // that exist in Actual.
  const keepable = selected.filter((item) => item.actualTransactionIds.length > 0);

  const deletable = selected.filter(
    (item) => item.actualTransactionIds.length > 0 && canStageDelete(item).allowed
  );

  // Correctable rows are those with exactly one candidate whose amount differs
  // from the statement's, and where no guardrail forbids changing it.
  const correctable = selected.flatMap((item) => {
    if (item.actualTransactionIds.length !== 1) return [];
    if (!canStageField(item, "amount").allowed) return [];
    const row = statementRows.get(item.statementRowIds[0] ?? "");
    const transaction = transactions.get(item.actualTransactionIds[0]);
    if (!row || !transaction || row.amount === transaction.amount) return [];
    return [{ itemId: item.id, transactionId: transaction.id, amount: row.amount }];
  });

  const actions: BulkAction[] = [
    {
      id: "create",
      label: "Create in Actual",
      icon: Plus,
      eligible: creatable,
      excludedReason:
        creatable.length < selected.length
          ? `${selected.length - creatable.length} already exist in Actual`
          : null,
      run: () => onBulkDisposition(creatable.map((item) => item.id), "create"),
    },
    {
      id: "correct-amount",
      label: "Use the statement amount",
      icon: Pencil,
      eligible: selected.filter((item) =>
        correctable.some((entry) => entry.itemId === item.id)
      ),
      excludedReason:
        correctable.length < selected.length
          ? `${selected.length - correctable.length} have no differing amount to correct`
          : null,
      run: () => onBulkCorrectAmount(correctable),
    },
    {
      id: "keep",
      label: "Keep",
      icon: Check,
      eligible: keepable,
      excludedReason:
        keepable.length < selected.length
          ? `${selected.length - keepable.length} are not in Actual`
          : null,
      run: () => onBulkDisposition(keepable.map((item) => item.id), "keep"),
    },
    {
      id: "delete",
      label: "Delete from Actual",
      icon: Trash2,
      destructive: true,
      eligible: deletable,
      excludedReason:
        deletable.length < selected.length
          ? `${selected.length - deletable.length} are protected or not in Actual`
          : null,
      run: () => onBulkDisposition(deletable.map((item) => item.id), "delete"),
    },
    {
      id: "ignore",
      label: "Ignore",
      icon: Ban,
      eligible: selected,
      excludedReason: null,
      run: () => onBulkDisposition(selected.map((item) => item.id), "ignored"),
    },
  ];

  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-border/60 bg-background/95 px-4 py-2 backdrop-blur">
      <span className="text-xs font-medium">
        {selected.length} selected
      </span>

      {actions
        .filter((action) => action.eligible.length > 0)
        .map((action) => {
          const Icon = action.icon;
          return (
            <div key={action.id} className="flex flex-col">
              <Button
                size="sm"
                variant={action.destructive ? "outline" : "outline"}
                className={action.destructive ? "text-destructive" : undefined}
                onClick={action.run}
              >
                <Icon className="mr-1 h-3.5 w-3.5" />
                {action.label}
                <span className="ml-1 tabular-nums opacity-70">{action.eligible.length}</span>
              </Button>
              {action.excludedReason && (
                <span className="text-[11px] text-muted-foreground">{action.excludedReason}</span>
              )}
            </div>
          );
        })}

      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        <X className="mr-1 h-3.5 w-3.5" />
        Clear selection
      </Button>
    </div>
  );
}
