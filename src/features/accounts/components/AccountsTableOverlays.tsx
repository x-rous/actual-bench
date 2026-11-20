"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AccountPicker, CategoryPicker } from "@/components/ui/entity-picker";
import { useStagedCategories } from "@/hooks/useStagedEntities";
import { useStagedStore } from "@/store/staged";
import type { AccountCloseTransfer } from "@/types/entities";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import {
  buildAccountBulkCloseWarning,
  buildAccountBulkDeleteWarning,
  buildAccountCloseWarning,
  buildAccountDeleteWarning,
} from "@/lib/usageWarnings";

export type AccountDeleteIntent = {
  ids: string[];
  title: string;
  destructiveLabel?: string;
  onConfirm: () => void;
} & (
  | {
      kind: "close";
      label: string;
      balance: number;
      /** The account being closed: a saved account with a balance can move it on close. */
      accountId: string;
      offBudget: boolean;
      canTransfer: boolean;
      /** Called instead of `onConfirm` for a close, with the chosen transfer (or null). */
      onConfirmClose: (transfer: AccountCloseTransfer | null) => void;
    }
  | { kind: "delete"; label: string; balance: number; ruleCount: number }
  | { kind: "bulkClose"; count: number; nonZeroBalanceCount: number }
  | { kind: "bulkDelete"; serverCount: number; newCount: number; nonZeroBalanceCount: number; ruleCount: number }
);

type Props = {
  deleteIntent: AccountDeleteIntent | null;
  onDeleteIntentChange: (intent: AccountDeleteIntent | null) => void;
  inspectId: string | null;
  onInspectIdChange: (id: string | null) => void;
};

/**
 * "Move the balance to": the account that receives a closing account's
 * balance, and the category Actual needs when that moves money out of the
 * budget (an on-budget account into an off-budget one). Optional: without an
 * account the balance stays where it is.
 */
function CloseTransferFields({
  accountId,
  offBudget,
  value,
  onChange,
}: {
  accountId: string;
  offBudget: boolean;
  value: AccountCloseTransfer | null;
  onChange: (value: AccountCloseTransfer | null) => void;
}) {
  const stagedAccounts = useStagedStore((s) => s.accounts);
  const groups = useStagedStore((s) => s.accountGroups);
  const stagedCategories = useStagedStore((s) => s.categories);
  const { groups: categoryGroups } = useStagedCategories();
  // Saved categories only: a draft's id is temporary, and the close would send it to Actual as is.
  const categories = Object.values(stagedCategories)
    .filter((c) => !c.isNew && !c.isDeleted)
    .map((c) => c.entity);
  // Saved, open accounts only: a draft has no transfer payee yet.
  const accounts = Object.values(stagedAccounts)
    .filter((s) => !s.isNew && !s.isDeleted && !s.entity.closed && s.entity.id !== accountId)
    .map((s) => s.entity);
  const target = value ? stagedAccounts[value.transferAccountId]?.entity : undefined;
  const needsCategory = !!target && !offBudget && target.offBudget;
  return (
    <div className="grid gap-3 text-sm">
      <div className="grid gap-1">
        <span id="close-transfer-account" className="text-xs font-medium">Move the balance to (optional)</span>
        <AccountPicker
          ariaLabel="Account that receives the balance"
          ariaDescribedBy="close-transfer-account"
          accounts={accounts}
          groups={Object.values(groups).filter((g) => !g.isDeleted).map((g) => g.entity)}
          closed="exclude"
          allowNone
          noneLabel="Leave the balance in the account"
          value={value?.transferAccountId ?? ""}
          onChange={(id) => onChange(id ? { transferAccountId: id, transferCategoryId: null } : null)}
        />
      </div>
      {needsCategory && (
        <div className="grid gap-1">
          <span id="close-transfer-category" className="text-xs font-medium">Category for the transfer (required)</span>
          <CategoryPicker
            ariaLabel="Category for the balance transfer"
            ariaDescribedBy="close-transfer-category"
            categories={categories}
            groups={categoryGroups}
            side="expense"
            hidden="exclude"
            value={value?.transferCategoryId ?? ""}
            onChange={(id) => value && onChange({ ...value, transferCategoryId: id || null })}
          />
          <p className="text-xs text-muted-foreground">Moving money from an on-budget account to an off-budget one leaves the budget, so Actual records it against a category.</p>
        </div>
      )}
    </div>
  );
}

