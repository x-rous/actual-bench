"use client";

import { formatCardDate, CARD_DATE_FORMAT } from "../lib/displayDates";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ArrowRightLeft, Check, Minus, CircleHelp, Save, ShieldCheck } from "lucide-react";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { activityKind } from "../lib/activity";
import { ReviewText } from "./ReviewText";
import { ActivityClassification } from "./ActivityClassification";
import type { ActivitySnapshot } from "../lib/activity";
import type { Membership, Statement, Workspace } from "../lib/models";
import { creditCardStore } from "../lib/memory";
import { effectiveMembership, membershipOwner, movedMemberships, statementReview, type StatementMove } from "../lib/statements";

export function StatementReview({ budget, statement, workspace, snapshot, available, onClose }: {
  budget: string; statement: Statement; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; onClose: () => void;
}) {
  const card = workspace.cards.find((entry) => entry.id === statement.cardId)!;
  const root = useRef<HTMLDivElement>(null);
  const [initialRevision] = useState(statement.revision);
  const [decisions, setDecisions] = useState(() => statementReview(statement, workspace, snapshot).memberships);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decisionFilter, setDecisionFilter] = useState("");
  const [moves, setMoves] = useState<StatementMove[]>([]);
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState("");
  const [clearingFilter, setClearingFilter] = useState("");
  useEffect(() => { root.current?.querySelector<HTMLHeadingElement>("h2")?.focus(); }, []);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ column: "Date", ascending: true });
  const [showPosting, setShowPosting] = useState(false);
  const merged = movedMemberships(statement, workspace, snapshot, decisions, moves);
  const review = statementReview(statement, workspace, snapshot, merged);
  function change(transactionId: string, patch: Partial<Membership>) {
    if (membershipOwner(statement, transactionId, workspace)) return;
    if (patch.decision) setMoves((current) => current.filter((entry) => entry.transactionId !== transactionId));
    setDecisions((current) => {
      const row = snapshot.rows.find((entry) => entry.id === transactionId)!;
      const existing = current.find((entry) => entry.transactionId === transactionId);
      const base = existing?.fingerprint === row.fingerprint ? existing : effectiveMembership(statement, row, workspace.memberships);
      return [...current.filter((entry) => entry.transactionId !== transactionId), { ...base, reason: base.provenance === "manual" ? base.reason : "Statement membership confirmed by user", ...patch, provenance: "manual", fingerprint: row.fingerprint }];
    });
  }
  function save(verify: boolean) {
    try {
      if (root.current?.querySelector('[aria-invalid="true"]')) throw new Error("Correct the invalid bank posting date before saving");
      if (!available) throw new Error("Refresh Actual activity before saving");
      creditCardStore.getState().saveReview(budget, statement.id, initialRevision, snapshot, decisions.map((entry) => membershipOwner(statement, entry.transactionId, workspace) ? { ...entry, decision: "excluded" as const, reason: review.memberships.find((membership) => membership.transactionId === entry.transactionId)!.reason } : entry), verify, moves);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save review"); }
  }
  const confirmOnly = !review.continuity;
  const canComplete = available && statement.bankConfirmed && review.coverage && !review.duplicate && review.unresolved === 0 && (confirmOnly || review.canVerify);
  const blockedReason = !available ? "Refresh Actual activity to continue." : !statement.bankConfirmed ? "Confirm bank values first." : review.duplicate ? "A transaction belongs to another statement." : review.unresolved ? `${review.unresolved} transactions need a decision.` : !review.coverage ? "Load more history to cover this statement." : confirmOnly ? "Confirm transactions; add the preceding statement to reconcile the balance." : review.varianceMinor !== 0 ? "Balance differs; check bank values and transaction decisions." : "";
  const dirty = moves.length > 0 || decisions.some((entry) => { const saved = workspace.memberships.find((item) => item.statementId === statement.id && item.transactionId === entry.transactionId); return entry.provenance === "manual" && (!saved || saved.decision !== entry.decision || saved.reason !== entry.reason || saved.bankPostingDate !== entry.bankPostingDate || saved.fingerprint !== entry.fingerprint); });
  const alreadyVerified = statement.verification === "verified" && !review.stale && review.canVerify && !dirty;
  const targets = workspace.statements.filter((entry) => entry.cardId === card.id && entry.id !== statement.id && entry.bankConfirmed).sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  function stageMove() {
    const target = targets.find((entry) => entry.id === moveTarget);
    if (!target) return;
    setMoves((current) => [...current.filter((entry) => !movingIds.includes(entry.transactionId)), ...movingIds.map((transactionId) => ({ transactionId, targetStatementId: target.id, expectedTargetRevision: target.revision }))]);
    setMovingIds([]); setMoveTarget("");
  }
  const columns = ["Date", "Payee", "Notes", "Category", "Classification", "Amount", "Cleared", "Decision", ...(showPosting ? ["Bank posted"] : []), "Reason"];
  const columnWidths: Record<string, string> = { Date: "104px", Payee: "12%", Category: "12%", Classification: "100px", Amount: "92px", Cleared: "74px", Decision: "104px", "Bank posted": "144px", Reason: "12%" };
  const items = review.rows.map((row, index) => ({ row, decision: review.memberships[index] }));
  const value = (item: typeof items[number], column: string): string | number => {
    const { row, decision } = item;
    switch (column) {
      case "Date": return row.date;
      case "Payee": return row.label;
      case "Notes": return row.notes ?? "";
      case "Category": return row.categoryName ?? row.categoryId ?? "Uncategorized";
      case "Classification": return activityKind(row, card, workspace, snapshot);
      case "Amount": return row.amountMinor;
      case "Cleared": return row.cleared === null ? "Unknown" : row.cleared ? "Cleared" : "Uncleared";
      case "Decision": return decision.decision;
      case "Bank posted": return decision.bankPostingDate ?? "";
      default: return decision.reason;
    }
  };
  const visible = items.filter((item) => (!decisionFilter || item.decision.decision === decisionFilter) && (!clearingFilter || (clearingFilter === "cleared" ? item.row.cleared === true : clearingFilter === "pending" ? item.row.cleared === false : item.row.cleared === null)) && [...columns.map((column) => String(value(item, column))), formatAmount(item.row.amountMinor, 2), formatCardDate(item.row.date), ...(item.decision.bankPostingDate ? [formatCardDate(item.decision.bankPostingDate)] : [])].some((text) => text.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => {
    const left = value(a, sort.column), right = value(b, sort.column);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return (sort.ascending ? comparison : -comparison) || a.row.id.localeCompare(b.row.id);
  });
  const selectedRows = items.filter(({ row }) => selected.has(row.id) && !membershipOwner(statement, row.id, workspace));
  const selectable = visible.filter(({ row }) => !membershipOwner(statement, row.id, workspace));
  const allSelected = selectable.length > 0 && selectable.every(({ row }) => selected.has(row.id));
  function selectVisible(checked: boolean) { setSelected((current) => { const next = new Set(current); for (const { row } of selectable) { if (checked) next.add(row.id); else next.delete(row.id); } return next; }); }
  function bulkDecision(decision: Membership["decision"]) { for (const { row } of selectedRows) change(row.id, { decision }); }
  return <section aria-label={`Review statement · ${formatCardDate(statement.closingDate)}`} className="flex min-h-0 flex-1 flex-col overflow-hidden" ref={root}>
    <div className="shrink-0 space-y-2 border-b border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-3"><Button variant="ghost" size="xs" onClick={onClose}><ArrowLeft className="size-3.5" aria-hidden />Close review</Button><h2 tabIndex={-1} className="text-sm font-semibold outline-none">Review statement · {formatCardDate(statement.closingDate)}</h2><p className="text-xs text-muted-foreground">{formatCardDate(statement.periodStart)} – {formatCardDate(statement.closingDate)} · Due {formatCardDate(statement.dueDate)}</p></div><div className="flex items-center gap-2">{alreadyVerified ? <span className="text-xs font-medium text-chart-2"><ShieldCheck className="mr-1 inline size-3.5" aria-hidden />Verified</span> : canComplete ? <Button size="sm" onClick={() => save(!confirmOnly)}><ShieldCheck className="size-3.5" aria-hidden />{confirmOnly ? "Confirm transactions" : "Save & verify"}</Button> : <Button variant="outline" size="sm" onClick={() => save(false)} disabled={!available}><Save className="size-3.5" aria-hidden />Save decisions</Button>}</div></div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[
        ["Bank balance", formatAmount(statement.officialBalanceMinor, 2)],
        ["Calculated balance", review.calculatedMinor === null ? "Not reconciled" : formatAmount(review.calculatedMinor, 2)],
        ["Variance", review.varianceMinor === null ? "Unavailable" : formatAmount(review.varianceMinor, 2)],
        ["Decisions to review", String(review.unresolved)],
      ].map(([label, value]) => <div key={label} className="rounded-md border border-border px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold tabular-nums">{value}</p></div>)}</div>
      <p className="text-xs text-muted-foreground">{review.continuity ? review.coverage ? "Continuous transaction evidence from the preceding bank balance." : "Transaction history is incomplete." : "Opening anchor: transaction membership can be confirmed; the balance is not independently reconciled."} Statement actions save Bench decisions; global Save applies staged Actual edits.</p>
      {moves.length > 0 && <p role="status" className="text-xs text-muted-foreground">{moves.length} transaction moves staged. Saving updates both statements together and reopens destination review. Close review discards these moves.</p>}
      {review.varianceMinor !== null && review.varianceMinor !== 0 && <div className="flex flex-wrap items-center gap-2 text-xs"><span>Difference {formatAmount(review.varianceMinor, 2)}. Inspect excluded entries, cutoff dates and amounts; candidate amounts are evidence to review, not automatic matches.</span><Button size="xs" variant="outline" onClick={() => setDecisionFilter("excluded")}>Inspect excluded entries</Button><Button size="xs" variant="outline" onClick={() => { setDecisionFilter(""); setShowPosting(true); }}>Inspect posting dates</Button></div>}
      {blockedReason && <p id="statement-review-status" className="text-xs text-muted-foreground">{blockedReason}</p>}
      {decisions.some((entry) => !snapshot.rows.some((row) => row.id === entry.transactionId && row.fingerprint === entry.fingerprint)) && <p role="status" className="text-xs text-muted-foreground">Actual activity changed. Your draft is retained; close and reopen to review the new source before saving.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2"><Input size="sm" className="max-w-sm" aria-label="Search statement transactions" placeholder="Search payee, notes, date or amount…" value={search} onChange={(event) => setSearch(event.target.value)} /><div role="group" aria-label="Statement transaction views" className="flex flex-wrap gap-1">{[{ value: "", label: "All" }, { value: "review", label: "Needs review" }, { value: "included", label: "Included" }, { value: "excluded", label: "Excluded" }].map((view) => <Button key={view.value} size="xs" variant="outline" aria-pressed={decisionFilter === view.value} onClick={() => setDecisionFilter(view.value)}>{view.label} ({items.filter((item) => !view.value || item.decision.decision === view.value).length})</Button>)}</div><Select size="sm" className="w-36" aria-label="Filter review clearing" value={clearingFilter} onValueChange={setClearingFilter} options={[{ value: "", label: "Any clearing status" }, { value: "cleared", label: "Cleared" }, { value: "pending", label: "Uncleared" }, { value: "unknown", label: "Unknown" }]} />{(search || decisionFilter || clearingFilter) && <Button size="xs" variant="ghost" onClick={() => { setSearch(""); setDecisionFilter(""); setClearingFilter(""); }}>Clear filters</Button>}<span className="text-xs text-muted-foreground">{visible.length} of {items.length} transactions</span><Button size="xs" variant="outline" title="Optional bank booking dates for billing cutoff or repayment timing differences" aria-pressed={showPosting} onClick={() => setShowPosting(!showPosting)}>Bank posting dates</Button><p className="ml-auto text-xs text-muted-foreground" title={`#${statement.closingDate.slice(0, 7)} matches this statement; decisions override tags`}>Statement tags suggest matches · decisions override tags</p></div>
      {selectedRows.length > 0 && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Selected transaction actions"><span className="text-xs">{selectedRows.length} selected (including hidden rows)</span>{(["included", "excluded", "review"] as const).map((choice) => { const label = choice === "included" ? "Include selected" : choice === "excluded" ? "Exclude selected" : "Mark selected undecided"; return <Button key={choice} variant="outline" size="icon-xs" aria-label={label} title={label} onClick={() => bulkDecision(choice)}>{choice === "included" ? <Check className="size-3" aria-hidden /> : choice === "excluded" ? <Minus className="size-3" aria-hidden /> : <CircleHelp className="size-3" aria-hidden />}</Button>; })}<Button size="xs" variant="outline" disabled={!available || !targets.length} onClick={() => { setMovingIds(selectedRows.map(({ row }) => row.id)); setMoveTarget(""); }}><ArrowRightLeft className="size-3" aria-hidden />Move selected</Button><Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button></div>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto"><table className="w-full min-w-[1000px] table-fixed text-xs text-left [&_td]:whitespace-nowrap [&_td]:align-middle"><caption className="sr-only">Statement transaction membership decisions</caption><colgroup><col style={{ width: "32px" }} />{columns.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}</colgroup><thead className="sticky top-0 z-10 bg-muted"><tr><th className="w-8 px-2 py-1" scope="col"><Checkbox aria-label="Select visible transactions" checked={allSelected} indeterminate={!allSelected && selectable.some(({ row }) => selected.has(row.id))} onCheckedChange={selectVisible} /></th>{columns.map((column) => <th className="border-b px-2 py-1" scope="col" key={column} aria-sort={sort.column === column ? sort.ascending ? "ascending" : "descending" : "none"}><button className="whitespace-nowrap font-medium" onClick={() => setSort({ column, ascending: sort.column === column ? !sort.ascending : true })}>{column}{sort.column === column ? sort.ascending ? " ↑" : " ↓" : " ↕"}</button></th>)}</tr></thead><tbody>{visible.map(({ row, decision }) => <tr className={`border-b border-border ${decision.decision === "review" ? "bg-chart-5/5 hover:bg-chart-5/10" : "hover:bg-muted/30"}`} key={row.id}>
      <td className="px-2 py-1"><Checkbox aria-label={`Select transaction ${row.label} ${formatCardDate(row.date)} ${row.id}`} disabled={Boolean(membershipOwner(statement, row.id, workspace))} checked={selected.has(row.id)} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; })} /></td><td className="px-2 py-1 whitespace-nowrap">{formatCardDate(row.date)}</td><td className="px-2 py-1"><ReviewText text={row.label} label={`payee for ${formatCardDate(row.date)}`} /></td><td className="px-2 py-1"><ReviewText text={row.notes || "-"} label={`notes for ${row.label}`} /></td><td className="px-2 py-1"><ReviewText text={row.categoryName ?? row.categoryId ?? "Uncategorized"} label={`category for ${row.label}`} /></td><td className="px-2 py-1"><ActivityClassification compact budget={budget} card={card} row={row} workspace={workspace} snapshot={snapshot} available={available} /></td><td className={`px-2 py-1 tabular-nums whitespace-nowrap ${row.amountMinor < 0 ? "text-destructive" : activityKind(row, card, workspace, snapshot) === "payment" ? "text-chart-2" : ""}`}>{formatAmount(row.amountMinor, 2)}</td><td className="px-2 py-1"><span className={row.cleared ? "text-chart-2" : "text-muted-foreground"}>{row.cleared === null ? "Unknown" : row.cleared ? "Cleared" : "Uncleared"}</span></td>
      <td className="px-2 py-1"><div role="group" aria-label={`Decision for ${row.label}`} className="flex items-center gap-1">{(["included", "excluded", "review"] as const).map((choice) => { const label = choice === "included" ? "Include" : choice === "excluded" ? "Exclude" : "Undecided"; return <Button key={choice} size="icon-xs" variant="outline" disabled={Boolean(membershipOwner(statement, row.id, workspace))} aria-pressed={decision.decision === choice} aria-label={`${label} ${row.label}`} title={membershipOwner(statement, row.id, workspace) ? `${label}: ${decision.reason}` : label} className={decision.decision === choice ? choice === "included" ? "border-chart-2/50 bg-chart-2/10 text-chart-2" : choice === "review" ? "border-chart-5/60 bg-chart-5/15" : "border-foreground/40 bg-muted" : "bg-transparent text-muted-foreground"} onClick={() => change(row.id, { decision: choice })}>{choice === "included" ? <Check className="size-3" aria-hidden /> : choice === "excluded" ? <Minus className="size-3" aria-hidden /> : <CircleHelp className="size-3" aria-hidden />}</Button>; })}</div></td>
      {showPosting && <td className="px-2 py-1"><DateInput dateFormat={CARD_DATE_FORMAT} size="sm" aria-label={`Bank posting date for ${row.label}`} disabled={Boolean(membershipOwner(statement, row.id, workspace))} value={decision.bankPostingDate ?? ""} onValueChange={(date) => change(row.id, { bankPostingDate: date || null })} /></td>}
      <td className="px-2 py-1"><div className="flex items-center gap-1"><Input size="sm" className="h-6 min-w-0 border-transparent shadow-none hover:border-border focus-visible:border-ring" title={decision.reason} aria-label={`Reason for ${row.label}`} readOnly={Boolean(membershipOwner(statement, row.id, workspace))} maxLength={500} value={decision.reason} onChange={(event) => change(row.id, { reason: event.target.value })} /><Button variant="ghost" size="xs" aria-label={`Move ${row.label} to another statement`} title="Move to another statement" disabled={!available || !targets.length || Boolean(membershipOwner(statement, row.id, workspace))} onClick={() => { setMovingIds([row.id]); setMoveTarget(""); }}><ArrowRightLeft className="size-3" aria-hidden /></Button></div></td>
    </tr>)}</tbody></table>{visible.length === 0 && <p className="p-4 text-xs text-muted-foreground">{items.length ? "No transactions match your search." : "No activity in this statement window."}</p>}</div>
    <Dialog open={movingIds.length > 0} onOpenChange={(open) => { if (!open) setMovingIds([]); }}><DialogContent><DialogTitle>Move transactions to another statement</DialogTitle><DialogDescription>{movingIds.length} transactions will be excluded from {formatCardDate(statement.closingDate)} and included in the selected statement. Both statements update together on Save; the destination needs review.</DialogDescription><Select aria-label="Destination statement" value={moveTarget} onValueChange={setMoveTarget} options={[{ value: "", label: "Choose statement" }, ...targets.map((entry) => ({ value: entry.id, label: formatCardDate(entry.closingDate) }))]} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setMovingIds([])}>Cancel move</Button><Button disabled={!moveTarget} onClick={stageMove}>Stage move</Button></div></DialogContent></Dialog>
  </section>;
}
