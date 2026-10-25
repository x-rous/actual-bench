"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { InfoHint } from "@/components/ui/info-hint";
import { DataTable, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { loanPath } from "@/features/assets-debt/lib/routes";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { allocatedDebtMinor, loanShares, trackedEquity, type AssetDebtLink, type DatedDebt } from "@/lib/asset-registry/financing";
import { ownershipAt, type Asset, type Registry } from "@/lib/asset-registry/models";
import type { Account } from "@/types/entities";
import { AttentionBadge, SummaryStrip, assetMoney } from "./AssetPresentation";
import { FinancingEditor } from "./FinancingEditor";

export function FinancingPanel({ asset, registry, loans, loansReady, accounts, asOf, onAsOf, today, valueAt, debtsAt, onSaved }: {
  asset: Asset; registry: Registry; loans: DebtSummary[]; loansReady: boolean; accounts: Account[]; asOf: string; onAsOf: (date: string) => void; today: string;
  /** Recorded owned value from the Actual book on a date; null when unavailable. */ valueAt: (date: string) => number | null;
  /** Positive Actual debt magnitude per linked loan on a date; null when that dated balance is unavailable. */ debtsAt: (date: string) => DatedDebt[];
  onSaved: (registry?: Registry) => Promise<void>;
}) {
  const links = registry.debtLinks ?? [];
  const [sort, setSort] = useState<SortState | null>({ key: "period", direction: "desc" });
  const sign = sort?.direction === "asc" ? 1 : -1;
  const mine = links.filter((l) => l.assetId === asset.id).sort((a, b) => sort?.key === "share" ? sign * (a.allocationBps - b.allocationBps) : sign * a.effectiveFrom.localeCompare(b.effectiveFrom) || a.debtId.localeCompare(b.debtId));
  const [editing, setEditing] = useState<{ preset?: AssetDebtLink } | null>(null);
  const valid = asOf <= today && /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const debts = valid ? debtsAt(asOf) : [];
  const result = valid ? trackedEquity(asset.id, asOf, links, valueAt(asOf), debts) : null;
  const loan = (id: string) => loans.find((d) => d.id === id);
  const applies = (l: AssetDebtLink) => l.effectiveFrom <= asOf && (l.effectiveTo === null || asOf < l.effectiveTo);
  const debtOf = (debtId: string) => debts.find((d) => d.debtId === debtId)?.magnitudeMinor ?? null;
  const columns: Column<AssetDebtLink>[] = [
    { key: "loan", header: "Loan", width: 200, grow: true, cell: (l) => loan(l.debtId) ? <Link className="truncate font-medium hover:underline" href={loanPath(l.debtId)}>{loan(l.debtId)!.name}</Link> : <Text>{loansReady ? "Unavailable loan" : "Reading loans…"}</Text> },
    { key: "account", header: "Actual liability account", width: 190, cell: (l) => <Text>{accounts.find((a) => a.id === loan(l.debtId)?.liabilityAccountId)?.name ?? "-"}</Text> },
    { key: "period", header: "Effective period [from, to)", width: 230, sortable: true, cell: (l) => <Text title={`${l.effectiveFrom} → ${l.effectiveTo ?? "open-ended"}`}>{shortDate(l.effectiveFrom, today)} → {l.effectiveTo ? shortDate(l.effectiveTo, today) : "open-ended"}</Text> },
    { key: "share", header: "Explicit share", width: 110, align: "right", sortable: true, cell: (l) => `${(l.allocationBps / 100).toFixed(2)}%` },
    { key: "state", header: "State at report date", width: 150, cell: (l) => <AttentionBadge status={applies(l) ? { label: "Applies", tone: "success" } : l.effectiveFrom > asOf ? { label: "Future", tone: "neutral" } : { label: "Past", tone: "neutral" }} /> },
    { key: "debt", header: "Allocated debt", width: 140, align: "right", cell: (l) => applies(l) ? (debtOf(l.debtId) === null ? "Unavailable" : assetMoney(allocatedDebtMinor(debtOf(l.debtId)!, l.allocationBps))) : "-" },
    { key: "others", header: "Other holders on report date", width: 260, cell: (l) => <Text title={others(l)}>{others(l)}</Text> },
    { key: "actions", header: "Actions", width: 90, align: "right", cell: (l) => <Button size="xs" variant="outline" disabled={asset.status !== "active"} aria-label={`Change allocation for ${loan(l.debtId)?.name ?? "loan"} from ${l.effectiveFrom}`} onClick={() => setEditing({ preset: l })}>Change</Button> },
  ];
  /** What the other assets hold of the same loan on the report date, so the remainder is visible in one table. */
  const others = (l: AssetDebtLink) => {
    if (!applies(l)) return "-";
    const { shares, unallocatedBps } = loanShares(links, l.debtId, asOf);
    const parts = shares.filter((x) => x.assetId !== asset.id).map((x) => `${registry.assets.find((a) => a.id === x.assetId)?.name ?? "Unknown asset"} ${(x.allocationBps / 100).toFixed(2)}%`);
    return [...parts, `Unallocated ${(unallocatedBps / 100).toFixed(2)}%`].join(" · ");
  };
  return <div className="flex min-h-0 flex-1"><div className="flex min-w-0 flex-1 flex-col overflow-auto">
    <SummaryStrip label="Asset financing summary" items={[
      { label: "Owned recorded value", value: assetMoney(valid ? valueAt(asOf) : null), detail: `Actual book as of ${asOf}` },
      { label: "Allocated Actual debt", value: assetMoney(result?.allocatedDebtMinor), detail: mine.length ? "Same-date Actual liability balance" : "No loan linked on or before this date" },
      { label: "Tracked equity", value: assetMoney(result?.equityMinor), detail: "Owned value − allocated debt" },
      { label: "Ownership on report date", value: ownershipAt(asset, asOf) === null ? "-" : `${ownershipAt(asset, asOf)! / 100}%`, detail: "Independent of loan responsibility" },
    ]} />
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5"><div><h2 className="text-sm font-semibold">Linked Loans &amp; Debt</h2><p className="flex items-center gap-1 text-xs text-muted-foreground">Effective allocation history · same-date equity<InfoHint label="allocation history">Allocation changes preserve earlier periods. Use the report date to inspect past equity. No current balance, loan forecast or share is substituted for missing historical evidence.</InfoHint></p></div>
      <Label htmlFor="fin-asof" className="ml-auto">As of</Label><DateInput id="fin-asof" className="w-40" value={asOf} onValueChange={onAsOf} />
      <Button size="sm" disabled={asset.status !== "active" || !loansReady} onClick={() => setEditing({})}><Plus className="size-3.5" aria-hidden />Link loan</Button></div>
    {!valid && <p role="alert" className="border-b p-3 text-xs text-destructive">Choose a report date no later than today.</p>}
    {result && result.gaps.length > 0 && <ul role="status" className="list-disc border-b px-8 py-2 text-xs">{[...new Set(result.gaps)].map((g) => <li key={g}>{g}; nothing is substituted from today&apos;s data.</li>)}</ul>}
    <div className="flex min-h-40 flex-1 flex-col"><DataTable label="Asset loan allocations" rows={mine} columns={columns} rowKey={(l) => `${l.debtId}:${l.effectiveFrom}`} rowLabel={(l) => `${loan(l.debtId)?.name ?? "Loan"} from ${l.effectiveFrom}`} dense={32} sort={sort} onSort={setSort} empty="No borrowing linked. Link an existing loan with an explicit start date." /></div>
  </div>
  {editing && <FinancingEditor key={editing.preset ? `${editing.preset.debtId}:${editing.preset.effectiveFrom}` : "new"} asset={asset} registry={registry} loans={loans} preset={editing.preset} today={today} onSaved={async (next) => { await onSaved(next); }} onClose={() => setEditing(null)} />}
  </div>;
}
