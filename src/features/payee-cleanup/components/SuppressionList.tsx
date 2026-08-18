import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PayeeCleanupSuppressionRecord } from "@/lib/app-db/types";

type Props = {
  suppressions: PayeeCleanupSuppressionRecord[];
  onUndo: (id: string) => void;
  onClearAll: () => void;
};

/**
 * The decisions the user has already made (RD-078 §14, M7).
 *
 * A suppression hides a suggestion permanently, so it needs to be visible and
 * reversible — otherwise a mis-click quietly removes a real duplicate from
 * every future scan and there is no way to find out why.
 */
export function SuppressionList({ suppressions, onUndo, onClearAll }: Props) {
  // Two-step rather than one click. Undoing a single row is reversible; clearing
  // the list discards every decision the user has made about this budget and
  // cannot be recovered from anywhere.
  const [confirming, setConfirming] = useState(false);

  if (suppressions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        You haven&apos;t dismissed any suggestions yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          These are hidden from your suggestions. Undo one to see it again.
        </p>
        {confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-xs text-muted-foreground">
              Clear all {suppressions.length}?
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onClearAll();
              }}
            >
              Clear all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Clear all
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border/40 rounded-md border border-border/70">
        {suppressions.map((suppression) => (
          <li
            key={suppression.id}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="break-words">
                {suppression.normalizedNames.join("  ·  ")}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {suppression.kind === "rejected-affix"
                  ? "kept as part of the name"
                  : suppression.kind === "rule-not-needed"
                    ? "no rule needed"
                    : "not duplicates"}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Undo: ${suppression.normalizedNames.join(", ")}`}
              onClick={() => onUndo(suppression.id)}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              Undo
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
