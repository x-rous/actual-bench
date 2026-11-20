"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PayeePicker } from "@/components/ui/entity-picker";
import { useStagedStore } from "@/store/staged";
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
  /** A saved payee can be merged into another instead, keeping its transactions' payee. */
  payeeId?: string;
  /** Called instead of `onConfirm` when a payee to merge into was chosen. */
  onMergeInto?: (targetId: string) => void;
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

  // Reset with each dialog: the intent object changes whenever one opens.
  const [mergeChoice, setMergeChoice] = useState<{ intent: PayeeDeleteIntent; id: string } | null>(null);
  const mergeTargetId = mergeChoice && mergeChoice.intent === deleteIntent ? mergeChoice.id : "";
  const stagedPayees = useStagedStore((s) => s.payees);

  const baseState: ConfirmState | null = deleteIntent
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

  // Deleting a payee leaves its transactions without one; merging moves them
  // (and its rules) to another payee. Offered once the payee is known to be used.
  const single = deleteIntent?.kind === "single" ? deleteIntent : null;
  const offerMerge = !!single?.payeeId && !!single.onMergeInto && (txTotal ?? 0) > 0;
  const confirmState: ConfirmState | null = baseState && single && offerMerge
    ? {
        ...baseState,
        details: (
          <div className="grid gap-1 text-sm">
            <span id="payee-merge-instead" className="text-xs font-medium">Merge into another payee instead (optional)</span>
            <PayeePicker
              ariaLabel="Payee to merge into instead of deleting"
              ariaDescribedBy="payee-merge-instead"
              payees={Object.values(stagedPayees)
                .filter((p) => !p.isNew && !p.isDeleted && !p.entity.transferAccountId && p.entity.id !== single.payeeId)
                .map((p) => p.entity)}
              transfers="exclude"
              allowNone
              noneLabel="Delete without merging"
              value={mergeTargetId}
              onChange={(id) => setMergeChoice({ intent: single, id })}
            />
            <p className="text-xs text-muted-foreground">Merging moves this payee&apos;s transactions and rules to the chosen payee, then removes this one.</p>
          </div>
        ),
        onConfirm: mergeTargetId ? () => single.onMergeInto!(mergeTargetId) : baseState.onConfirm,
        destructiveLabel: mergeTargetId ? "Merge" : baseState.destructiveLabel,
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
