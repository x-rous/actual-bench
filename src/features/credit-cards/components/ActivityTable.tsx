"use client";
import { useMemo, useState } from "react";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { SortableHeader, compareValues, type SortDirection } from "@/components/ui/sortable-header";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { activityKind, activityCategoryLabel, isSettlementCredit, type ActivityRow, type ActivitySnapshot } from "../lib/activity";
import type { Card, Statement, Workspace } from "../lib/models";
import { formatCardDate } from "../lib/displayDates";
import { classificationLabels } from "../lib/classifications";
import { costFamily } from "../lib/recognition";
import { statementReview } from "../lib/statements";
import { ActivityClassification } from "./ActivityClassification";
import { BulkClassification } from "./BulkClassification";
import { ClearingStatus } from "./ClearingStatus";
import { currentPlanLink, planForTransaction, planSources, roleLabels } from "../lib/plans";
import { ReviewText } from "./ReviewText";

const columns = ["Date", "Statement", "Payee", "Category", "Classification", "Plan", "Amount", "Cleared", "Notes"] as const;
type ActivityColumn = typeof columns[number];

export function ActivityTable({ budget, card, workspace, snapshot, available, onMappings }: { budget: string; card: Card; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; onMappings: () => void }) {
  const [search, setSearch] = useState(""), [filter, setFilter] = useState(""), [statementId, setStatementId] = useState("");
  const [sort, setSort] = useState<{ key: ActivityColumn; direction: SortDirection } | null>({ key: "Date", direction: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { reviews, matches } = useMemo(() => {
    const reviews = workspace.statements.filter((entry) => entry.cardId === card.id).sort((a, b) => b.closingDate.localeCompare(a.closingDate)).map((statement) => ({ statement, review: statementReview(statement, workspace, snapshot) }));
    const matches = new Map<string, Statement[]>();
    for (const { statement, review } of reviews) for (const [index, row] of review.rows.entries()) {
      if (review.memberships[index].decision === "included") matches.set(row.id, [...(matches.get(row.id) ?? []), statement]);
    }
    return { reviews, matches };
  }, [card.id, workspace, snapshot]);
  const statements = reviews.map((entry) => entry.statement);
  const selectedStatement = reviews.find((entry) => entry.statement.id === statementId);
  const statement = selectedStatement?.statement, review = selectedStatement?.review;
  const included = review ? new Set(review.rows.filter((_, index) => review.memberships[index].decision === "included").map((row) => row.id)) : null;
  const statementSummary = (row: ActivityRow) => {
    const entries = matches.get(row.id) ?? [];
    if (!entries.length) return { text: "Not assigned", detail: "No included statement match yet. If this transaction has already been billed, check its statement review." };
    return { text: entries.length === 1 ? `${formatCardDate(entries[0].closingDate)}${entries[0].bankConfirmed ? "" : " · estimate"}` : "Check statement", detail: entries.map((entry) => `${entry.bankConfirmed ? "Statement" : "Estimated statement"} ${formatCardDate(entry.closingDate)} · billed balance ${formatAmount(entry.officialBalanceMinor, 2)}`).join("\n") };
  };
  const planSummary = (row: ActivityRow) => {
    const plan = planForTransaction(workspace, row.id);
    if (!plan || plan.cardId !== card.id) return { text: "-", detail: "No plan linked" };
    const link = currentPlanLink(workspace, row);
    const original = planSources(plan).some((source) => source.transactionId === row.id && source.fingerprint === row.fingerprint);
    const name = plan.reference || snapshot.rows.find((entry) => planSources(plan).some((source) => source.transactionId === entry.id))?.label || "Repayment plan";
    const role = original ? "Original" : link ? link.instalment !== null ? `Instalment ${link.instalment}/${plan.months} · ${roleLabels[link.role]}` : roleLabels[link.role] : "Check changed link";
    return { text: `${name} · ${role}`, detail: `${name}\n${role}\nPlan amount ${plan.amountMinor === null ? "unknown" : formatAmount(plan.amountMinor, 2)}${plan.balanceOnly ? " · Balance only" : ` · ${plan.months} instalments`}. The transaction amount below is separate from remaining plan debt.` };
  };
  const rows = snapshot.rows.filter((row) => (!included || included.has(row.id)) && (!filter || activityKind(row, card, workspace, snapshot) === filter) && [row.label, row.notes ?? "", activityCategoryLabel(row, snapshot), planSummary(row).text, statementSummary(row).text, classificationLabels[activityKind(row, card, workspace, snapshot)], formatCardDate(row.date), formatAmount(row.amountMinor, 2)].join(" ").toLowerCase().includes(search.toLowerCase()));
  const value = (row: ActivityRow, column: ActivityColumn) => {
    switch (column) {
      case "Date": return row.date;
      case "Statement": return matches.get(row.id)?.length === 1 ? matches.get(row.id)![0].closingDate : null;
      case "Payee": return row.label === "-" ? null : row.label;
      case "Category": return activityCategoryLabel(row, snapshot);
      case "Classification": return classificationLabels[activityKind(row, card, workspace, snapshot)];
      case "Plan": return planSummary(row).text === "-" ? null : planSummary(row).text;
      case "Amount": return row.amountMinor;
      case "Cleared": return row.cleared === null ? null : Number(row.cleared);
      case "Notes": return row.notes;
    }
  };
  const order = sort?.direction ? { key: sort.key, direction: sort.direction } : { key: "Date" as const, direction: "desc" as const };
  rows.sort((a, b) => compareValues(value(a, order.key), value(b, order.key), order.direction) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const selectedRows = snapshot.rows.filter((row) => selected.has(row.id));
  const selectable = available ? rows : [];
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <BulkClassification budget={budget} card={card} workspace={workspace} snapshot={snapshot} rows={snapshot.rows} selected={selectedRows} available={available} toolbar onMappings={onMappings} onClearSelection={() => setSelected(new Set())} onDone={() => setSelected(new Set())} />
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <SearchInput size="sm" className="w-72 max-w-full" aria-label="Search activity classification" placeholder="Search activity…" value={search} onValueChange={setSearch} />
      <Select size="sm" className="w-48" aria-label="Activity classification filter" value={filter} onValueChange={setFilter} options={[{ value: "", label: "All classifications" }, ...Array.from(new Set(snapshot.rows.map((row) => activityKind(row, card, workspace, snapshot)))).map((kind) => ({ value: kind, label: classificationLabels[kind] }))]} />
      <Select size="sm" className="w-72 max-w-full" aria-label="Activity statement filter" value={statement?.id ?? ""} onValueChange={(value) => { setStatementId(value); setSelected(new Set()); }} options={[{ value: "", label: "All activity" }, ...statements.map((entry) => ({ value: entry.id, label: `Statement ${formatCardDate(entry.closingDate)} · ${formatAmount(entry.officialBalanceMinor, 2)}${entry.bankConfirmed ? "" : " · estimate"}` }))]} />
      <span className="ml-auto text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "transaction" : "transactions"}</span>
    </div>
    {review && <p className="shrink-0 text-xs text-muted-foreground">Included statement transactions · saved review decisions applied.{review.unresolved > 0 && ` ${review.unresolved} more ${review.unresolved === 1 ? "transaction needs" : "transactions need"} statement review.`}{!review.coverage && " Full statement activity is not available; refresh to check coverage."}</p>}
    <div className="min-h-0 flex-1 overflow-auto"><table className="w-full min-w-[1380px] table-fixed text-left text-xs [&_td]:px-2 [&_td]:py-1 [&_td]:align-middle">
      <caption className="sr-only">Actual card activity classification</caption>
      <colgroup>{["32px", "104px", "120px", "176px", "160px", "150px", "200px", "112px", "64px", "auto"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-muted"><tr><th className="w-8 border-b border-border p-2"><Checkbox aria-label="Select visible activity" checked={selectable.length > 0 && selectable.every((row) => selected.has(row.id))} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); for (const row of selectable) if (checked) next.add(row.id); else next.delete(row.id); return next; })} /></th>{columns.map((label) => <SortableHeader key={label} label={label} sortKey={label} sort={sort} onSort={(key, direction) => setSort(direction ? { key, direction } : null)} align={label === "Amount" ? "right" : label === "Cleared" ? "center" : "left"} className="border-b border-border p-2 text-xs font-medium whitespace-nowrap text-muted-foreground" />)}</tr></thead>
      <tbody>{rows.map((row) => {
        const plan = planSummary(row), kind = activityKind(row, card, workspace, snapshot);
        const credit = row.amountMinor > 0 && (kind === "payment" || isSettlementCredit(row, card, workspace, snapshot));
        const cost = row.amountMinor < 0 && costFamily(kind) !== null;
        return <tr key={row.id} className="group/activity border-t hover:bg-muted/20">
          <td><Checkbox aria-label={`Select activity ${row.id}`} disabled={!available} checked={selected.has(row.id)} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; })} /></td>
          <td className="whitespace-nowrap">{formatCardDate(row.date)}</td>
          <td><ReviewText text={statementSummary(row).text} detail={statementSummary(row).detail} label={`statement for ${row.label} ${formatCardDate(row.date)}`} /></td>
          <td><ReviewText text={row.label.trim() || "-"} label="activity payee" /></td>
          <td><ReviewText text={activityCategoryLabel(row, snapshot)} label={`activity category for ${row.label}`} /></td>
          <td><ActivityClassification compact hoverEditIcon budget={budget} card={card} row={row} workspace={workspace} snapshot={snapshot} available={available} /></td>
          <td><ReviewText text={plan.text} detail={plan.detail} label={`plan summary for ${row.label}`} /></td>
          <td className={cn("text-right tabular-nums", cost && "text-destructive", credit && "text-green-700 dark:text-green-400")}>{formatAmount(row.amountMinor, 2)}</td>
          <td><ClearingStatus cleared={row.cleared} available={available} /></td>
          <td className="text-muted-foreground"><ReviewText text={row.notes ?? "-"} label="activity notes" /></td>
        </tr>;
      })}</tbody>
    </table>{!rows.length && <p className="p-3 text-xs text-muted-foreground">No activity matches these filters.</p>}</div>
  </div>;
}
