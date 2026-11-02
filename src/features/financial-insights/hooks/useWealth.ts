"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { attributeBook, readBook } from "@/lib/asset-registry/ledger";
import { ASSET_ROW_LIMIT } from "@/lib/financial-insights/assetReview";
import { assetValues, type AssetBook, type AssetValueRow, type LoanRef } from "@/lib/financial-insights/wealth";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import { listDebts } from "@/features/assets-debt/lib/debtsApi";
import type { ReadyData } from "./useFinancialInsights";

const ASSET_CLASSES = ["property", "vehicle", "other-asset"];

export type WealthLoad =
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  | { state: "ready"; rows: AssetValueRow[] };

/**
 * What Wealth & investments reads beyond the main read, when its tab opens: each registered asset account's book (the Asset
 * Registry's own read and attribution, through its cache key, so an account already open in Assets is free) and the loans the
 * registry links to (one list read). Nothing is written. The portfolio itself needs no extra read.
 */
export function useWealth(data: ReadyData): WealthLoad {
  const connection = useConnectionStore(selectActiveInstance);
  const { ledger, registry } = data;
  // The same date the Asset Registry keys its books by, so the two share the cache.
  const date = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);

  const assets = useMemo(() => registry.assets.filter((a) => a.status !== "archived" && ASSET_CLASSES.includes(ledger.account.get(a.actualAccountId)?.accountClass ?? "")), [registry.assets, ledger]);
  const accountIds = useMemo(() => [...new Set(assets.map((a) => a.actualAccountId))].sort(), [assets]);
  const unreadable = useMemo(() => {
    const rows = new Map<string, number>();
    for (const r of ledger.facts.movement) if (accountIds.includes(r.accountId)) rows.set(r.accountId, (rows.get(r.accountId) ?? 0) + r.count);
    return new Map([...rows].filter(([, n]) => n > ASSET_ROW_LIMIT).map(([id, n]) => [id, `The account holds ${n.toLocaleString()} entries, more than can be read to value it`]));
  }, [accountIds, ledger]);

  const books = useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: ["assetBook", connection?.id, connection?.budgetSyncId, accountId, date],
      queryFn: () => readBook(getTransport(connection!), accountId, date),
      enabled: !!connection && !unreadable.has(accountId),
    })),
  });
  const linkedDebts = useMemo(() => [...new Set(registry.debtLinks.map((l) => l.debtId))], [registry.debtLinks]);
  const loansQuery = useQuery({
    queryKey: ["financial-insights", "wealth-loans", connection?.id, connection?.budgetSyncId],
    enabled: !!connection?.budgetSyncId && linkedDebts.length > 0,
    refetchOnMount: "always",
    queryFn: () => listDebts(connection!.budgetSyncId, true),
  });

  // An account that is not read at all (too many entries) has a disabled query that never settles: it must not hold the tab on loading.
  const pending = accountIds.some((id, i) => !unreadable.has(id) && books[i].isPending && !books[i].isError) || (linkedDebts.length > 0 && loansQuery.isPending && !loansQuery.isError);
  const failed = loansQuery.isError;
  const bookData = books.map((q) => q.data);
  const rows = useMemo((): AssetValueRow[] | null => {
    if (pending || failed) return null;
    const attributed = new Map<string, AssetBook | null>();
    accountIds.forEach((id, i) => {
      const snapshot = bookData[i];
      if (!snapshot) { attributed.set(id, null); return; }
      const book = attributeBook(snapshot, registry.assets, registry.metadata);
      attributed.set(id, { available: book.available, rows: book.rows.map((r) => ({ assetId: r.assetId, date: r.date, classification: r.classification, amountMinor: r.amountMinor })) });
    });
    const loans: LoanRef[] = (loansQuery.data ?? []).filter((d) => linkedDebts.includes(d.id)).map((d) => ({ debtId: d.id, accountId: d.liabilityAccountId ?? null, signConvention: d.signConvention as LoanRef["signConvention"] }));
    return assetValues({ ledger, period: data.period, assets, books: attributed, links: registry.debtLinks, loans, unreadable });
    // bookData is an array rebuilt every render; its entries only change when a query settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, failed, accountIds, books.map((q) => q.dataUpdatedAt).join("|"), loansQuery.data, ledger, data.period, assets, registry, linkedDebts, unreadable]);

  if (failed) return { state: "error", retry: () => void loansQuery.refetch() };
  if (!rows) return { state: "loading" };
  return { state: "ready", rows };
}
