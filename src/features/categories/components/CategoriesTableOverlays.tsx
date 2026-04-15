"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import type { EntityUsageData } from "@/features/usage-inspector/types";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import {
  buildCategoryBulkDeleteWarning,
  buildCategoryDeleteWarning,
  buildCategoryGroupDeleteWarning,
} from "@/lib/usageWarnings";

type SingleCategoryDeleteIntent = {
  kind: "single";
  ids: string[];
  title: string;
  onConfirm: () => void;
  entityLabel: string;
  entityRuleCount: number;
};

type GroupCategoryDeleteIntent = {
  kind: "group";
  ids: string[];
  title: string;
  onConfirm: () => void;
  groupName: string;
  childCount: number;
  groupRuleCount: number;
};

type BulkCategoryDeleteIntent = {
  kind: "bulk";
  ids: string[];
  title: string;
  onConfirm: () => void;
  bulkServerCount: number;
  bulkNewCount: number;
  bulkRuleCount: number;
};

export type CategoryDeleteIntent =
  | SingleCategoryDeleteIntent
  | GroupCategoryDeleteIntent
  | BulkCategoryDeleteIntent;

export type CategoryInspectTarget = {
  id: string;
  type: EntityUsageData["entityType"];
};

type Props = {
  deleteIntent: CategoryDeleteIntent | null;
  onDeleteIntentChange: (intent: CategoryDeleteIntent | null) => void;
  inspectTarget: CategoryInspectTarget | null;
  onInspectTargetChange: (target: CategoryInspectTarget | null) => void;
};

export function CategoriesTableOverlays({
  deleteIntent,
  onDeleteIntentChange,
  inspectTarget,
  onInspectTargetChange,
}: Props) {
  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "category",
    deleteIntent?.ids ?? [],
    { enabled: !!deleteIntent && deleteIntent.ids.length > 0 }
  );

  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((sum, count) => sum + count, 0) : undefined)
    : 0;

  const confirmState: ConfirmState | null = deleteIntent
    ? (() => {
        switch (deleteIntent.kind) {
          case "bulk":
            return {
              title: deleteIntent.title,
              message: buildCategoryBulkDeleteWarning(
                deleteIntent.bulkServerCount,
                deleteIntent.bulkNewCount,
                deleteIntent.bulkRuleCount,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              ),
              onConfirm: deleteIntent.onConfirm,
            };
          case "group":
            return {
              title: deleteIntent.title,
              message: buildCategoryGroupDeleteWarning(
                deleteIntent.groupName,
                deleteIntent.childCount,
                deleteIntent.groupRuleCount,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              ),
              onConfirm: deleteIntent.onConfirm,
            };
          case "single":
            return {
              title: deleteIntent.title,
              message: buildCategoryDeleteWarning(
                deleteIntent.entityLabel,
                deleteIntent.entityRuleCount,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
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
        entityId={inspectTarget?.id ?? null}
        entityType={inspectTarget?.type ?? null}
        open={!!inspectTarget}
        onOpenChange={(open) => {
          if (!open) onInspectTargetChange(null);
        }}
      />
    </>
  );
}
