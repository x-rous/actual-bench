"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  | { kind: "close"; label: string; balance: number }
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

  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((sum, count) => sum + count, 0) : undefined)
    : 0;

  const confirmState: ConfirmState | null = deleteIntent
    ? (() => {
        const loading = txLoading && deleteIntent.ids.length > 0;
        switch (deleteIntent.kind) {
          case "close":
            return {
              title: deleteIntent.title,
              message: buildAccountCloseWarning(deleteIntent.label, deleteIntent.balance, txTotal, loading),
              onConfirm: deleteIntent.onConfirm,
              destructiveLabel: "Close",
            };
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
