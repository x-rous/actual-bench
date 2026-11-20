"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CategoryPicker } from "@/components/ui/entity-picker";
import { useStagedStore } from "@/store/staged";
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

/**
 * Offered when saved categories with transactions or budget amounts are being
 * deleted: a category that takes them over, as Actual's own delete offers.
 */
export type CategoryDeleteTransfer = {
  side: "expense" | "income";
  /** Categories being deleted here, which cannot receive the transfer. */
  excludeIds: string[];
  /** Called instead of `onConfirm`, with the chosen category (or null). */
  onConfirm: (transferCategoryId: string | null) => void;
};

export type CategoryDeleteIntent = (
  | SingleCategoryDeleteIntent
  | GroupCategoryDeleteIntent
  | BulkCategoryDeleteIntent
) & { transfer?: CategoryDeleteTransfer };

function DeleteTransferField({
  transfer,
  value,
  onChange,
}: {
  transfer: CategoryDeleteTransfer;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const stagedCategories = useStagedStore((s) => s.categories);
  const stagedGroups = useStagedStore((s) => s.categoryGroups);
  const excluded = new Set(transfer.excludeIds);
  // Saved categories only: a draft has no id Actual knows yet.
  const categories = Object.values(stagedCategories)
    .filter((c) => !c.isNew && !c.isDeleted && !excluded.has(c.entity.id))
    .map((c) => c.entity);
  const groups = Object.values(stagedGroups).filter((g) => !g.isDeleted).map((g) => g.entity);
  return (
    <div className="grid gap-1 text-sm">
      <span id="category-delete-transfer" className="text-xs font-medium">Move transactions and budget amounts to (optional)</span>
      <CategoryPicker
        ariaLabel="Category that takes over transactions and budget amounts"
        ariaDescribedBy="category-delete-transfer"
        categories={categories}
        groups={groups}
        side={transfer.side}
        allowNone
        noneLabel="Leave transactions uncategorized"
        value={value ?? ""}
        onChange={(id) => onChange(id || null)}
      />
    </div>
  );
}

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

  // Reset with each dialog: the intent object changes whenever one opens.
  const [chosen, setChosen] = useState<{ intent: CategoryDeleteIntent; id: string | null } | null>(null);
  const transferId = chosen && chosen.intent === deleteIntent ? chosen.id : null;

  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((sum, count) => sum + count, 0) : undefined)
    : 0;

  const baseState: ConfirmState | null = deleteIntent
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
  const intent = deleteIntent;
  const confirmState: ConfirmState | null = baseState && intent?.transfer
    ? {
        ...baseState,
        details: (
          <DeleteTransferField
            transfer={intent.transfer}
            value={transferId}
            onChange={(id) => setChosen({ intent, id })}
          />
        ),
        onConfirm: () => intent.transfer!.onConfirm(transferId),
      }
    : baseState;

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
