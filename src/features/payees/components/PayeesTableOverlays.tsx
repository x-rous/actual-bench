"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import { buildPayeeBulkDeleteWarning, buildPayeeDeleteWarning } from "@/lib/usageWarnings";

type SinglePayeeDeleteIntent = {
  kind: "single";
  ids: string[];
  title: string;
  onConfirm: () => void;
  entityLabel: string;
  entityRuleCount: number;
};

type BulkPayeeDeleteIntent = {
  kind: "bulk";
  ids: string[];
  title: string;
  onConfirm: () => void;
  bulkServerCount: number;
  bulkNewCount: number;
  bulkSkippedCount: number;
  bulkRuleCount: number;
};

export type PayeeDeleteIntent = SinglePayeeDeleteIntent | BulkPayeeDeleteIntent;

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
    ? deleteIntent.kind === "bulk"
      ? {
          title: deleteIntent.title,
          message: buildPayeeBulkDeleteWarning(
            deleteIntent.bulkServerCount,
            deleteIntent.bulkNewCount,
            deleteIntent.bulkSkippedCount,
            deleteIntent.bulkRuleCount,
            txTotal,
            txLoading && deleteIntent.ids.length > 0
          ),
          onConfirm: deleteIntent.onConfirm,
        }
      : {
          title: deleteIntent.title,
          message: buildPayeeDeleteWarning(
            deleteIntent.entityLabel,
            deleteIntent.entityRuleCount,
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
