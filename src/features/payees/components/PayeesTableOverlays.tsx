"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import { buildPayeeBulkDeleteWarning, buildPayeeDeleteWarning } from "@/lib/usageWarnings";

export type PayeeDeleteIntent = {
  ids: string[];
  title: string;
  onConfirm: () => void;
  entityLabel?: string;
  entityRuleCount?: number;
  bulkServerCount?: number;
  bulkNewCount?: number;
  bulkSkippedCount?: number;
  bulkRuleCount?: number;
};

type Props = {
  deleteIntent: PayeeDeleteIntent | null;
  onDeleteIntentChange: (intent: PayeeDeleteIntent | null) => void;
  inspectId: string | null;
  onInspectIdChange: (id: string | null) => void;
};

export function PayeesTableOverlays({
  deleteIntent,
  onDeleteIntentChange,
  inspectId,
  onInspectIdChange,
}: Props) {
  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "payee",
    deleteIntent?.ids ?? [],
    { enabled: !!deleteIntent && deleteIntent.ids.length > 0 }
  );

  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((sum, count) => sum + count, 0) : undefined)
    : 0;

  const confirmState: ConfirmState | null = deleteIntent
    ? {
        title: deleteIntent.title,
        message:
          deleteIntent.bulkServerCount !== undefined
            ? buildPayeeBulkDeleteWarning(
                deleteIntent.bulkServerCount,
                deleteIntent.bulkNewCount ?? 0,
                deleteIntent.bulkSkippedCount ?? 0,
                deleteIntent.bulkRuleCount ?? 0,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              )
            : buildPayeeDeleteWarning(
                deleteIntent.entityLabel ?? "",
                deleteIntent.entityRuleCount ?? 0,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              ),
        onConfirm: deleteIntent.onConfirm,
      }
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
        entityType="payee"
        open={!!inspectId}
        onOpenChange={(open) => {
          if (!open) onInspectIdChange(null);
        }}
      />
    </>
  );
}
