"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { EmptyState, NA, SummaryStrip } from "@/features/asset-registry/AssetPresentation";
import { FinancingEditor } from "@/features/asset-registry/FinancingEditor";
import { registryRequest } from "@/features/asset-registry/api";
import { getTransport } from "@/lib/actual";
import { actualUnitsToMinor } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { allocatedDebtMinor, loanShares, type AssetDebtLink } from "@/lib/asset-registry/financing";
import { ASSET_TYPES, ownershipAt, type Asset } from "@/lib/asset-registry/models";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { formatAmount } from "../../lib/money";
import { listDebts } from "../../lib/debtsApi";
import { dt } from "./presentation";

/**
 * Linked Assets (design spec 06 §7.4): the assets this loan paid for, their share of it over time, and what that means
 * for equity and loan-to-value. Allocations are the asset registry's own data, so a change here is the same change as
 * from the asset's Linked Loans tab.
 */

const covers = (l: AssetDebtLink, date: string) => l.effectiveFrom <= date && (l.effectiveTo === null || date < l.effectiveTo);

export function LinkedAssetsTab({ detail, digits, today, owedMinor }: { detail: DebtDetail; digits: number; today: string; /** The debt today (Owed in Actual); null when unknown. */ owedMinor: number | null }) {
  const money = (minor: number | null) => (minor === null ? NA : formatAmount(minor, digits));
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const budget = detail.debt.budgetSyncId;
  const enabled = !!connection && connection.budgetSyncId === budget;
  const registry = useQuery({ queryKey: ["assetRegistry", connection?.id, budget], queryFn: () => registryRequest(budget), enabled });
  const loans = useQuery({ queryKey: ["assets-debt", "debts", budget], queryFn: () => listDebts(budget), enabled });
  const balances = useQuery({ queryKey: ["assets-debt", "balances", connection?.id], queryFn: () => getTransport(connection!).getAccountBalances(), enabled, staleTime: 60_000 });
  const [asOf, setAsOf] = useState(today);
  const [sort, setSort] = useState<SortState | null>({ key: "period", direction: "desc" });
  const [editing, setEditing] = useState<{ asset: Asset; preset?: AssetDebtLink; mode?: "set" | "end" } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosenAsset, setChosenAsset] = useState("");

  if (!enabled) return <p className="m-4 text-sm text-muted-foreground">Connect to this loan&apos;s budget to see its linked assets.</p>;
  if (registry.isLoading) return <p role="status" className="p-4 text-sm text-muted-foreground">Reading the asset registry…</p>;
  if (registry.isError || !registry.data) return <p role="alert" className="m-4 text-sm text-destructive">{registry.error instanceof Error ? registry.error.message : "The asset registry could not be read."}</p>;
  const reg = registry.data;
  const links = (reg.debtLinks ?? []).filter((l) => l.debtId === detail.debt.id);
  const assetOf = (id: string) => reg.assets.find((a) => a.id === id) ?? null;
  // An asset's owned value on the report date: its Actual account balance today, times the owner's share.
  const ownedValue = (asset: Asset | null): number | null => {
    if (!asset || asOf !== today) return null;
    const whole = balances.data?.get(asset.actualAccountId);
    if (typeof whole !== "number") return null;
    const bps = ownershipAt(asset, asOf) ?? 10000;
    return Math.round((actualUnitsToMinor(whole) * bps) / 10000);
  };
  const debt = asOf === today ? owedMinor : null;
  const applies = links.filter((l) => covers(l, asOf));
  const { unallocatedBps } = loanShares(links, detail.debt.id, asOf);
  const allocated = debt === null ? null : applies.reduce((s, l) => s + allocatedDebtMinor(debt, l.allocationBps), 0);
  const values = applies.map((l) => ownedValue(assetOf(l.assetId)));
  const valueSum = values.every((v) => v !== null) ? values.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  const ltv = allocated !== null && valueSum ? (allocated / valueSum) * 100 : null;
  const sign = sort?.direction === "asc" ? 1 : -1;
  const rows = [...links].sort((a, b) => (sort?.key === "share" ? sign * (a.allocationBps - b.allocationBps) : sign * a.effectiveFrom.localeCompare(b.effectiveFrom)));
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["assetRegistry"] }); };

  const columns: Column<AssetDebtLink>[] = [
    { key: "asset", header: "Asset", width: 240, grow: true, cell: (l) => { const a = assetOf(l.assetId); return a ? <Link className="truncate font-medium hover:underline" href={`/assets/${encodeURIComponent(a.id)}`}>{a.name}</Link> : <Text>Unavailable asset</Text>; } },
    { key: "type", header: "Type", width: 130, cell: (l) => <Text>{ASSET_TYPES[assetOf(l.assetId)?.assetType as keyof typeof ASSET_TYPES]?.label ?? "-"}</Text> },
    { key: "share", header: "Share", width: 90, align: "right", sortable: true, cell: (l) => <span className="tabular-nums">{(l.allocationBps / 100).toFixed(2)}%</span> },
    { key: "period", header: "Effective period", width: 230, sortable: true, cell: (l) => <Text>{dt(l.effectiveFrom)} → {l.effectiveTo ? dt(l.effectiveTo) : "open-ended"}</Text> },
    { key: "state", header: "State", width: 96, cell: (l) => <span className={covers(l, asOf) ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400" : "rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"}>{covers(l, asOf) ? "Applies" : l.effectiveFrom > asOf ? "Future" : "Past"}</span> },
    { key: "value", header: "Asset value", width: 140, align: "right", cell: (l) => <span className="tabular-nums">{covers(l, asOf) ? money(ownedValue(assetOf(l.assetId))) : NA}</span> },
    { key: "debt", header: "Allocated debt", width: 140, align: "right", cell: (l) => <span className="tabular-nums">{covers(l, asOf) && debt !== null ? money(allocatedDebtMinor(debt, l.allocationBps)) : NA}</span> },
    { key: "ltv", header: "Loan-to-value", width: 120, align: "right", cell: (l) => { const v = ownedValue(assetOf(l.assetId)); return <span className="tabular-nums">{covers(l, asOf) && debt !== null && v ? `${((allocatedDebtMinor(debt, l.allocationBps) / v) * 100).toFixed(1)}%` : NA}</span>; } },
    { key: "equity", header: "Equity", width: 140, align: "right", cell: (l) => { const v = ownedValue(assetOf(l.assetId)); return <span className="tabular-nums">{covers(l, asOf) && debt !== null && v !== null ? money(v - allocatedDebtMinor(debt, l.allocationBps)) : NA}</span>; } },
    { key: "actions", header: "Actions", hiddenHeader: true, width: 130, align: "right", sticky: "end", cell: (l) => { const a = assetOf(l.assetId); return a && a.status === "active" ? <div className="flex justify-end gap-1"><Button size="xs" variant="outline" onClick={() => setEditing({ asset: a, preset: l })}>Change</Button>{covers(l, asOf) && l.effectiveTo === null ? <Button size="xs" variant="ghost" onClick={() => setEditing({ asset: a, preset: l, mode: "end" })}>End</Button> : null}</div> : null; } },
  ];
  const activeAssets = reg.assets.filter((a) => a.status === "active");
  const thisLoan = loans.data?.filter((d) => d.id === detail.debt.id) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {links.length === 0 ? (
        <EmptyState icon={Landmark} title="No asset linked" action={<Button size="sm" disabled={!activeAssets.length} onClick={() => setChoosing(true)}><Plus className="size-3.5" aria-hidden />Link asset</Button>}>
          {activeAssets.length ? "Link the property or vehicle this loan paid for to see equity and loan-to-value." : "Register the property or vehicle in Assets first, then link it here."}
        </EmptyState>
      ) : (
        <>
          <SummaryStrip label="Linked assets summary" items={[
            { label: "Debt today", value: money(debt), detail: asOf === today ? "Owed in Actual · the loan account" : "Only today's figures are shown", wrap: true },
            { label: "Allocated to assets", value: money(allocated), detail: `${applies.length} asset${applies.length === 1 ? "" : "s"}`, wrap: true },
            { label: "Unallocated", value: debt === null ? NA : money(allocatedDebtMinor(debt, unallocatedBps)), detail: `${(unallocatedBps / 100).toFixed(2)}% of the loan`, wrap: true },
            { label: "Combined loan-to-value", value: ltv === null ? NA : `${ltv.toFixed(1)}%`, detail: "Allocated debt ÷ owned value", wrap: true },
            { label: "Equity in linked assets", value: allocated !== null && valueSum !== null ? money(valueSum - allocated) : NA, detail: "Owned value − allocated debt", wrap: true },
          ]} />
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
            <h2 className="text-sm font-semibold">Linked assets</h2>
            <p className="text-xs text-muted-foreground">Allocation history from the Asset Registry · changes here change the same data</p>
            <Label htmlFor="loan-assets-asof" className="ml-auto text-xs">As of</Label><DateInput id="loan-assets-asof" className="w-40" value={asOf} onValueChange={setAsOf} />
            <Button size="sm" disabled={!activeAssets.length} onClick={() => setChoosing(true)}><Plus className="size-3.5" aria-hidden />Link asset</Button>
          </div>
          <div className="flex min-h-40 flex-1 flex-col"><DataTable label="Linked assets" rows={rows} columns={columns} rowKey={(l) => `${l.assetId}:${l.effectiveFrom}`} rowLabel={(l) => `${assetOf(l.assetId)?.name ?? "Asset"} from ${l.effectiveFrom}`} sort={sort} onSort={setSort} dense={32} empty="No asset linked." /></div>
        </>
      )}
      {choosing ? (
        <Dialog open onOpenChange={(open) => { if (!open) setChoosing(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Link an asset</DialogTitle><DialogDescription>Choose the asset this loan paid for. You set its share and dates next.</DialogDescription></DialogHeader>
            <Select aria-label="Asset" value={chosenAsset} onValueChange={setChosenAsset} options={[{ value: "", label: "Choose an asset" }, ...activeAssets.map((a) => ({ value: a.id, label: a.name }))]} />
            <DialogFooter><Button variant="outline" onClick={() => setChoosing(false)}>Cancel</Button><Button disabled={!chosenAsset} onClick={() => { const a = assetOf(chosenAsset); setChoosing(false); if (a) setEditing({ asset: a }); }}>Next</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {editing ? <FinancingEditor key={`${editing.asset.id}:${editing.preset?.effectiveFrom ?? "new"}:${editing.mode ?? "set"}`} asset={editing.asset} registry={reg} loans={thisLoan} preset={editing.preset} initialMode={editing.mode} today={today}
        onSaved={async () => { await refresh(); }} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
