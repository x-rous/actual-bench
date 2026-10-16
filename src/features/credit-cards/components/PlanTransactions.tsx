"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { activityKind } from "../lib/activity";
import type { Card, PlanLink, RepaymentPlan, Workspace } from "../lib/models";
import { financingCostKind, trackingRowIndex, trackingTransferMatches } from "../lib/planTracking";
import { planSources, roleLabels, suggestPlanLink } from "../lib/plans";
import { classificationLabels } from "../lib/classifications";
import { formatCardDate } from "../lib/displayDates";
import { sumMinor } from "../lib/statements";
import { ClearingStatus } from "./ClearingStatus";
import { ReviewText } from "./ReviewText";
import { ActivityClassification } from "./ActivityClassification";

type Props = { plan: RepaymentPlan | null; planId: string; card: Card; workspace: Workspace; snapshot: ActivitySnapshot; links: PlanLink[]; onChange: (links: PlanLink[]) => void; focusId?: string; budget?: string; available?: boolean; onClassified?: () => void };
export function PlanTransactions({ plan, planId, card, workspace, snapshot, links, onChange, focusId, budget, available = true, onClassified }: Props) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState(focusId ? "all" : "suggested");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const index = trackingRowIndex(snapshot);
  const tracker = snapshot.trackingAccounts?.find((entry) => entry.accountId === plan?.tracking?.accountId);
  const candidates = [...snapshot.rows, ...(tracker?.rows.filter((entry) => !entry.transferId || !snapshot.rows.some((row) => row.id === entry.transferId)) ?? [])];
  const rows = candidates.filter((row) => !plan || !planSources(plan).some((source) => source.transactionId === row.id)).filter((row) => row.amountMinor !== 0 && (!row.transferId || plan && trackingTransferMatches(row, plan, snapshot))).map((row) => {
    const link = links.find((entry) => entry.transactionId === row.id);
    const owned = workspace.planLinks?.some((entry) => entry.planId !== planId && (entry.transactionId === row.id || entry.transactionId === row.transferId)) || workspace.plans?.some((entry) => entry.id !== planId && planSources(entry).some((source) => source.transactionId === row.id));
    const suggestion = !owned && plan && row.accountId === card.accountId ? suggestPlanLink(row, plan, card, links, snapshot, workspace) : null;
    return { row, link, owned, suggestion };
  }).filter(({ row, link, suggestion }) => (view === "all" || view === "linked" && link || view === "suggested" && suggestion && !link) && [row.label, row.notes ?? "", formatCardDate(row.date), formatAmount(row.amountMinor, 2)].join(" ").toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.row.id === focusId) - Number(a.row.id === focusId) || (view === "suggested" ? (b.suggestion?.score ?? 0) - (a.suggestion?.score ?? 0) : a.row.date.localeCompare(b.row.date)) || a.row.id.localeCompare(b.row.id));
  function staged(row: ActivityRow, role: PlanLink["role"], instalment: number | null): PlanLink {
    if (!plan) throw new Error("Enter the plan amount and dates before linking");
    const cost = financingCostKind(row, card, workspace);
    if (cost && (row.transferId || !["plan-fee", "plan-interest"].includes(role))) throw new Error("Keep financing costs as separate plan expenses");
    if (row.transferId && !trackingTransferMatches(row, plan, snapshot)) throw new Error("Choose a reciprocal transfer through this plan account");
    if (row.date < plan.startDate) throw new Error("A linked entry cannot precede the plan start");
    if (instalment !== null && (!Number.isInteger(instalment) || instalment < 1 || instalment > plan.months)) throw new Error("Choose a valid instalment number, or leave it blank");
    return { planId, transactionId: row.id, fingerprint: row.fingerprint, role, instalment: ["instalment-billed", "combined-instalment"].includes(role) ? instalment : null };
  }
  function stage(row: ActivityRow, role: PlanLink["role"], instalment: number | null) {
    try { const next = staged(row, role, instalment); onChange([...links.filter((entry) => entry.transactionId !== row.id), next]); setError(""); } catch (cause) { setError((cause as Error).message); }
  }
  function applySelected() {
    try {
      const targets = rows.filter((entry) => selected.includes(entry.row.id));
      if (!targets.length || targets.some((entry) => entry.owned || !entry.suggestion)) throw new Error("Select compatible suggestions to apply together");
      const next = targets.map(({ row, suggestion }) => staged(row, suggestion!.role, suggestion!.instalment));
      onChange([...links.filter((link) => !next.some((entry) => entry.transactionId === link.transactionId)), ...next]); setSelected([]); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }
  const selectedRows = rows.filter((entry) => selected.includes(entry.row.id));
  return <div className="space-y-4 p-5"><p className="text-xs text-muted-foreground">Tags are optional. Suggestions use plan references, account links, amounts, dates and descriptions. Choose a candidate when several plans match. Links apply with Save plan; classifications and statement inclusion stay separate.</p>
    <div className="flex flex-wrap items-center gap-2"><SearchInput className="w-72" aria-label="Search plan transactions" placeholder="Payee, notes, date or amount…" value={search} onValueChange={setSearch} /><Select className="w-44" aria-label="Plan transaction view" value={view} onValueChange={setView} options={[{ value: "suggested", label: "Suggested matches" }, { value: "linked", label: `Linked (${links.length})` }, { value: "all", label: "All entries" }]} /><span className="text-xs text-muted-foreground">{rows.length} entries</span>{selectedRows.length > 0 && <><span className="text-xs">{selectedRows.length} selected · {formatAmount(sumMinor(selectedRows.map(({ row }) => row.amountMinor)), 2)}</span><Button size="xs" onClick={applySelected}>Apply selected links</Button></>}</div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {links.filter((link) => !index.has(link.transactionId)).map((link) => <div key={link.transactionId} className="flex justify-between rounded-lg border p-3 text-xs"><span>Check this link: source entry unavailable</span><Button size="xs" variant="outline" onClick={() => onChange(links.filter((entry) => entry !== link))}>Unlink unavailable entry</Button></div>)}
    <div className="overflow-auto rounded-lg border"><table className="w-full min-w-[1050px] table-fixed text-left text-xs"><caption className="sr-only">Plan transactions and suggested matches</caption><colgroup><col style={{ width: 36 }} /><col style={{ width: 105 }} /><col /><col style={{ width: 100 }} /><col style={{ width: 76 }} /><col style={{ width: 150 }} /><col style={{ width: 170 }} /><col style={{ width: 65 }} /><col style={{ width: 100 }} /></colgroup><thead className="bg-muted/30"><tr>{["", "Date", "Payee / notes / match", "Amount", "Cleared", "Classification", "Plan role", "Inst. #", "Link"].map((text) => <th key={text} className="whitespace-nowrap px-2 py-2">{text}</th>)}</tr></thead><tbody>{rows.map(({ row, link, owned, suggestion }) => <Transaction key={`${row.id}:${link?.role}:${link?.fingerprint}`} row={row} link={link} suggestion={suggestion} disabled={!available || Boolean(owned) || !plan} months={plan?.months ?? 1} card={card} budget={budget} workspace={workspace} snapshot={snapshot} onClassified={onClassified} selected={selected.includes(row.id)} onSelect={(checked) => setSelected(checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} onStage={stage} onUnlink={() => onChange(links.filter((entry) => entry.transactionId !== row.id))} />)}</tbody></table>{!rows.length && <p className="p-5 text-xs text-muted-foreground">No entries in this view. Choose All entries to link manually, with or without tags.</p>}</div>
  </div>;
}
function Transaction({ row, link, suggestion, disabled, months, card, budget, workspace, snapshot, selected, onSelect, onClassified, onStage, onUnlink }: { row: ActivityRow; link?: PlanLink; suggestion: ReturnType<typeof suggestPlanLink>; disabled: boolean; months: number; card: Card; budget?: string; workspace: Workspace; snapshot: ActivitySnapshot; selected: boolean; onSelect: (checked: boolean) => void; onClassified?: () => void; onStage: (row: ActivityRow, role: PlanLink["role"], instalment: number | null) => void; onUnlink: () => void }) {
  const cost = financingCostKind(row, card, workspace);
  const trackerEntry = row.accountId !== card.accountId;
  const choices: PlanLink["role"][] = trackerEntry ? ["adjustment"] : cost ? [cost === "interest" ? "plan-interest" : "plan-fee"] : row.transferId ? row.amountMinor > 0 ? ["conversion-credit", "adjustment"] : ["instalment-billed", "principal-release", "adjustment"] : row.amountMinor > 0 ? ["refund", "conversion-credit", "adjustment", "plan-fee", "plan-interest"] : ["combined-instalment", "instalment-billed", "principal-release", "adjustment", "plan-fee", "plan-interest"];
  const [role, setRole] = useState<PlanLink["role"]>(link?.role ?? suggestion?.role ?? choices[0]);
  const [number, setNumber] = useState(String(link?.instalment ?? suggestion?.instalment ?? ""));
  const period = ["instalment-billed", "combined-instalment"].includes(role);
  return <tr className="border-t hover:bg-muted/20"><td className="p-2"><Checkbox aria-label={`Select plan entry ${row.label} ${row.date}`} checked={selected} onCheckedChange={onSelect} disabled={disabled || !suggestion} /></td><td className="p-2 whitespace-nowrap">{formatCardDate(row.date)}</td><td className="min-w-0 p-2"><ReviewText text={row.label} detail={row.notes ?? "No notes"} label="plan transaction details" /><p className="mt-1 text-muted-foreground">{disabled ? "Belongs to another plan or enter plan details" : link ? link.fingerprint === row.fingerprint ? "Linked" : "Check changed source" : suggestion?.reason ?? (trackerEntry ? "Plan-account entry; assign manually" : "Manual match; check amount and period")}</p></td><td className="p-2 text-right tabular-nums">{formatAmount(row.amountMinor, 2)}</td><td className="p-2"><ClearingStatus cleared={row.cleared} /></td><td className="p-2">{budget && !trackerEntry ? <ActivityClassification budget={budget} card={card} row={row} workspace={workspace} snapshot={snapshot} available compact allowPlanActions={false} onClassified={onClassified} /> : trackerEntry ? "Plan account adjustment" : classificationLabels[activityKind(row, card, workspace, snapshot)]}</td><td className="p-2"><Select size="sm" aria-label={`Plan role for ${row.label} ${row.date}`} value={role} onValueChange={(value) => setRole(value as PlanLink["role"])} options={[...new Set([...(link ? [link.role] : []), ...choices])].map((value) => ({ value, label: roleLabels[value] }))} disabled={disabled} /></td><td className="p-2">{period ? <Input size="sm" type="number" min={1} max={months} aria-label={`Instalment for ${row.label} ${row.date}`} value={number} onChange={(event) => setNumber(event.target.value)} /> : "-"}</td><td className="p-2"><div className="flex flex-wrap gap-1"><Button size="xs" variant="outline" disabled={disabled} onClick={() => onStage(row, role, period && number ? Number(number) : null)}>{link ? "Update link" : "Link entry"}</Button>{link && <Button size="xs" variant="ghost" onClick={onUnlink}>Unlink</Button>}</div></td></tr>;
}
