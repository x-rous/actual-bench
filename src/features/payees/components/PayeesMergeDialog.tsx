"use client";

import { useMemo } from "react";
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
import { useStagedStore } from "@/store/staged";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";

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
  const stagedRules = useStagedStore((s) => s.rules);

  const payeeRuleCount = useMemo(
    () => buildRuleReferenceMap(stagedRules, ["payee", "imported_payee"]),
    [stagedRules]
  );

  const candidateIds = useMemo(
    () => mergeDialog?.candidates.map((c) => c.id) ?? [],
    [mergeDialog]
  );

  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "payee",
    candidateIds,
    { enabled: mergeDialog !== null }
  );

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
              const txCount = txCounts?.get(candidate.id) ?? 0;
              const ruleCount = payeeRuleCount.get(candidate.id) ?? 0;

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
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      {candidate.name || <em className="text-muted-foreground">empty name</em>}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {txLoading
                        ? "loading…"
                        : `${txCount} transaction${txCount !== 1 ? "s" : ""} · ${ruleCount} rule${ruleCount !== 1 ? "s" : ""}`}
                    </span>
                  </span>
                  {index === 0 && !isTarget && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">first selected</span>
                  )}
                  {isTarget && (
                    <span className="shrink-0 text-[10px] font-medium text-primary">keep</span>
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
