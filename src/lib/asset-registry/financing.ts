import { divRoundInt } from "@/lib/financial-models/money";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";

/**
 * Basis points: 10000 = 100% of the loan's Actual outstanding debt. Periods are `[effectiveFrom, effectiveTo)`;
 * `effectiveTo` is exclusive and null is open-ended. Ownership percentage never decides an allocation.
 */
export type AssetDebtLink = { assetId: string; debtId: string; allocationBps: number; effectiveFrom: string; effectiveTo: string | null; note: string | null };
export type AllocationOperation =
  | { kind: "set"; assetId: string; debtId: string; effectiveFrom: string; effectiveTo?: string | null; allocationBps: number; note?: string | null }
  | { kind: "end"; assetId: string; debtId: string; effectiveFrom: string };
const FULL = 10000;
const covers = (l: Pick<AssetDebtLink, "effectiveFrom" | "effectiveTo">, date: string) => l.effectiveFrom <= date && (l.effectiveTo === null || date < l.effectiveTo);
const byStart = (a: AssetDebtLink, b: AssetDebtLink) => a.effectiveFrom.localeCompare(b.effectiveFrom);
export class AllocationError extends Error {}

/**
 * The pair's rows after an ordinary change at date D, preserving every period that is not touched. A change closes the
 * period containing D and inserts a new one starting at D that runs to that period's former end (or the next saved
 * start); starting on an existing start date is an explicit same-start correction. Ending closes the containing period.
 */
export function changePair(pair: AssetDebtLink[], op: AllocationOperation): AssetDebtLink[] {
  if (!isIsoDate(op.effectiveFrom)) throw new AllocationError("Choose a valid effective date");
  const rows = pair.map((r) => ({ ...r })).sort(byStart);
  const containing = rows.find((r) => covers(r, op.effectiveFrom));
  if (op.kind === "end") {
    if (!containing) throw new AllocationError("No allocation applies on that date");
    if (containing.effectiveFrom === op.effectiveFrom) return rows.filter((r) => r !== containing); // it never applied
    containing.effectiveTo = op.effectiveFrom;
    return rows;
  }
  if (!Number.isInteger(op.allocationBps) || op.allocationBps < 1 || op.allocationBps > FULL) throw new AllocationError("Allocation must be between 0.01% and 100%");
  if (op.effectiveTo != null && (!isIsoDate(op.effectiveTo) || op.effectiveTo <= op.effectiveFrom)) throw new AllocationError("An allocation must end after it starts");
  const note = op.note ?? null;
  if (containing && containing.effectiveFrom === op.effectiveFrom) {
    containing.allocationBps = op.allocationBps; containing.note = op.note === undefined ? containing.note : note;
    if (op.effectiveTo !== undefined) containing.effectiveTo = op.effectiveTo;
    return rows;
  }
  const next = rows.find((r) => r.effectiveFrom > op.effectiveFrom);
  const to = op.effectiveTo !== undefined ? op.effectiveTo : containing ? containing.effectiveTo : next?.effectiveFrom ?? null;
  if (containing) containing.effectiveTo = op.effectiveFrom;
  rows.push({ assetId: op.assetId, debtId: op.debtId, allocationBps: op.allocationBps, effectiveFrom: op.effectiveFrom, effectiveTo: to, note });
  return rows.sort(byStart);
}
/** Same-pair overlap and the per-loan 100% limit at every period boundary, across all assets (archived included) and future periods. */
export function checkLoanLimits(links: AssetDebtLink[]): string | null {
  for (const l of links) if (l.effectiveTo !== null && l.effectiveTo <= l.effectiveFrom) return "An allocation must end after it starts";
  const pairs = new Map<string, AssetDebtLink[]>();
  for (const l of links) pairs.set(`${l.assetId}\u0000${l.debtId}`, [...(pairs.get(`${l.assetId}\u0000${l.debtId}`) ?? []), l]);
  for (const rows of pairs.values()) {
    const sorted = [...rows].sort(byStart);
    for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].effectiveTo === null || sorted[i - 1].effectiveTo! > sorted[i].effectiveFrom) return "Allocation periods for the same asset and loan cannot overlap";
  }
  for (const boundary of new Set(links.map((l) => l.effectiveFrom))) { // the sum only rises at a start; ends are exclusive
    if (links.filter((l) => covers(l, boundary)).reduce((s, l) => s + l.allocationBps, 0) > FULL) return `Allocations to this loan would exceed 100% on ${boundary}`;
  }
  return null;
}
/** Order-independent fingerprint of one loan's periods; a stale editor cannot overwrite another asset's change. */
export const loanFingerprint = (links: AssetDebtLink[], debtId: string): string => JSON.stringify(links.filter((l) => l.debtId === debtId)
  .map((l) => [l.assetId, l.effectiveFrom, l.effectiveTo, l.allocationBps]).sort((a, b) => String(a).localeCompare(String(b))));
export const allocationAt = (links: AssetDebtLink[], assetId: string, debtId: string, date: string): AssetDebtLink | null =>
  links.find((l) => l.assetId === assetId && l.debtId === debtId && covers(l, date)) ?? null;
/** Each asset's share of one loan on a date, and the explicit unallocated remainder. */
export function loanShares(links: AssetDebtLink[], debtId: string, date: string) {
  const shares = links.filter((l) => l.debtId === debtId && covers(l, date));
  const allocated = shares.reduce((s, l) => s + l.allocationBps, 0);
  return { shares, unallocatedBps: Math.max(0, FULL - allocated) };
}
/** Exact integer math: the allocated part of a positive Actual debt magnitude, rounded half-even once. */
export const allocatedDebtMinor = (debtMinor: number, bps: number): number => Number(divRoundInt(BigInt(debtMinor) * BigInt(bps), BigInt(FULL), "half-even"));
export type DatedDebt = { debtId: string; magnitudeMinor: number | null };
/**
 * Tracked equity on one date = recorded owned asset value − allocated Actual debt, all from that date. Any missing
 * dated input (asset value, or the Actual balance of a loan allocated on that date) makes the result unavailable.
 */
export function trackedEquity(assetId: string, date: string, links: AssetDebtLink[], assetValueMinor: number | null, debts: DatedDebt[]) {
  const applicable = links.filter((l) => l.assetId === assetId && covers(l, date));
  let debt = 0; const gaps: string[] = [];
  for (const link of applicable) {
    const magnitude = debts.find((d) => d.debtId === link.debtId)?.magnitudeMinor ?? null;
    if (magnitude === null) gaps.push("Actual loan balance is unavailable on that date"); else debt += allocatedDebtMinor(magnitude, link.allocationBps);
  }
  const complete = gaps.length === 0;
  return { allocatedDebtMinor: complete ? debt : null, equityMinor: complete && assetValueMinor !== null ? assetValueMinor - debt : null, gaps: assetValueMinor === null ? [...gaps, "Dated asset value is unavailable"] : gaps };
}
