"use client";
import { useState } from "react";
import Link from "next/link";
import { Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { InfoHint } from "@/components/ui/info-hint";
import { DataTable, Stack, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import { loanPath } from "@/features/assets-debt/lib/routes";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { allocatedDebtMinor, loanShares, trackedEquity, type AssetDebtLink, type DatedDebt } from "@/lib/asset-registry/financing";
import { ownershipAt, type Asset, type Registry } from "@/lib/asset-registry/models";
import type { Account } from "@/types/entities";
import { AttentionBadge, EmptyState, NA, SummaryStrip, assetMoney } from "./AssetPresentation";
import { FinancingEditor, loanFacts, loanTerms } from "./FinancingEditor";

export function FinancingPanel({ asset, registry, loans, loansReady, accounts, asOf, onAsOf, today, valueAt, debtsAt, onSaved, firstDate, balanceAt, repayments = {} }: {
  /** Each linked loan's regular repayment from the loan record: undefined while reading, null when the loan has none. */ repayments?: Record<string, number | null | undefined>;
  asset: Asset; registry: Registry; loans: DebtSummary[]; loansReady: boolean; accounts: Account[]; asOf: string; onAsOf: (date: string) => void; today: string;
  /** Recorded owned value from the Actual book on a date; null when unavailable. */ valueAt: (date: string) => number | null;
  /** Positive Actual debt magnitude per linked loan on a date; null when that dated balance is unavailable. */ debtsAt: (date: string) => DatedDebt[];
  onSaved: (registry?: Registry) => Promise<void>;
  /** The asset's first ledger entry date, a loan allocation never defaults to start before it. */ firstDate?: string;
  /** Any loan's Actual debt on a date (positive; null when unknown), for the link dialog's preview. */ balanceAt?: (debtId: string, date: string) => Promise<number | null>;
}) {
  const links = registry.debtLinks ?? [];
  const [sort, setSort] = useState<SortState | null>({ key: "period", direction: "desc" });
  const sign = sort?.direction === "asc" ? 1 : -1;
  const mine = links.filter((l) => l.assetId === asset.id).sort((a, b) => sort?.key === "share" ? sign * (a.allocationBps - b.allocationBps) : sign * a.effectiveFrom.localeCompare(b.effectiveFrom) || a.debtId.localeCompare(b.debtId));
  const [editing, setEditing] = useState<{ preset?: AssetDebtLink; mode?: "set" | "end" } | null>(null);
  const valid = asOf <= today && /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const debts = valid ? debtsAt(asOf) : [];
  const result = valid ? trackedEquity(asset.id, asOf, links, valueAt(asOf), debts) : null;
  const loan = (id: string) => loans.find((d) => d.id === id);
  const applies = (l: AssetDebtLink) => l.effectiveFrom <= asOf && (l.effectiveTo === null || asOf < l.effectiveTo);
  const debtOf = (debtId: string) => debts.find((d) => d.debtId === debtId)?.magnitudeMinor ?? null;
  const full = (l: AssetDebtLink["effectiveFrom"] | null) => l ? shortDate(l) : "open-ended";
  const repaid = (l: AssetDebtLink) => { const d = loan(l.debtId); const bal = debtOf(l.debtId); return d?.openingPrincipalMinor && bal !== null ? `${Math.max(0, Math.min(100, Math.round((1 - bal / d.openingPrincipalMinor) * 100)))}% repaid` : undefined; };
  const money = (_l: AssetDebtLink, minor: number) => assetMoney(minor); // one currency across Loans: never shown
  const value = valid ? valueAt(asOf) : null;
  const ltv = result?.allocatedDebtMinor != null && value !== null && value > 0 ? (result.allocatedDebtMinor / value) * 100 : null;
  const columns: Column<AssetDebtLink>[] = [
    { key: "loan", header: "Loan", width: 250, grow: true, cell: (l) => loan(l.debtId) ? <Stack primary={<Link className="truncate font-medium hover:underline" href={loanPath(l.debtId)}>{loan(l.debtId)!.name}</Link>} secondary={loanFacts(loan(l.debtId)!).join(" · ") || undefined} /> : <Text>{loansReady ? "Unavailable loan" : "Reading loans…"}</Text> },
    { key: "account", header: "Actual liability account", width: 210, cell: (l) => <Text>{accounts.find((a) => a.id === loan(l.debtId)?.liabilityAccountId)?.name ?? "-"}</Text> },
    { key: "period", header: "Effective period [from, to)", width: 220, sortable: true, cell: (l) => <Text title={`${l.effectiveFrom} → ${l.effectiveTo ?? "open-ended"}`}>{full(l.effectiveFrom)} → {full(l.effectiveTo)}</Text> },
    { key: "share", header: "Share", width: 80, align: "right", sortable: true, cell: (l) => `${(l.allocationBps / 100).toFixed(2)}%` },
    { key: "state", header: "State", width: 90, cell: (l) => <AttentionBadge status={applies(l) ? { label: "Applies", tone: "success" } : l.effectiveFrom > asOf ? { label: "Future", tone: "neutral" } : { label: "Past", tone: "neutral" }} /> },
    { key: "balance", header: "Loan balance", width: 140, align: "right", cell: (l) => applies(l) ? (debtOf(l.debtId) === null ? "Unavailable" : <Stack primary={money(l, debtOf(l.debtId)!)} secondary={repaid(l)} />) : "-" },
    { key: "debt", header: "Allocated debt", width: 130, align: "right", cell: (l) => applies(l) ? (debtOf(l.debtId) === null ? "Unavailable" : money(l, allocatedDebtMinor(debtOf(l.debtId)!, l.allocationBps))) : "-" },
    { key: "others", header: "Other holders", width: 220, cell: (l) => <Text title={others(l)}>{others(l)}</Text> },
    { key: "actions", header: "Actions", width: 130, align: "right", cell: (l) => <div className="flex justify-end gap-1"><Button size="xs" variant="outline" disabled={asset.status !== "active"} aria-label={`Change allocation for ${loan(l.debtId)?.name ?? "loan"} from ${l.effectiveFrom}`} onClick={() => setEditing({ preset: l })}>Change</Button>
      {applies(l) && l.effectiveTo === null && <Button size="xs" variant="ghost" disabled={asset.status !== "active"} aria-label={`End allocation for ${loan(l.debtId)?.name ?? "loan"} from ${l.effectiveFrom}`} onClick={() => setEditing({ preset: l, mode: "end" })}>End</Button>}</div> },
  ];
  /** What the other assets hold of the same loan on the report date, so the remainder is visible in one table. */
  const others = (l: AssetDebtLink) => {
    if (!applies(l)) return "-";
    const { shares, unallocatedBps } = loanShares(links, l.debtId, asOf);
    const parts = shares.filter((x) => x.assetId !== asset.id).map((x) => `${registry.assets.find((a) => a.id === x.assetId)?.name ?? "Unknown asset"} ${(x.allocationBps / 100).toFixed(2)}%`);
    return [...parts, ...(unallocatedBps > 0 ? [`Unallocated ${(unallocatedBps / 100).toFixed(2)}%`] : [])].join(" · ") || "-";
  };
  const ownership = ownershipAt(asset, asOf);
  // Principal repaid since each loan was first linked to this asset, on your share today. It is the loan's own balance that
  // fell, so a change of share is never counted as a repayment and a loan linked later counts from its own start.
  const firstLink = mine.map((l) => l.effectiveFrom).sort()[0];
  const repaidOf = (l: AssetDebtLink): number | null => {
    const start = mine.filter((m) => m.debtId === l.debtId).map((m) => m.effectiveFrom).sort()[0];
    const before = valid && start <= asOf ? debtsAt(start).find((d) => d.debtId === l.debtId)?.magnitudeMinor ?? null : null; const now = debtOf(l.debtId);
    return before === null || now === null ? null : allocatedDebtMinor(before - now, l.allocationBps);
  };
  const shares = mine.filter(applies);
  const parts = shares.map(repaidOf);
  const built = shares.length > 0 && parts.every((x) => x !== null) ? parts.reduce<number>((sum, x) => sum + x!, 0) : null;
  // The regular repayment of every loan that applies, scaled to this asset's share of it.
  const live = mine.filter(applies);
  const repaymentKnown = live.length > 0 && live.every((l) => typeof repayments[l.debtId] === "number");
  const repaymentReading = live.some((l) => repayments[l.debtId] === undefined);
  const payment = repaymentKnown ? live.reduce((sum, l) => sum + allocatedDebtMinor(repayments[l.debtId] as number, l.allocationBps), 0) : null;
  const monthly = live.length > 0 && live.every((l) => loan(l.debtId)?.repaymentFrequency === "monthly");
  const terms = live.length === 1 && loan(live[0].debtId) ? loanTerms(loan(live[0].debtId)!).join(" · ") : live.length > 1 ? `${live.length} loans` : "";
  return <div className="flex min-h-0 flex-1"><div className="flex min-w-0 flex-1 flex-col overflow-auto">
    {mine.length === 0 ? <EmptyState icon={Landmark} title="No loan linked" action={<Button size="sm" disabled={asset.status !== "active" || !loansReady} onClick={() => setEditing({})}><Plus className="size-3.5" aria-hidden />Link loan</Button>}>Link a loan from Loans to see this asset&apos;s debt, equity and loan-to-value.</EmptyState> : <>
    <SummaryStrip label="Asset financing summary" items={[
      { label: "Debt allocated", value: assetMoney(result?.allocatedDebtMinor), detail: ownership !== null && ownership < 10000 ? `Your ownership is ${ownership / 100}%` : live.length ? "Same-date Actual liability balance" : "No loan applies on this date", wrap: true },
      { label: "Equity", value: assetMoney(result?.equityMinor), detail: "Owned value − allocated debt", wrap: true },
      { label: "Loan-to-value", value: ltv === null ? NA : `${ltv.toFixed(1)}%`, detail: ltv === null ? "Needs the value and the debt on this date" : "Allocated debt ÷ owned value", wrap: true },
      { label: "Equity built", value: built === null ? NA : assetMoney(built), detail: built === null ? "Needs the loan balance on the day it was linked" : `Principal repaid since ${shortDate(firstLink!)}, on your current share`, wrap: true },
      { label: monthly ? "Monthly payment" : "Regular payment", value: repaymentReading ? "…" : payment === null ? NA : assetMoney(payment), detail: payment === null ? (live.length ? "The loan has no regular repayment" : "No loan applies on this date") : terms || "Your share of the loan's regular repayment", wrap: true },
    ]} />
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Linked Loans</h2><p className="flex items-center gap-1 text-xs text-muted-foreground">Effective allocation history · same-date equity<InfoHint label="allocation history">Allocation changes preserve earlier periods. Use the report date to inspect past equity. No current balance, loan forecast or share is substituted for missing historical evidence.</InfoHint></p></div>
      <Label htmlFor="fin-asof" className="ml-auto">As of</Label><DateInput id="fin-asof" className="w-40" value={asOf} onValueChange={onAsOf} />
      <Button size="sm" disabled={asset.status !== "active" || !loansReady} onClick={() => setEditing({})}><Plus className="size-3.5" aria-hidden />Link loan</Button></div>
    {!valid && <p role="alert" className="border-b p-3 text-xs text-destructive">Choose a report date no later than today.</p>}
    {result && result.gaps.length > 0 && <ul role="status" className="list-disc border-b px-8 py-2 text-xs">{[...new Set(result.gaps)].map((g) => <li key={g}>{g}; nothing is substituted from today&apos;s data.</li>)}</ul>}
    <div className="flex min-h-40 flex-1 flex-col"><DataTable label="Asset loan allocations" rows={mine} columns={columns} rowKey={(l) => `${l.debtId}:${l.effectiveFrom}`} rowLabel={(l) => `${loan(l.debtId)?.name ?? "Loan"} from ${l.effectiveFrom}`} dense={32} sort={sort} onSort={setSort} empty="No loan linked yet. Link a loan from Loans to see the debt, equity and loan-to-value of this asset." stacked /></div></>}
  </div>
  {editing && <FinancingEditor key={editing.preset ? `${editing.preset.debtId}:${editing.preset.effectiveFrom}:${editing.mode ?? "set"}` : "new"} asset={asset} registry={registry} loans={loans} preset={editing.preset} initialMode={editing.mode} today={today} firstDate={firstDate} valueAt={valueAt} debtsAt={debtsAt} balanceAt={balanceAt} onSaved={async (next) => { await onSaved(next); }} onClose={() => setEditing(null)} />}
  </div>;
}
