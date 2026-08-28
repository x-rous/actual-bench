"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewRetention } from "../lib/backupsApi";
import { formatBytes, formatDateTime } from "../lib/presentation";
import type { BackupPolicy } from "@/lib/app-db/backupRepository";
import type { PruneResult } from "@/lib/backup/prune";

/**
 * What retention would do, before it does it (RD-077 / PR-047e).
 *
 * The preview is produced by the same function that performs the prune, not by
 * a second implementation that agrees with it most of the time — so this list
 * *is* what will happen, and every line carries the reason that decided it.
 * Deleting backups is the one action in this feature that cannot be undone, so
 * it is the one that gets shown in full first.
 */
export function RetentionPreviewDialog({
  policy,
  result,
  onClose,
  onApplied,
}: {
  policy: BackupPolicy;
  result: PruneResult;
  onClose: () => void;
  onApplied: () => void;
}) {
  const apply = useMutation({
    mutationFn: () => previewRetention(policy.id, true),
    onSuccess: (applied) => {
      const removed = applied.pruned.filter((entry) => entry.removed).length;
      if (applied.failed > 0) {
        toast.warning(
          `Removed ${removed}; ${applied.failed} copy(ies) could not be deleted and were kept in the inventory.`
        );
      } else if (removed === 0) {
        toast.info("Nothing was eligible to remove.");
      } else {
        toast.success(`Removed ${removed} copy(ies), freeing ${formatBytes(applied.freedBytes)}.`);
      }
      onApplied();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Retention for &ldquo;{policy.name}&rdquo;</DialogTitle>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto text-xs">
          <p className="text-muted-foreground">
            Keeping {result.kept} {result.kept === 1 ? "copy" : "copies"}.{" "}
            {result.pruned.length === 0
              ? "Nothing is eligible to be removed."
              : `${result.pruned.length} would be removed, freeing ${formatBytes(result.freedBytes)}.`}
          </p>

          {result.pruned.length > 0 && (
            <ul className="space-y-1">
              {result.pruned.map((entry) => (
                <li key={entry.artifactId} className="rounded border border-border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{formatDateTime(entry.createdAt)}</span>
                    <span className="text-muted-foreground">{formatBytes(entry.sizeBytes)}</span>
                  </div>
                  <p className="text-muted-foreground">{entry.reason}</p>
                  {entry.locations.length > 0 && (
                    <p className="mt-0.5 break-all text-muted-foreground">
                      {entry.locations.map((location) => location.destinationName).join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {result.pruned.length > 0 && (
            <Button
              size="sm"
              className="text-destructive-foreground"
              variant="destructive"
              onClick={() => apply.mutate()}
              disabled={apply.isPending}
            >
              {apply.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Remove {result.pruned.length}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
