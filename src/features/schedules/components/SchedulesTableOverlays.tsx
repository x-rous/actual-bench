"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import { buildScheduleBulkDeleteWarning, buildScheduleDeleteWarning } from "@/lib/usageWarnings";

export type ScheduleDeleteIntent = {
  ids: string[];
  title: string;
  onConfirm: () => void;
  entityLabel?: string;
  ruleId?: string;
  postsTransaction?: boolean;
  bulkCount?: number;
};

type Props = {
  deleteIntent: ScheduleDeleteIntent | null;
  onDeleteIntentChange: (intent: ScheduleDeleteIntent | null) => void;
  inspectId: string | null;
  onInspectIdChange: (id: string | null) => void;
};

export function SchedulesTableOverlays({
  deleteIntent,
  onDeleteIntentChange,
  inspectId,
  onInspectIdChange,
}: Props) {
  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "schedule",
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
          deleteIntent.bulkCount !== undefined
            ? buildScheduleBulkDeleteWarning(
                deleteIntent.bulkCount,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              )
            : buildScheduleDeleteWarning(
                deleteIntent.entityLabel ?? "",
                deleteIntent.ruleId,
                deleteIntent.postsTransaction ?? false,
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
        entityType="schedule"
        open={!!inspectId}
        onOpenChange={(open) => {
          if (!open) onInspectIdChange(null);
        }}
      />
    </>
  );
}
