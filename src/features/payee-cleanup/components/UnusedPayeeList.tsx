import type { OrphanPayee } from "../lib/orphans";
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

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        These payees have no transactions or rule references. Bench also checks
        rule actions, so it may be more cautious than Actual. Select payees to
        include in the cleanup plan.
      </p>
      <div className="overflow-hidden rounded-md border border-border/70">
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Checkbox
            id="select-all-unused-payees"
            checked={allSelected}
            onCheckedChange={(value) => onSelectAllChange(value === true)}
            aria-label={filtered ? "Select all visible unused payees" : "Select all unused payees"}
          />
          <label htmlFor="select-all-unused-payees" className="cursor-pointer">
            <span className="sr-only">
              {filtered ? "Select all visible unused " : "Select all unused "}
            </span>
            Payee
          </label>
        </div>
        <ul className="divide-y divide-border/40">
        {orphans.map(({ payee }) => {
          const selected = selectedPayeeIds.has(payee.id);
          const checkboxId = `delete-unused-payee-${payee.id}`;
          return (
            <li
              key={payee.id}
              className={cn(
                "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                selected && "bg-amber-50/70 dark:bg-amber-950/20"
              )}
            >
              <label htmlFor={checkboxId} className="flex min-w-0 cursor-pointer items-center gap-2">
                <Checkbox
                  id={checkboxId}
                  checked={selected}
                  onCheckedChange={(value) => onDeletionChange(payee.id, value === true)}
                  aria-label={`Select ${payee.name} for deletion`}
                />
                <span className="truncate">{payee.name}</span>
              </label>
              <span className="flex shrink-0 items-center gap-2">
                {selected ? (
                  <span className="rounded-full border border-amber-600/40 bg-amber-500/5 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    Selected for deletion
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
        </ul>
      </div>
    </div>
  );
}
