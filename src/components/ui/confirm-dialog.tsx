"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// ─── Shared state type ────────────────────────────────────────────────────────

/**
 * Describes the content and callback for a single confirmation dialog instance.
 * Used as the state type in table components:
 *   const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);
 */
export type ConfirmState = {
  title: string;
  /** Accepts ReactNode — supports plain strings and inline loading/count lines. */
  message: React.ReactNode;
  onConfirm: () => void;
  /** Label for the destructive action button. Defaults to "Delete". */
  destructiveLabel?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current dialog state. May be null while the dialog is animating closed. */
  state: ConfirmState | null;
};

export function ConfirmDialog({ open, onOpenChange, state }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>{state?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              state?.onConfirm();
              onOpenChange(false);
            }}
          >
            {state?.destructiveLabel ?? "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
