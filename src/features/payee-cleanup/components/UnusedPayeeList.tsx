import type { OrphanPayee } from "../lib/orphans";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Props = {
  orphans: OrphanPayee[];
  filtered?: boolean;
  selectedPayeeIds: Set<string>;
  onSelectAllChange: (selected: boolean) => void;
  onDeletionChange: (payeeId: string, selected: boolean) => void;
};

/**
 * Payees with nothing pointing at them (RD-078 §19).
 *
 * The copy states plainly that Actual Bench applies its own check and that the
 * check is stricter than Actual's, because a user comparing this list against
 * Actual's own "unused" view deserves to know why they might differ.
 */
export function UnusedPayeeList({
  orphans,
  filtered = false,
  selectedPayeeIds,
  onSelectAllChange,
  onDeletionChange,
}: Props) {
  if (orphans.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        {filtered
          ? "No unused payees match your search."
          : "No unused payees. Everything is referenced by a transaction or a rule."}
      </p>
    );
  }

  const allSelected = orphans.every(({ payee }) => selectedPayeeIds.has(payee.id));
  const selectAllLabel = allSelected
    ? filtered
      ? "Clear visible selection"
      : "Clear selection"
    : filtered
      ? "Select all visible"
      : "Select all";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          These payees have no transactions or rule references. Bench also checks
          rule actions, so it may be more cautious than Actual. Select payees to
          include in the cleanup plan.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSelectAllChange(!allSelected)}
        >
          {selectAllLabel}
        </Button>
      </div>
      <ul className="divide-y divide-border/40 rounded-md border border-border/70">
        {orphans.map(({ payee, reason }) => {
          const selected = selectedPayeeIds.has(payee.id);
          return (
            <li
              key={payee.id}
              className={cn(
                "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                selected && "bg-muted/40"
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Checkbox
                  checked={selected}
                  onCheckedChange={(value) => onDeletionChange(payee.id, value === true)}
                  aria-label={`Select ${payee.name} for deletion`}
                />
                <span className="truncate">{payee.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {selected ? (
                  <span className="rounded-full border border-amber-600/40 bg-amber-500/5 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    Selected for deletion
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">{reason}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
