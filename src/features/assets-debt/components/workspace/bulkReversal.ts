import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import type { ChangeRowModel } from "./changeRows";

export type ReversalAction = "undo" | "unsplit";

export function canPrepareReversal(row: ChangeRowModel, action: ReversalAction): boolean {
  return row.selectable === "reverse" && row.posting?.status === "applied"
    && !row.posting.reversalOf && (action === "undo" || (row.posting.output.kind === "claim" && !!row.posting.output.recordedSplit));
}

/** Prepare proposals only, newest first. Preserve partial success and stop on the first refusal. */
export async function prepareBulkReversal(
  rows: readonly ChangeRowModel[], action: ReversalAction,
  propose: (posting: PostingView) => Promise<PostingView>,
): Promise<{ prepared: ChangeRowModel[]; stopped: { row: ChangeRowModel; reason: string } | null; remaining: number }> {
  if (!rows.length || !rows.every((row) => canPrepareReversal(row, action))) throw new Error("Select only applied changes eligible for this action.");
  const ordered = [...rows].sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const prepared: ChangeRowModel[] = [];
  for (const [index, row] of ordered.entries()) {
    try {
      await propose(row.posting!);
      prepared.push(row);
    } catch (error) {
      return { prepared, stopped: { row, reason: error instanceof Error ? error.message : String(error) }, remaining: ordered.length - index - 1 };
    }
  }
  return { prepared, stopped: null, remaining: 0 };
}
