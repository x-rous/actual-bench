"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PayeeMergeCandidate = { id: string; name: string };
export type PayeeMergeState = {
  candidates: PayeeMergeCandidate[];
  targetId: string;
  onConfirm: (targetId: string) => void;
};

type Props = {
  mergeDialog: PayeeMergeState | null;
  onMergeDialogChange: (state: PayeeMergeState | null) => void;
};

export function PayeesMergeDialog({
  mergeDialog,
  onMergeDialogChange,
}: Props) {
  return (
    <Dialog
      open={mergeDialog !== null}
      onOpenChange={(open) => {
        if (!open) onMergeDialogChange(null);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Merge payees</DialogTitle>
          <DialogDescription>
            Select the payee to keep. The others will be merged into it and removed.
            All transactions and rules will be updated automatically.
            This change is staged and can be undone until you save.
          </DialogDescription>
        </DialogHeader>

        {mergeDialog && (
          <div className="flex flex-col gap-1 py-1">
            {mergeDialog.candidates.map((candidate, index) => {
              const isTarget = candidate.id === mergeDialog.targetId;
              return (
                <label
                  key={candidate.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                    isTarget
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border hover:bg-muted/40"
                  )}
                >
                  <input
                    type="radio"
                    name="merge-target"
                    value={candidate.id}
                    checked={isTarget}
                    onChange={() => onMergeDialogChange({ ...mergeDialog, targetId: candidate.id })}
                    className="accent-primary"
                  />
                  <span className="flex-1 truncate">
                    {candidate.name || <em className="text-muted-foreground">empty name</em>}
                  </span>
                  {index === 0 && !isTarget && (
                    <span className="text-[10px] text-muted-foreground">first selected</span>
                  )}
                  {isTarget && (
                    <span className="text-[10px] font-medium text-primary">keep</span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onMergeDialogChange(null)}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => {
              if (mergeDialog) {
                mergeDialog.onConfirm(mergeDialog.targetId);
                onMergeDialogChange(null);
              }
            }}
          >
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