/** Whether a close transfer is complete: a category is set when the move leaves the budget. */
export function isCloseTransferComplete(
  transfer: AccountCloseTransfer | null,
  closingOffBudget: boolean,
  targetOffBudget: boolean | undefined
): boolean {
  if (!transfer) return true;
  return closingOffBudget || !targetOffBudget || !!transfer.transferCategoryId;
}

export function AccountsTableOverlays({
  deleteIntent,
  onDeleteIntentChange,
  inspectId,
  onInspectIdChange,
}: Props) {
  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "account",
    deleteIntent?.ids ?? [],
    { enabled: !!deleteIntent && deleteIntent.ids.length > 0 }
  );

  // Reset with each dialog: the intent object changes whenever one opens.
  const [closeTransfer, setCloseTransfer] = useState<{ intent: AccountDeleteIntent; value: AccountCloseTransfer | null } | null>(null);
  const transfer = closeTransfer && closeTransfer.intent === deleteIntent ? closeTransfer.value : null;
  const stagedAccounts = useStagedStore((s) => s.accounts);

  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((sum, count) => sum + count, 0) : undefined)
    : 0;

  const confirmState: ConfirmState | null = deleteIntent
    ? (() => {
        const loading = txLoading && deleteIntent.ids.length > 0;
        switch (deleteIntent.kind) {
          case "close": {
            const intent = deleteIntent;
            const showTransfer = intent.canTransfer && intent.balance !== 0;
            const targetOffBudget = transfer ? stagedAccounts[transfer.transferAccountId]?.entity.offBudget : undefined;
            return {
              title: intent.title,
              message: buildAccountCloseWarning(intent.label, intent.balance, txTotal, loading),
              details: showTransfer ? (
                <CloseTransferFields
                  accountId={intent.accountId}
                  offBudget={intent.offBudget}
                  value={transfer}
                  onChange={(value) => setCloseTransfer({ intent, value })}
                />
              ) : undefined,
              confirmDisabled: !isCloseTransferComplete(transfer, intent.offBudget, targetOffBudget),
              onConfirm: () => intent.onConfirmClose(showTransfer ? transfer : null),
              destructiveLabel: transfer ? "Close and move balance" : "Close",
            };
          }
          case "delete":
            return {
              title: deleteIntent.title,
              message: buildAccountDeleteWarning(
                deleteIntent.label,
                deleteIntent.balance,
                deleteIntent.ruleCount,
                txTotal,
                loading
              ),
              onConfirm: deleteIntent.onConfirm,
            };
          case "bulkClose":
            return {
              title: deleteIntent.title,
              message: buildAccountBulkCloseWarning(deleteIntent.count, deleteIntent.nonZeroBalanceCount),
              onConfirm: deleteIntent.onConfirm,
              destructiveLabel: "Close All",
            };
          case "bulkDelete":
            return {
              title: deleteIntent.title,
              message: buildAccountBulkDeleteWarning(
                deleteIntent.serverCount,
                deleteIntent.newCount,
                deleteIntent.nonZeroBalanceCount,
                deleteIntent.ruleCount,
                txTotal,
                loading
              ),
              onConfirm: deleteIntent.onConfirm,
            };
        }
      })()
    : null;

  return (
    <>
      <ConfirmDialog
        open={!!deleteIntent}
        onOpenChange={(open) => {
          if (!open) onDeleteIntentChange(null);
        }}
        state={confirmState}
      />

      <UsageInspectorDrawer
        entityId={inspectId}
        entityType="account"
        open={!!inspectId}
        onOpenChange={(open) => {
          if (!open) onInspectIdChange(null);
        }}
      />
    </>
  );
}
