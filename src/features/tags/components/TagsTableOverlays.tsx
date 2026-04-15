"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";

type Props = {
  confirmDialog: ConfirmState | null;
  onConfirmDialogChange: (state: ConfirmState | null) => void;
  inspectId: string | null;
  onInspectIdChange: (id: string | null) => void;
};

export function TagsTableOverlays({
  confirmDialog,
  onConfirmDialogChange,
  inspectId,
  onInspectIdChange,
}: Props) {
  return (
    <>
      <ConfirmDialog
        open={confirmDialog !== null}
        onOpenChange={(open) => {
          if (!open) onConfirmDialogChange(null);
        }}
        state={confirmDialog}
      />

      <UsageInspectorDrawer
        entityId={inspectId}
        entityType="tag"
        open={!!inspectId}
        onOpenChange={(open) => {
          if (!open) onInspectIdChange(null);
        }}
      />
    </>
  );
}
