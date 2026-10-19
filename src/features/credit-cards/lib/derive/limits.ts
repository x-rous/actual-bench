import type { Card, Workspace } from "../models";

/**
 * The card's credit limit in effect on `date`: the latest change dated on or before it, otherwise
 * the limit the card started with. Null when no limit is set.
 */
export function limitOn(card: Card, workspace: Pick<Workspace, "limitChanges">, date: string): number | null {
  let latest: { effectiveDate: string; limitMinor: number } | null = null;
  for (const change of workspace.limitChanges) {
    if (change.cardId !== card.id || change.effectiveDate > date) continue;
    if (!latest || change.effectiveDate > latest.effectiveDate) latest = change;
  }
  return latest ? latest.limitMinor : card.creditLimitMinor;
}
