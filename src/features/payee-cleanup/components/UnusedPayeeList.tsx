import type { OrphanPayee } from "../lib/orphans";

type Props = {
  orphans: OrphanPayee[];
};

/**
 * Payees with nothing pointing at them (RD-078 §19).
 *
 * Read-only in this slice — staging the deletion is 041e's job. The copy states
 * plainly that Actual Bench applies its own check and that the check is stricter
 * than Actual's, because a user comparing this list against Actual's own
 * "unused" view deserves to know why they might differ.
 */
export function UnusedPayeeList({ orphans }: Props) {
  if (orphans.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        No unused payees. Everything is referenced by a transaction or a rule.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        These payees have no transactions and no rules pointing at them. Actual
        Bench checks a payee&apos;s rule actions as well as its conditions, so
        this list is slightly more cautious than Actual&apos;s own.
      </p>
      <ul className="divide-y divide-border/40 rounded-md border border-border/70">
        {orphans.map(({ payee, reason }) => (
          <li
            key={payee.id}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span>{payee.name}</span>
            <span className="text-xs text-muted-foreground">{reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
