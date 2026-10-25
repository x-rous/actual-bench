"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import { loanShares } from "@/lib/asset-registry/financing";
import { registryRequest } from "./api";

/**
 * Read-only reciprocal context for a loan (PR-130d): which registered assets are allocated a share today, and the
 * explicit remainder. It never changes the loan, and renders nothing when no asset is linked.
 */
export function LinkedAssetsNote({ debtId, budgetSyncId }: { debtId: string; budgetSyncId: string }) {
  const connection = useConnectionStore(selectActiveInstance);
  const query = useQuery({ queryKey: ["assetRegistry", connection?.id, budgetSyncId], queryFn: () => registryRequest(budgetSyncId), enabled: !!connection && connection.budgetSyncId === budgetSyncId });
  const links = (query.data?.debtLinks ?? []).filter((l) => l.debtId === debtId);
  if (!links.length) return null;
  const today = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const { shares, unallocatedBps } = loanShares(links, debtId, today);
  return <p aria-label="Linked assets" className="border-b px-4 py-1.5 text-xs text-muted-foreground">
    Linked assets today:{" "}
    {shares.length ? shares.map((s, index) => { const asset = query.data!.assets.find((a) => a.id === s.assetId); return <span key={s.assetId}>{index > 0 && ", "}<Link className="font-medium text-foreground hover:underline" href={`/assets/${encodeURIComponent(s.assetId)}`}>{asset?.name ?? "Asset"}</Link> ({(s.allocationBps / 100).toFixed(2)}%)</span>; }) : "none"}
    {" · "}Unallocated {(unallocatedBps / 100).toFixed(2)}%
  </p>;
}
