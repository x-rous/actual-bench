"use client";

import { useMemo } from "react";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { attributeBook, readBook } from "@/lib/asset-registry/ledger";
import { ASSET_ROW_LIMIT } from "@/lib/financial-insights/assetReview";
import { assetSeries, assetValues, type AssetBook, type AssetSeries, type AssetValueRow, type LoanRef } from "@/lib/financial-insights/wealth";
import { listDebts } from "@/features/assets-debt/lib/debtsApi";
import type { ReadyData } from "./useFinancialInsights";


const ASSET_CLASSES = ["property", "vehicle", "other-asset"];

type BookSnapshot = Awaited<ReturnType<typeof readBook>>;

/**
 * What the hook needs from the book reads, as one value TanStack Query shares structurally: `data` keeps its identity until a
 * book really changes, so the figures are worked out again only then. A book whose read failed is unavailable, even if an earlier
 * read left data behind: stale figures must not look current.
 */
function combineBooks(results: UseQueryResult<BookSnapshot>[]) {
  return {
    data: results.map((q) => (q.isError ? undefined : q.data)),
    unsettled: results.map((q) => q.isPending && !q.isError),
    fetching: results.some((q) => q.isFetching),
    failed: results.some((q) => q.isError),
    retries: results.map((q) => (q.isError ? () => void q.refetch() : null)),
  };
}

export type WealthLoad =
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  | { state: "ready"; rows: AssetValueRow[]; series: AssetSeries; /** Asset books are being read again after a refresh: the rows may still be the earlier ones. */ refreshing: boolean; /** Some asset account could not be read. */ hasFailedBooks: boolean; /** Read the accounts that failed again. */ retryBooks: () => void };

/**
 * What Property & assets reads beyond the main read, when its tab opens: each registered asset account's book (the Asset
 * Registry's own read and attribution, through its cache key, so an account already open in Assets is free) and the loans the
 * registry links to (one list read). Nothing is written. The portfolio itself needs no extra read.
 */
export function useWealth(data: ReadyData): WealthLoad {
  const connection = useConnectionStore(selectActiveInstance);
  const { ledger, registry } = data;
  // The page's own date, so the books and the ledger are read for the same day. It is the browser's calendar day, as the Asset
  // Registry keys its books by, so an account already open in Assets is still read from the cache.
  const date = data.drill.today;

  // Every active asset on a property, vehicle or other-asset account: `assetValues` decides which of them are still fixed assets.
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
    combine: combineBooks,
  });
  const bookData = books.data;
  // Only the loans of the assets that are listed: an archived asset keeps its links, and its loan must not decide whether the rest can be shown.
  const linkedDebts = useMemo(() => { const listed = new Set(assets.map((a) => a.id)); return [...new Set(registry.debtLinks.filter((l) => listed.has(l.assetId)).map((l) => l.debtId))]; }, [registry.debtLinks, assets]);
  const loansQuery = useQuery({
    queryKey: ["financial-insights", "wealth-loans", connection?.id, connection?.budgetSyncId],
    enabled: !!connection?.budgetSyncId && linkedDebts.length > 0,
    refetchOnMount: "always",
    queryFn: () => listDebts(connection!.budgetSyncId, true),
  });

  // An account that is not read at all (too many entries) has a disabled query that never settles: it must not hold the tab on loading.
  const pending = accountIds.some((id, i) => !unreadable.has(id) && books.unsettled[i]) || (linkedDebts.length > 0 && loansQuery.isPending && !loansQuery.isError);
  const failed = linkedDebts.length > 0 && loansQuery.isError;
  const loaded = useMemo((): { rows: AssetValueRow[]; series: AssetSeries } | null => {
    if (pending || failed) return null;
    const attributed = new Map<string, AssetBook | null>();
    accountIds.forEach((id, i) => {
      const snapshot = bookData[i];
      if (!snapshot) { attributed.set(id, null); return; }
      const book = attributeBook(snapshot, registry.assets, registry.metadata);
      attributed.set(id, { available: book.available, rows: book.rows.map((r) => ({ assetId: r.assetId, date: r.date, classification: r.classification, amountMinor: r.amountMinor })) });
    });
    const loans: LoanRef[] = (loansQuery.data ?? []).filter((d) => linkedDebts.includes(d.id)).map((d) => ({ debtId: d.id, accountId: d.liabilityAccountId ?? null, signConvention: d.signConvention as LoanRef["signConvention"] }));
    return {
      rows: assetValues({ ledger, period: data.period, assets, books: attributed, links: registry.debtLinks, loans, unreadable, registryRead: data.registry.read }),
      series: assetSeries({ ledger, period: data.period, assets, books: attributed, links: registry.debtLinks, loans }),
    };
  }, [pending, failed, accountIds, bookData, loansQuery.data, ledger, data.period, data.registry.read, assets, registry, linkedDebts, unreadable]);

  if (failed) return { state: "error", retry: () => void loansQuery.refetch() };
  if (!loaded) return { state: "loading" };
  return { state: "ready", ...loaded, refreshing: books.fetching, hasFailedBooks: books.failed, retryBooks: () => books.retries.forEach((retry) => retry?.()) };
}
