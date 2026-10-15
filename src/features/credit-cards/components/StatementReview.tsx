"use client";

import { formatCardDate } from "../lib/displayDates";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { SortableHeader, compareValues, type SortDirection } from "@/components/ui/sortable-header";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreHorizontal, TriangleAlert, CircleCheck, LockKeyhole, CalendarDays, ArrowLeft, ArrowRightLeft, Check, Minus, CircleHelp, Save, ShieldCheck } from "lucide-react";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { activityKind } from "../lib/activity";
import { ReviewText } from "./ReviewText";
import { ClearingStatus } from "./ClearingStatus";
import { FieldInfo } from "./FieldInfo";
import { BulkClassification } from "./BulkClassification";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { ActivityClassification } from "./ActivityClassification";
import type { ActivitySnapshot } from "../lib/activity";
import type { Membership, Statement, Workspace } from "../lib/models";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { currentPlanLink, planForTransaction } from "../lib/plans";
import { planEligibleKinds } from "../lib/classifications";
import { PlanEditor } from "./PlanEditor";
import { creditCardStore } from "../lib/memory";
import { effectiveMembership, membershipOwner, movedMemberships, statementReview, sumMinor, type StatementMove } from "../lib/statements";

export function StatementReview({ budget, statement, workspace, snapshot, available, onClose, onMappings, workspaceActions }: {
  budget: string; statement: Statement; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; onClose: () => void; onMappings?: () => void; workspaceActions?: ReactNode;
}) {
  const card = workspace.cards.find((entry) => entry.id === statement.cardId)!;
  const root = useRef<HTMLDivElement>(null);
  const [initialRevision] = useState(statement.revision);
  const [initialDecisions] = useState(() => statementReview(statement, workspace, snapshot).memberships);
  const [decisions, setDecisions] = useState(initialDecisions);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decisionFilter, setDecisionFilter] = useState("");
  const [moves, setMoves] = useState<StatementMove[]>([]);
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const [planRowId, setPlanRowId] = useState<string | null>(null);
  const [clearingFilter, setClearingFilter] = useState("");
  useEffect(() => { root.current?.querySelector<HTMLHeadingElement>("h2")?.focus(); }, []);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>({ key: "Date", direction: "asc" });
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
      if (!available) throw new Error("Refresh Actual activity before saving");
      creditCardStore.getState().saveReview(budget, statement.id, initialRevision, snapshot, decisions.map((entry) => membershipOwner(statement, entry.transactionId, workspace) ? { ...entry, decision: "excluded" as const, reason: review.memberships.find((membership) => membership.transactionId === entry.transactionId)!.reason } : entry), verify, moves);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save review"); }
  }
  const confirmOnly = review.calculatedMinor === null;
  const resultMatches = available && review.canVerify;
  const canComplete = available && statement.bankConfirmed && review.coverage && !review.duplicate && review.unresolved === 0 && (confirmOnly || review.canVerify);
  const blockedReason = !available ? "Refresh Actual activity to continue." : !statement.bankConfirmed ? "Confirm bank values first." : review.duplicate ? "A transaction belongs to another statement." : review.unresolved ? `${review.unresolved} transactions need a decision.` : !review.coverage ? "Load more history to cover this statement." : confirmOnly ? statement.openingAnchor ? "Opening balance not supplied. Enter the balance brought forward in bank values to reconcile this statement." : "Confirm transactions; add the preceding statement to reconcile the balance." : review.varianceMinor !== 0 ? "Balance differs; check bank values and transaction decisions." : "";
  const dirty = moves.length > 0 || decisions.some((entry) => { const saved = initialDecisions.find((item) => item.transactionId === entry.transactionId); return entry.provenance === "manual" && (!saved || saved.decision !== entry.decision || saved.reason !== entry.reason || saved.bankPostingDate !== entry.bankPostingDate || saved.fingerprint !== entry.fingerprint); });
  const { requestClose, discardDialog } = useDiscardChanges(dirty, onClose);
  const alreadyVerified = statement.verification === "verified" && !review.stale && review.canVerify && !dirty;
  const targets = workspace.statements.filter((entry) => entry.cardId === card.id && entry.id !== statement.id && entry.bankConfirmed).sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  function stageMove() {
    const target = targets.find((entry) => entry.id === moveTarget);
    if (!target) return;
    setMoves((current) => [...current.filter((entry) => !movingIds.includes(entry.transactionId)), ...movingIds.map((transactionId) => ({ transactionId, targetStatementId: target.id, expectedTargetRevision: target.revision }))]);
    setMovingIds([]); setMoveTarget("");
  }
  const columns = ["Date", "Payee", "Notes", "Category", "Classification", "Amount", "Cleared", "Decision", "Reason"];
  const columnWidths: Record<string, string> = { Date: "104px", Payee: "160px", Category: "150px", Classification: "110px", Amount: "96px", Cleared: "44px", Decision: "92px", Reason: "205px" };
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
      default: return decision.reason;
    }
  };
  const visible = items.filter((item) => (!decisionFilter || item.decision.decision === decisionFilter) && (!classificationFilter || ["unclassified", "ambiguous"].includes(activityKind(item.row, card, workspace, snapshot))) && (!clearingFilter || (clearingFilter === "cleared" ? item.row.cleared === true : clearingFilter === "pending" ? item.row.cleared === false : item.row.cleared === null)) && [item.row.notes ?? "", activityKind(item.row, card, workspace, snapshot), ...columns.map((column) => String(value(item, column))), formatAmount(item.row.amountMinor, 2), formatCardDate(item.row.date)].some((text) => text.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => {
    return sort?.direction ? compareValues(value(a, sort.key), value(b, sort.key), sort.direction) || a.row.id.localeCompare(b.row.id) : 0;
  });
  const selectedRows = items.filter(({ row }) => selected.has(row.id) && !membershipOwner(statement, row.id, workspace));
  const selectable = visible.filter(({ row }) => !membershipOwner(statement, row.id, workspace));
  const allSelected = selectable.length > 0 && selectable.every(({ row }) => selected.has(row.id));
  function selectVisible(checked: boolean) { setSelected((current) => { const next = new Set(current); for (const { row } of selectable) { if (checked) next.add(row.id); else next.delete(row.id); } return next; }); }
  function bulkDecision(decision: Membership["decision"]) { for (const { row } of selectedRows) change(row.id, { decision }); }
  return <section aria-label={`Review statement · ${formatCardDate(statement.closingDate)}`} className="flex min-h-0 flex-1 flex-col overflow-hidden" ref={root}>
    <div className="shrink-0 space-y-2 border-b border-border bg-background px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-3"><Button variant="ghost" size="xs" onClick={requestClose}><ArrowLeft className="size-3.5" aria-hidden />Close review</Button><div className="min-w-0"><h2 tabIndex={-1} className="text-sm font-semibold outline-none">Review statement · {formatCardDate(statement.closingDate)}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground" title={card.nickname}>{card.nickname}</p></div></div><div className="flex flex-wrap items-center gap-2">{workspaceActions}{alreadyVerified ? <span className="text-xs font-medium text-green-700 dark:text-green-400"><ShieldCheck className="mr-1 inline size-3.5" aria-hidden />Verified</span> : canComplete ? <Button size="sm" onClick={() => save(!confirmOnly)}><ShieldCheck className="size-3.5" aria-hidden />{confirmOnly ? "Confirm transactions" : "Save & verify"}</Button> : <Button variant="outline" size="sm" onClick={() => save(false)} disabled={!available}><Save className="size-3.5" aria-hidden />Save decisions</Button>}</div></div>
      <div className="grid gap-3 border-y py-3 md:grid-cols-[1.15fr_1fr_1.1fr]"><section className="rounded-lg border p-3" aria-label="Calculated from Actual"><h3 className="mb-2 text-xs font-semibold">Calculated from Actual</h3><dl className="space-y-1.5 text-[13px]">{[
        ["Previous bank balance", review.startingBalanceMinor === null ? "Not supplied" : formatAmount(review.startingBalanceMinor, 2)],
        ["Charges", formatAmount(sumMinor(review.rows.filter((row, index) => review.memberships[index].decision === "included" && row.amountMinor < 0).map((row) => -row.amountMinor)), 2)],
        ["Payments & credits", formatAmount(sumMinor(review.rows.filter((row, index) => review.memberships[index].decision === "included" && row.amountMinor > 0).map((row) => row.amountMinor)), 2)],
        ["Calculated balance", review.calculatedMinor === null ? "Not reconciled" : formatAmount(review.calculatedMinor, 2)],
      ].map(([label, value], index) => <div key={label} className={`flex justify-between gap-3 ${index === 3 ? "border-t pt-2 font-semibold" : ""}`}><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}</dl></section>
      <section className="rounded-lg border p-3" aria-label="Bank statement"><h3 className="text-xs font-semibold">Bank statement</h3><p className="mt-1 text-2xl font-semibold tabular-nums">{formatAmount(statement.officialBalanceMinor, 2)}</p><p className="text-xs text-muted-foreground">Closing balance on {formatCardDate(statement.closingDate)}</p><p className="mt-2 text-xs text-muted-foreground">Period {formatCardDate(statement.periodStart)} – {formatCardDate(statement.closingDate)}</p><p className="mt-1 text-xs">Pay by {formatCardDate(statement.dueDate)} · minimum {formatAmount(statement.minimumDueMinor, 2)}</p></section>
      <section className={`flex flex-col justify-center rounded-lg border p-3 ${resultMatches ? "border-chart-2/20 bg-chart-2/5" : "border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/20"}`} aria-label="Reconciliation result"><div className="flex items-center gap-2">{resultMatches ? <CircleCheck role="img" aria-label="Bank balance matches" className="size-5 shrink-0 text-green-700 dark:text-green-400" /> : <TriangleAlert role="img" aria-label="Reconciliation needs attention" className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />}<h3 className="text-sm font-semibold">{resultMatches ? "Matches bank balance" : !available ? "Evidence unavailable" : review.unresolved || !review.coverage ? "Evidence needs review" : confirmOnly ? "Opening balance required" : "Balance differs"}</h3><FieldInfo label="Statement evidence and saving">{review.continuity ? review.coverage ? "Continuous transaction evidence from the preceding bank balance." : "Transaction history is incomplete." : review.startingBalanceMinor !== null ? `Balance brought forward: ${formatAmount(review.startingBalanceMinor, 2)}. ${review.coverage ? "Reconciled against this cycle’s included transactions; earlier periods are not verified." : "Transaction history is incomplete."}` : "Opening balance not supplied: transaction membership can be confirmed; the balance is not independently reconciled."} Statement actions save Bench decisions; global Save applies staged Actual edits. Classification changes save immediately; membership decisions save with the statement action.</FieldInfo></div><p className="mt-2 text-sm">Variance: {review.varianceMinor === null ? "Not independently reconciled" : formatAmount(review.varianceMinor, 2)}</p><p className="mt-1 text-xs">Decisions to review: {review.unresolved}</p></section></div>
      <BulkClassification budget={budget} card={card} workspace={workspace} snapshot={snapshot} rows={review.rows} selected={selectedRows.map((entry) => entry.row)} available={available} onMappings={onMappings} onDone={() => setSelected(new Set())} />
      {moves.length > 0 && <p role="status" className="text-xs text-muted-foreground">{moves.length} transaction moves staged. Saving updates both statements together and reopens destination review. Close review discards these moves.</p>}
      {statement.bankConfirmed && review.unresolved === 0 && review.coverage && review.varianceMinor !== null && review.varianceMinor !== 0 && <div className="flex flex-wrap items-center gap-2 text-xs"><span>Difference {formatAmount(review.varianceMinor, 2)}. Inspect excluded entries, cutoff dates and amounts; candidate amounts are evidence to review, not automatic matches.</span><Button size="xs" variant="outline" onClick={() => setDecisionFilter("excluded")}>Inspect excluded entries</Button></div>}
      {blockedReason && <p id="statement-review-status" className="text-xs text-muted-foreground">{blockedReason}</p>}
      {decisions.some((entry) => !snapshot.rows.some((row) => row.id === entry.transactionId && row.fingerprint === entry.fingerprint)) && <p role="status" className="text-xs text-muted-foreground">Actual activity changed. Your draft is retained; close and reopen to review the new source before saving.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2"><SearchInput size="sm" className="w-72 max-w-full" aria-label="Search statement transactions" placeholder="Search payee, notes, date or amount…" value={search} onValueChange={setSearch} /><div role="group" aria-label="Statement transaction views" className="flex flex-wrap gap-1">{[{ value: "", label: "All" }, { value: "review", label: "Needs review" }, { value: "included", label: "Included" }, { value: "excluded", label: "Excluded" }].map((view) => <Button key={view.value} size="xs" variant={decisionFilter === view.value ? "secondary" : "outline"} className={decisionFilter === view.value ? "ring-1 ring-foreground" : undefined} aria-pressed={decisionFilter === view.value} onClick={() => setDecisionFilter(view.value)}>{view.label} ({items.filter((item) => !view.value || item.decision.decision === view.value).length})</Button>)}</div><Select size="sm" className="w-36" aria-label="Filter review clearing" value={clearingFilter} onValueChange={setClearingFilter} options={[{ value: "", label: "Any clearing status" }, { value: "cleared", label: "Cleared" }, { value: "pending", label: "Uncleared" }, { value: "unknown", label: "Unknown" }]} /><Select size="sm" className="w-44" aria-label="Filter classification" value={classificationFilter} onValueChange={setClassificationFilter} options={[{ value: "", label: "All classifications" }, { value: "unclassified", label: `Unclassified (${items.filter((item) => ["unclassified", "ambiguous"].includes(activityKind(item.row, card, workspace, snapshot))).length})` }]} />{(search || decisionFilter || clearingFilter || classificationFilter) && <Button size="xs" variant="ghost" onClick={() => { setSearch(""); setDecisionFilter(""); setClearingFilter(""); setClassificationFilter(""); }}>Clear filters</Button>}<span className="text-xs text-muted-foreground">{visible.length} of {items.length} transactions</span><p className="ml-auto text-xs text-muted-foreground" title={`#${statement.closingDate.slice(0, 7)} matches this statement; decisions override tags`}>Statement tags suggest matches · decisions override tags</p></div>
      {selectedRows.length > 0 && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Selected transaction actions"><span className="text-xs">{selectedRows.length} selected (including hidden rows)</span>{(["included", "excluded", "review"] as const).map((choice) => { const label = choice === "included" ? "Include selected" : choice === "excluded" ? "Exclude selected" : "Mark selected undecided"; return <Button key={choice} variant="outline" size="icon-xs" aria-label={label} title={label} onClick={() => bulkDecision(choice)}>{choice === "included" ? <Check className="size-3" aria-hidden /> : choice === "excluded" ? <Minus className="size-3" aria-hidden /> : <CircleHelp className="size-3" aria-hidden />}</Button>; })}<Button size="xs" variant="outline" disabled={!available || !targets.length} onClick={() => { setMovingIds(selectedRows.map(({ row }) => row.id)); setMoveTarget(""); }}><ArrowRightLeft className="size-3" aria-hidden />Move selected</Button><Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button></div>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto"><table className="w-full min-w-[1280px] table-fixed text-xs text-left [&_td]:whitespace-nowrap [&_td]:align-middle"><caption className="sr-only">Statement transaction membership decisions</caption><colgroup><col style={{ width: "32px" }} />{columns.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}</colgroup><thead className="sticky top-0 z-10 bg-muted"><tr><th className="w-8 px-2 py-1" scope="col"><Checkbox aria-label="Select visible transactions" checked={allSelected} indeterminate={!allSelected && selectable.some(({ row }) => selected.has(row.id))} onCheckedChange={selectVisible} /></th>{columns.map((column) => <SortableHeader key={column} label={column} sortKey={column} sort={sort} onSort={(key, direction) => setSort(direction ? { key, direction } : null)} leading={column === "Cleared" ? <CircleCheck className="size-3.5 shrink-0" aria-hidden /> : undefined} className={column === "Cleared" ? "border-b px-2 py-1 [&_span]:sr-only" : "border-b px-2 py-1"} align={column === "Amount" ? "right" : "left"} />)}</tr></thead><tbody>{visible.map(({ row, decision }) => <tr className={`border-b border-border ${decision.decision === "review" ? "bg-chart-5/5 hover:bg-chart-5/10" : "hover:bg-muted/30"}`} key={row.id}>
      <td className="px-2 py-1"><Checkbox aria-label={`Select transaction ${row.label} ${formatCardDate(row.date)} ${row.id}`} disabled={Boolean(membershipOwner(statement, row.id, workspace))} checked={selected.has(row.id)} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; })} /></td><td className="px-2 py-1 whitespace-nowrap">{formatCardDate(row.date)}</td><td className="px-2 py-2"><div className="flex min-w-0 items-center gap-1"><ReviewText text={row.label} label={`payee for ${formatCardDate(row.date)}`} className="font-medium" />{planForTransaction(workspace, row.id) && <Button size="xs" variant="outline" className="h-5 text-xs" onClick={() => setPlanRowId(row.id)}>Plan</Button>}</div></td><td className="px-2 py-2 text-muted-foreground"><ReviewText text={row.notes || "-"} label={`notes for ${row.label}`} /></td><td className="px-2 py-2"><ReviewText text={row.categoryName ?? row.categoryId ?? "Uncategorized"} label={`category for ${row.label}`} /></td><td className="px-2 py-2"><ActivityClassification compact budget={budget} card={card} row={row} workspace={workspace} snapshot={snapshot} available={available} /></td><td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${row.amountMinor < 0 ? "text-destructive" : activityKind(row, card, workspace, snapshot) === "payment" ? "text-green-700 dark:text-green-400" : ""}`}>{formatAmount(row.amountMinor, 2)}</td><td className="px-2 py-1"><ClearingStatus cleared={row.cleared} /></td>
      <td className="px-2 py-1">{membershipOwner(statement, row.id, workspace) ? <span role="img" aria-label={`Excluded and locked: ${decision.reason}`} title={`Excluded: ${decision.reason}`} className="flex justify-center text-muted-foreground"><LockKeyhole className="size-3.5" aria-hidden /></span> : <div role="group" aria-label={`Decision for ${row.label}`} className="inline-flex overflow-hidden rounded-md border border-border">{(["included", "excluded", "review"] as const).map((choice) => { const label = choice === "included" ? "Include" : choice === "excluded" ? "Exclude" : "Undecided"; return <Button key={choice} size="icon-xs" variant="ghost" disabled={Boolean(membershipOwner(statement, row.id, workspace))} aria-pressed={decision.decision === choice} aria-label={`${label} ${row.label}`} title={membershipOwner(statement, row.id, workspace) ? `${label}: ${decision.reason}` : label} className={`size-6 rounded-none border-0 shadow-none ${decision.decision === choice ? choice === "included" ? "border-chart-2/50 bg-chart-2/10 text-green-700 dark:text-green-400" : choice === "review" ? "border-chart-5/60 bg-chart-5/15" : "border-foreground/40 bg-muted" : "bg-transparent text-muted-foreground"}`} onClick={() => change(row.id, { decision: choice })}>{choice === "included" ? <Check className="size-3" aria-hidden /> : choice === "excluded" ? <Minus className="size-3" aria-hidden /> : <CircleHelp className="size-3" aria-hidden />}</Button>; })}</div>}</td>
      <td className="px-2 py-1"><div className="flex items-center gap-1"><Input size="sm" className="min-w-0 text-xs border-transparent shadow-none hover:border-border focus-visible:border-ring" title={decision.reason} aria-label={`Reason for ${row.label}`} readOnly={Boolean(membershipOwner(statement, row.id, workspace))} maxLength={500} value={decision.reason} onChange={(event) => change(row.id, { reason: event.target.value })} /><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Transaction actions ${row.label}`} />}><MoreHorizontal className="size-3" /></DropdownMenuTrigger><DropdownMenuContent>{!currentPlanLink(workspace, row) && planEligibleKinds.includes(activityKind(row, card, workspace, snapshot)) && <DropdownMenuItem onClick={() => setPlanRowId(row.id)}><CalendarDays className="size-3" />{planForTransaction(workspace, row.id) ? "View repayment plan" : "Add instalment plan"}</DropdownMenuItem>}<DropdownMenuItem disabled={!available || !targets.length || Boolean(membershipOwner(statement, row.id, workspace))} onClick={() => { setMovingIds([row.id]); setMoveTarget(""); }}><ArrowRightLeft className="size-3" />Move to another statement</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></td>
    </tr>)}</tbody></table>{visible.length === 0 && <p className="p-4 text-xs text-muted-foreground">{items.length ? "No transactions match your search." : "No activity in this statement window."}</p>}</div>
    {discardDialog}
    {planRowId && snapshot.rows.find((row) => row.id === planRowId) && <PlanEditor budget={budget} card={card} row={snapshot.rows.find((row) => row.id === planRowId)!} plan={planForTransaction(workspace, planRowId)} workspace={workspace} snapshot={snapshot} available={available} onClose={() => setPlanRowId(null)} />}
    <Dialog open={movingIds.length > 0} onOpenChange={(open) => { if (!open) setMovingIds([]); }}><DialogContent className="rounded-2xl"><DialogTitle>Move transactions to another statement</DialogTitle><DialogDescription>{movingIds.length} transactions will be excluded from {formatCardDate(statement.closingDate)} and included in the selected statement. Both statements update together on Save; the destination needs review.</DialogDescription><Select aria-label="Destination statement" value={moveTarget} onValueChange={setMoveTarget} options={[{ value: "", label: "Choose statement" }, ...targets.map((entry) => ({ value: entry.id, label: formatCardDate(entry.closingDate) }))]} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setMovingIds([])}>Cancel move</Button><Button disabled={!moveTarget} onClick={stageMove}>Stage move</Button></div></DialogContent></Dialog>
  </section>;
}
