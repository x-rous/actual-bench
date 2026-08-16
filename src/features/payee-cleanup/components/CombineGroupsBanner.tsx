import { AlertTriangle, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NameCollision } from "../lib/triage";

type Props = {
  collisions: NameCollision[];
  onCombine: (collision: NameCollision) => void;
};

/**
 * Offers to fold groups that would end up with the same name (RD-078 §13).
 *
 * Naming two groups the same thing is the user saying those payees are one
 * merchant — the scan could not see it because the names reduce to different
 * stems. Blocking alone would be technically correct and practically useless:
 * it leaves them to reconcile by hand the thing they already decided.
 *
 * The banner states exactly what combining does before they click, which is the
 * confirmation. No modal: the action is staged-only and every group it touches
 * can be undone individually.
 */
export function CombineGroupsBanner({ collisions, onCombine }: Props) {
  if (collisions.length === 0) return null;

  return (
    <div className="space-y-2">
      {collisions.map((collision) => {
        const payeeCount = collision.suggestions.reduce(
          (total, suggestion) => total + suggestion.cluster.members.length,
          0
        );

        return (
          <div
            key={collision.finalName}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-600/40 bg-amber-500/5 p-3"
          >
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {collision.suggestions.length} groups are all named{" "}
                <span className="font-medium">“{collision.finalName}”</span>. Saving
                them separately would leave {collision.suggestions.length} payees with
                that name.
              </span>
            </p>

            <Button size="sm" variant="outline" onClick={() => onCombine(collision)}>
              <Merge className="size-3.5" aria-hidden="true" />
              Combine into one group ({payeeCount} payees → 1)
            </Button>
          </div>
        );
      })}
    </div>
  );
}
