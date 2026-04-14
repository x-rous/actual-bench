"use client";

import { useState } from "react";
import type { ConfirmState } from "@/components/ui/confirm-dialog";

type UseDrawerCloseGuardOptions = {
  isDirty: boolean;
  onClose: () => void;
  title: string;
  message: string;
  destructiveLabel?: string;
};

/**
 * Shared close/discard lifecycle for editable drawers.
 *
 * Keeps the unsaved-change confirmation policy consistent while leaving
 * save/delete behavior in the feature layer.
 */
export function useDrawerCloseGuard({
  isDirty,
  onClose,
  title,
  message,
  destructiveLabel = "Discard",
}: UseDrawerCloseGuardOptions) {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);

  function closeNow() {
    setConfirmDialog(null);
    onClose();
  }

  function requestClose(afterDiscard?: () => void) {
    if (!isDirty) {
      closeNow();
      afterDiscard?.();
      return;
    }

    setConfirmDialog({
      title,
      message,
      destructiveLabel,
      onConfirm: () => {
        closeNow();
        afterDiscard?.();
      },
    });
  }

  function handleOpenChange(nextOpen: boolean, onOpen?: () => void) {
    if (nextOpen) {
      onOpen?.();
      return;
    }

    requestClose();
  }

  return {
    confirmDialog,
    setConfirmDialog,
    closeNow,
    requestClose,
    handleOpenChange,
  };
}
