"use client";
import { useQueries } from "@tanstack/react-query";
import { allocatedInterest, interestSegments, type AssetDebtLink } from "@/lib/asset-registry/financing";

/**
 * Loan interest allocated to one asset for each period asked for. Each linked loan's interest-to-date is read from Loans
 * at the few dates the periods and allocation changes need (cached per loan and date). The returned function gives
 * positive integer minor units, `undefined` while still reading, or `null` when a loan's figure is unavailable.
 */
export function useAllocatedInterest(scope: readonly unknown[], assetId: string, links: AssetDebtLink[], periods: { from: string; to: string }[], interestToDate: (debtId: string, date: string) => Promise<number>) {
  const needed = [...new Map(periods.flatMap((p) => interestSegments(assetId, links, p.from, p.to))
    .flatMap((s) => [[`${s.debtId}|${s.before}`, [s.debtId, s.before]], [`${s.debtId}|${s.last}`, [s.debtId, s.last]]] as [string, [string, string]][])).values()];
  const results = useQueries({ queries: needed.map(([debtId, date]) => ({ queryKey: [...scope, "assetLoanInterest", debtId, date], queryFn: () => interestToDate(debtId, date), retry: false })) });
  const known = new Map(needed.map(([debtId, date], index) => [`${debtId}|${date}`, results[index]]));
  return (from: string, to: string): number | null | undefined => {
    let failed = false;
    const value = allocatedInterest(assetId, links, from, to, (debtId, date) => {
      const query = known.get(`${debtId}|${date}`);
      if (query?.isError) failed = true;
      return query?.isSuccess ? query.data : undefined;
    });
    return value === null ? (failed ? null : undefined) : value;
  };
}
