import { formatDay } from "./period";
/**
 * Why a transfer is part of an "in transit" amount, from what is recorded and nothing more. A transfer is in transit when its
 * two sides do not net to zero inside the period. Pairs that cancel exactly are left out, so the rows listed add up to the
 * figure. A cause such as a currency conversion cannot be verified (there is no currency data), so it is never named: when both
 * sides are recorded with different amounts the reason says exactly that.
 */
export type TransferRow = { id: string; date: string; accountId: string; amountMinor: number; /** The linked row on the other side; null when there is none. */ transferId: string | null; counterpartAccountId: string };
export type OtherSide = { date: string; accountId: string; amountMinor: number };

export type InTransitRows = { ids: string[]; reasons: Record<string, string>; totalMinor: number };

export function explainInTransit(
  rows: readonly TransferRow[],
  /** The other sides that were not part of `rows`, by id (read separately). */
  others: ReadonlyMap<string, OtherSide>,
  period: { startDate: string; endDate: string },
  money: (minor: number) => string,
  excluded: ReadonlySet<string>,
): InTransitRows {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reasons: Record<string, string> = {};
  const done = new Set<string>();
  let total = 0;
  const take = (r: TransferRow, why: string) => { if (reasons[r.id] !== undefined) return; reasons[r.id] = why; total += r.amountMinor; };
  for (const r of rows) {
    if (done.has(r.id) || excluded.has(r.counterpartAccountId)) continue;
    if (r.transferId === null) { take(r, "No other side is recorded: this transfer has no matching entry in the other account."); continue; }
    const paired = byId.get(r.transferId);
    if (paired) {
      done.add(r.id); done.add(paired.id);
      const net = r.amountMinor + paired.amountMinor;
      if (net === 0) continue;
      const why = (mine: number, theirs: number) => `Both sides are recorded in the period, but the amounts differ: ${money(mine)} here and ${money(theirs)} on the other side, ${money(net)} left over.`;
      take(r, why(r.amountMinor, paired.amountMinor));
      take(paired, why(paired.amountMinor, r.amountMinor));
      continue;
    }
    const other = others.get(r.transferId);
    if (!other) take(r, "The other side could not be found; it may have been deleted.");
    else if (other.date < period.startDate || other.date > period.endDate) take(r, `The other side is dated ${formatDay(other.date)}, outside the period.`);
    else take(r, "The other side is recorded in an account that is not part of this view.");
  }
  const ids = Object.keys(reasons);
  return { ids, reasons, totalMinor: total };
}
