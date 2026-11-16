"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";
import { SortableHeader, compareValues, type SortDirection } from "@/components/ui/sortable-header";
import { cn } from "@/lib/utils";
import { getTransport } from "@/lib/actual";
import { runQuery } from "@/lib/api/query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { accountRole, counterpartSection, isBorrowing, transferOwner, unplannedTarget, type Placed, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { setMove } from "@/lib/cashflow-planning/document";
import { addMonths, monthEnd, monthLabel } from "@/lib/cashflow-planning/months";
import type { Month, PlanDocument } from "@/lib/cashflow-planning/types";
import { money } from "@/features/financial-insights/format";
import { piecesOf, type TransactionsRequest } from "../lib/transactions";

type Row = { id: string; date: string; amount: number; account: string; category: string | null; notes: string | null; payee: string | null; "payee.transfer_acct": string | null };

type GroupBy = "none" | "month" | "category" | "payee" | "account";
type SortKey = "date" | "account" | "payee" | "category" | "notes" | "amount";

const LIMIT = 2000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-11-05 as 05 Nov 2026. */
const shortDate = (date: string) => `${date.slice(8, 10)} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""} ${date.slice(0, 4)}`;

/**
 * The transactions behind a figure, read from Actual when asked for and never kept. Nothing here changes Actual. The list
 * follows the same placement as the grid, so the rows shown add up to the figure: a transfer that another row follows through its
 * account is left out of a category's list, interest lines counted with a loan are listed with the loan, and a transaction counted
 * in another month is listed in that month. "Counted in" moves a transaction to the month before or after for this plan.
 */
export function TransactionsDialog({ request, doc, snapshot, placed, onEdit, onClose }: { request: TransactionsRequest; doc: PlanDocument; snapshot: Snapshot; placed: Placed; onEdit: (change: (doc: PlanDocument) => PlanDocument) => void; onClose: () => void }) {
  const connection = useConnectionStore(selectActiveInstance);
  const [find, setFind] = useState("");
  // Sorted by a header, or (null) in the order Actual returned: newest first.
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [movedOnly, setMovedOnly] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const months = [...request.months].sort();
  const wantedMonths = new Set(months);
  const from = `${months[0]}-01`;
  const lastDay = monthEnd(months[months.length - 1]);
  const to = lastDay < snapshot.today ? lastDay : snapshot.today;
  const currentMonth = snapshot.today.slice(0, 7);
  const categories = request.items.filter((i) => i.kind === "category").map((i) => i.id);
  const transfers = request.items.filter((i) => i.kind === "transfer").map((i) => i.id);
  const uncategorized = request.items.filter((i) => i.kind === "uncategorized").map((i) => i.id);
  const loans = new Set(request.items.filter((i) => i.kind === "loanCost").map((i) => i.id));
  // Interest and fee lines that count with their loan: listed with the loan, and left out of their category's list.
  const wholeLoans = new Set(placed.contributions.filter((c) => c.kind === "loanCost").map((c) => c.id));
  const costWanted = new Set(snapshot.loanCosts.filter((l) => loans.has(l.loanAccountId)).map((l) => l.id));
  const costElsewhere = new Set(snapshot.loanCosts.filter((l) => wholeLoans.has(l.loanAccountId) && !loans.has(l.loanAccountId)).map((l) => l.id));
  // Transactions dated outside these months but counted in them.
  const movedIn = [...placed.shifted].filter(([, s]) => wantedMonths.has(s.to) && !wantedMonths.has(s.from)).map(([id]) => id).sort();
  // "Moved between months" lists every transaction that left or joined these months; "in transit" the transfers between cash accounts.
  const mode = request.mode;
  const movedAll = mode === "moved" ? [...placed.shifted].filter(([, s]) => wantedMonths.has(s.to) || wantedMonths.has(s.from)).map(([id]) => id).sort() : [];
  const cashList = [...placed.cashIds].sort();

  const query = useQuery({
    queryKey: ["cashflow-planning", "transactions", connection?.id, mode, from, to, categories, transfers, uncategorized, [...costWanted].sort(), movedIn, movedAll, cashList],
    enabled: !!connection,
    gcTime: 0,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      if (mode === "moved") {
        if (movedAll.length === 0) return { rows: [] as Row[], payees: new Map<string, string>() };
        const response = await runQuery<{ data: Row[] }>(connection!, { ActualQLquery: { table: "transactions", filter: { id: { $oneof: movedAll } }, select: ["id", "date", "amount", "account", "category", "notes", "payee", "payee.transfer_acct"], orderBy: [{ date: "desc" }], limit: LIMIT } });
        return { rows: response.data, payees: new Map((await getTransport(connection!).getPayees()).map((p) => [p.id, p.name])) };
      }
      const any: object[] = [];
      if (mode === "transit") any.push({ "payee.transfer_acct": { $oneof: cashList } });
      if (categories.length) any.push({ category: { $oneof: categories } });
      if (transfers.length) any.push({ "payee.transfer_acct": { $oneof: transfers } });
      if (uncategorized.length) any.push({ $and: [{ account: { $oneof: uncategorized } }, { category: null }, { "payee.transfer_acct": null }] });
      if (costWanted.size) any.push({ id: { $oneof: [...costWanted] } });
      if (any.length === 0) return { rows: [] as Row[], payees: new Map<string, string>() };
      const dated: object = { $and: [{ date: { $gte: from } }, { date: { $lte: to } }, { $or: any }] };
      const response = await runQuery<{ data: Row[] }>(connection!, {
        ActualQLquery: {
          table: "transactions",
          filter: { $and: [{ account: { $oneof: [...placed.cashIds] } }, movedIn.length ? { $or: [dated, { id: { $oneof: movedIn } }] } : dated] },
          select: ["id", "date", "amount", "account", "category", "notes", "payee", "payee.transfer_acct"],
          orderBy: [{ date: "desc" }],
          limit: LIMIT,
        },
      });
      const payees = new Map((await getTransport(connection!).getPayees()).map((p) => [p.id, p.name]));
      return { rows: response.data, payees };
    },
  });

  const accountName = new Map(snapshot.accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  const tagOf = new Map(snapshot.shifts.map((s) => [s.id, s.tagMonth]));
  // Accounts some row follows: their transfers belong to that row, whatever category they carry.
  const followed = new Set(doc.rows.flatMap((r) => r.links.accounts.map((a) => a.id)));
  const unplannedOnly = request.targets.length > 0 && request.targets.every((t) => t.startsWith("unplanned:"));
  const wantedTransfers = new Set(transfers), wantedCategories = new Set(categories), wantedUncategorized = new Set(uncategorized);
  const countedIn = (row: Row): Month => placed.shifted.get(row.id)?.to ?? row.date.slice(0, 7);
  const matched = (query.data?.rows ?? []).filter((row) => {
    if (mode === "moved") return true;
    if (!wantedMonths.has(countedIn(row))) return false;
    if (mode === "transit") return !!row["payee.transfer_acct"] && placed.cashIds.has(row["payee.transfer_acct"]);
    if (costWanted.has(row.id)) return true;
    if (costElsewhere.has(row.id)) return false;
    const other = row["payee.transfer_acct"];
    if (other) {
      if (placed.cashIds.has(other)) return false;
      // Money borrowed from a loan and its repayments belong to different rows: list only the direction this figure holds.
      const direction = row.amount >= 0 ? "in" : "out";
      const counterpart = snapshot.accounts.find((a) => a.id === other);
      const counterpartRole = counterpart ? accountRole(doc, counterpart) : undefined;
      const borrowed = direction === "in" && isBorrowing(counterpart, counterpartRole);
      if (wantedTransfers.has(other)) {
        const owner = transferOwner(doc, snapshot, other, direction);
        // With no row to follow, the section it falls in: money borrowed is income, the rest by the account's kind.
        return owner ? request.targets.includes(owner) : request.targets.includes(unplannedTarget(borrowed ? "income" : counterpartSection(counterpartRole, counterpart)));
      }
      // Money borrowed from a loan is never placed by its category.
      return !borrowed && !followed.has(other) && !!row.category && wantedCategories.has(row.category);
    }
    if (row.category) return wantedCategories.has(row.category);
    // A "Not in plan" line holds only the money in or only the money out of an account's uncategorized entries, by its section.
    if (!wantedUncategorized.has(row.account)) return false;
    if (unplannedOnly) return request.sign === 1 ? row.amount > 0 : row.amount < 0;
    // Rows that follow the account for money in and for money out each hold their own direction.
    const owner = transferOwner(doc, snapshot, row.account, row.amount >= 0 ? "in" : "out");
    return owner ? request.targets.includes(owner) : request.targets.includes(unplannedTarget(row.amount >= 0 ? "income" : "expenses"));
  });
  // The search looks at everything shown in a line: date, account, payee, category, notes and amount.
  const needle = find.trim().toLowerCase();
  const rows = !needle ? matched : matched.filter((row) => {
    const other = row["payee.transfer_acct"];
    const text = [row.date, accountName.get(row.account), other ? `Transfer: ${accountName.get(other) ?? ""}` : row.payee ? query.data?.payees.get(row.payee) : "", row.category ? categoryName.get(row.category) : "", row.notes, money(row.amount * request.sign), String(row.amount / 100)].join(" ").toLowerCase();
    return text.includes(needle);
  });
  const payeeText = (row: Row) => { const other = row["payee.transfer_acct"]; return other ? `Transfer: ${accountName.get(other) ?? "another account"}` : row.payee ? query.data?.payees.get(row.payee) ?? "" : ""; };
  const sortValue = (row: Row, key: SortKey): string | number | null => key === "date" ? row.date : key === "account" ? accountName.get(row.account) ?? "" : key === "payee" ? payeeText(row) : key === "category" ? (row.category ? categoryName.get(row.category) ?? "" : "") : key === "notes" ? row.notes ?? "" : row.amount * request.sign;
  const listed = movedOnly ? rows.filter((row) => placed.shifted.has(row.id)) : rows;
  const shown = sort && sort.direction ? [...listed].sort((a, b) => compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.direction!) || a.id.localeCompare(b.id)) : listed;
  const natural = (list: Row[]) => list.reduce((sum, row) => sum + row.amount, 0) * request.sign;
  const total = natural(listed);
  // Grouped, each group with its own subtotal: by the month a transaction counts in, its category or its payee.
  const groupOf = (row: Row): { key: string; label: string } => {
    if (groupBy === "month") { const m = countedIn(row); return { key: m, label: monthLabel(m) }; }
    if (groupBy === "account") { const name = accountName.get(row.account) ?? ""; return { key: row.account, label: name || "Unknown account" }; }
    if (groupBy === "category") { const name = row.category ? categoryName.get(row.category) : null; return { key: name ?? "", label: name ?? "No category" }; }
    const name = payeeText(row); return { key: name, label: name || "No payee" };
  };
  const groups = (() => {
    if (groupBy === "none") return [{ key: "", label: "", rows: shown, total: 0 }];
    const map = new Map<string, { key: string; label: string; rows: Row[]; total: number }>();
    for (const row of shown) { const g = groupOf(row); const entry = map.get(g.key) ?? { ...g, rows: [], total: 0 }; entry.rows.push(row); map.set(g.key, entry); }
    const list = [...map.values()].map((g) => ({ ...g, total: natural(g.rows) }));
    return groupBy === "month" ? list.sort((a, b) => b.key.localeCompare(a.key)) : list.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  })();
  // The figure this list is behind, and whether what is listed adds up to it.
  // From where the transactions sit now, so a move made here changes the figure as it changes the list.
  const expected = piecesOf(placed, snapshot, request.targets, wantedMonths, true).reduce((sum, item) => sum + item.amount, 0);
  const listComplete = (query.data?.rows.length ?? 0) < LIMIT;
  const narrowed = needle !== "" || movedOnly;
  const selectedRows = shown.filter((row) => selected.has(row.id));
  // A move lists money that left one month and joined another, and a transit pairs the two sides of a transfer: neither has a total.
  const showTotal = !mode;
  // Uncategorized entries a row follows can be split by direction in ways this list does not repeat: no comparison then.
  const comparable = uncategorized.length === 0 || unplannedOnly;

  const isInternal = (row: Row) => !!row["payee.transfer_acct"] && placed.cashIds.has(row["payee.transfer_acct"]);

  // Back to its own month: forget the plan's move, or, when its note carries a tag, say so explicitly so the tag no longer applies.
  const moveTo = (row: Row, month: Month): Month | null => { const dated = row.date.slice(0, 7); return month !== dated ? month : tagOf.get(row.id) && tagOf.get(row.id) !== dated ? dated : null; };
  const move = (row: Row, month: Month) => onEdit((d) => setMove(d, row.id, moveTo(row, month)));
  /** The chosen transactions counted in the month before or after their own, or back in it. A month that has not ended holds no actuals to join. */
  const moveSelected = (where: "before" | "own" | "after") => {
    const target = (row: Row) => (where === "own" ? row.date.slice(0, 7) : addMonths(row.date.slice(0, 7), where === "before" ? -1 : 1));
    // A transfer between two cash accounts moves no money in or out of the plan's cash: it stays in its own month.
    const movable = selectedRows.filter((row) => !isInternal(row) && target(row) <= currentMonth);
    if (movable.length > 0) onEdit((d) => movable.reduce((doc, row) => setMove(doc, row.id, moveTo(row, target(row))), d));
    if (movable.length < selectedRows.length) toast.message(`${selectedRows.length - movable.length} not moved: that month has not ended, or it is a transfer between cash accounts.`);
    setSelected(new Set());
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1600px)]">
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-3">
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>Transactions in the plan&apos;s cash accounts, as recorded in Actual. Nothing here changes Actual. “Counted in” moves a transaction to a neighbouring month in this plan only; a <span className="font-mono">#YYYY-MM</span> tag in its Actual note does the same for every plan.</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2">
          <SearchInput value={find} onValueChange={setFind} placeholder="Search these transactions" aria-label="Search these transactions" className="h-8 w-full max-w-sm text-xs" />
          {!mode && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Group by</span>
              <PillGroup<GroupBy> options={[{ value: "none", label: "None" }, { value: "month", label: "Month" }, { value: "category", label: "Category" }, { value: "payee", label: "Payee" }, { value: "account", label: "Account" }]} value={groupBy} onChange={(g) => { setGroupBy(g); setCollapsed(new Set()); }} />
            </div>
          )}
          {(movedOnly || matched.some((row) => placed.shifted.has(row.id))) && <Button size="xs" variant={movedOnly ? "secondary" : "outline"} aria-pressed={movedOnly} onClick={() => setMovedOnly((v) => !v)}><ArrowLeftRight className="size-3" aria-hidden />Moved only</Button>}
        </div>
        {selectedRows.length > 0 && (
          <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/50 px-5 py-1.5 text-xs">
            <span className="font-medium">{selectedRows.length} selected · <span className="tabular-nums">{money(natural(selectedRows))}</span></span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Count in</span>
              <Button size="xs" variant="outline" onClick={() => moveSelected("before")}>The month before</Button>
              <Button size="xs" variant="outline" onClick={() => moveSelected("own")}>Their own month</Button>
              <Button size="xs" variant="outline" onClick={() => moveSelected("after")}>The month after</Button>
            </span>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {query.isLoading ? <p className="p-5 text-sm text-muted-foreground" role="status">Reading transactions…</p>
            : query.isError ? <div className="space-y-2 p-5 text-sm"><p role="alert">The transactions could not be read.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>
            : listed.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{needle ? "No transaction matches the search." : movedOnly ? "No transaction is counted in another month here." : "No transactions."}</p>
            : (
              <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="h-8 w-10 border-b border-border px-3"><Checkbox aria-label="Select all the transactions shown" checked={shown.length > 0 && selectedRows.length === shown.length} indeterminate={selectedRows.length > 0 && selectedRows.length < shown.length} onCheckedChange={(on) => setSelected(on ? new Set(shown.map((r) => r.id)) : new Set())} /></th>
                    {([["date", "Date", "w-[7.5%]"], ["account", "Account", "w-[11.5%]"], ["payee", "Payee", "w-[13.5%]"], ["category", "Category", "w-[15%]"], ["notes", "Notes", ""]] as [SortKey, string, string][]).map(([key, label, width]) => (
                      <SortableHeader<SortKey> key={key} label={label} sortKey={key} sort={sort} onSort={(k, direction) => setSort(direction ? { key: k, direction } : null)} className={cn("h-8 border-b border-border px-3 py-0", width)} />
                    ))}
                    <SortableHeader<SortKey> label="Amount" sortKey="amount" align="right" sort={sort} onSort={(k, direction) => setSort(direction ? { key: k, direction } : null)} className="h-8 w-[7.5%] border-b border-border px-3 py-0" />
                    <th scope="col" className="h-8 w-[17.5%] border-b border-border px-3 font-medium">Counted in</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const open = groupBy === "none" || !collapsed.has(group.key);
                    return (
                      <Fragment key={group.key || "all"}>
                        {groupBy !== "none" && (
                          <tr>
                            <td colSpan={8} className="h-8 border-b border-border bg-muted/50 px-3">
                              <button type="button" aria-expanded={open} onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })} className="flex w-full items-center gap-2 text-left font-medium">
                                {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
                                <span className="min-w-0 truncate">{group.label}</span>
                                <span className="font-normal text-muted-foreground">{group.rows.length} {group.rows.length === 1 ? "transaction" : "transactions"}</span>
                                <span className="ml-auto tabular-nums">{money(group.total)}</span>
                              </button>
                            </td>
                          </tr>
                        )}
                        {open && group.rows.map((row) => {
                          const dated = row.date.slice(0, 7), counted = countedIn(row);
                          const shift = placed.shifted.get(row.id);
                          // The month before, its own, and the month after; a month that has not ended holds no actuals to join.
                          const choices = [...new Set([addMonths(dated, -1), dated, addMonths(dated, 1), counted])].filter((m) => m <= currentMonth || m === counted).sort();
                          return (
                            <tr key={row.id} className={cn("hover:bg-muted/40", selected.has(row.id) && "bg-accent/40")}>
                              <td className="h-8 border-b border-border/40 px-3"><Checkbox aria-label={`Select the transaction of ${shortDate(row.date)}, ${money(row.amount * request.sign)}`} checked={selected.has(row.id)} onCheckedChange={(on) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(row.id); else next.delete(row.id); return next; })} /></td>
                              <td className="h-8 border-b border-border/40 px-3 tabular-nums whitespace-nowrap">{shortDate(row.date)}</td>
                              <td className="truncate border-b border-border/40 px-3" title={accountName.get(row.account) ?? undefined}>{accountName.get(row.account) ?? "-"}</td>
                              <td className="truncate border-b border-border/40 px-3" title={payeeText(row) || undefined}>{payeeText(row) || "-"}</td>
                              <td className="truncate border-b border-border/40 px-3" title={row.category ? categoryName.get(row.category) ?? undefined : undefined}>{row.category ? categoryName.get(row.category) ?? "-" : "-"}</td>
                              <td className="truncate border-b border-border/40 px-3 text-muted-foreground" title={row.notes ?? undefined}>{row.notes ?? ""}</td>
                              <td className="border-b border-border/40 px-3 text-right tabular-nums whitespace-nowrap">{money(row.amount * request.sign)}</td>
                              <td className="border-b border-border/40 px-3">
                                <div className="flex items-center gap-1.5">
                                  {isInternal(row) ? <span className="whitespace-nowrap px-2 text-[11px] text-muted-foreground" title="A transfer between cash accounts is counted in its own month">{monthLabel(dated)}</span> : <div role="radiogroup" aria-label="Month this transaction counts in" title={shift?.byTag ? "Counted in the month its note's tag names" : undefined}
                                    onKeyDown={(e) => {
                                      // Arrows choose the month before or after, as in any radio group; only the chosen one is a tab stop.
                                      const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
                                      const at = choices.indexOf(counted), next = d ? choices[at + d] : undefined;
                                      if (!d) return;
                                      e.preventDefault();
                                      if (next === undefined) return;
                                      e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[at + d]?.focus();
                                      move(row, next);
                                    }}
                                    className="flex gap-px rounded-md border border-border bg-muted/40 p-px">
                                    {choices.map((m) => (
                                      <button key={m} type="button" role="radio" aria-checked={m === counted} tabIndex={m === counted ? 0 : -1} onClick={() => { if (m !== counted) move(row, m); }} className={cn("h-6 whitespace-nowrap rounded px-2 text-[11px]", m === counted ? "bg-background font-semibold text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground/70 hover:text-foreground")}>{monthLabel(m)}</button>
                                    ))}
                                  </div>}
                                  {counted !== dated && <span title={shift?.byTag ? "Moved by the tag in its note" : "Moved in this plan"} className="text-muted-foreground"><ArrowLeftRight className="size-3.5" aria-hidden /><span className="sr-only">{shift?.byTag ? "Moved by the tag in its note" : "Moved in this plan"}</span></span>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
        {listed.length === 0 && !listComplete && <div className="shrink-0 border-t border-border px-5 py-2 text-xs text-muted-foreground">Only the first {LIMIT} transactions are loaded, so a match may be missing.</div>}
        {listed.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border px-5 py-2 text-xs">
            <span className="text-muted-foreground">{listed.length} {listed.length === 1 ? "transaction" : "transactions"}{!listComplete && ` (the first ${LIMIT}; the total may be incomplete)`}</span>
            {showTotal && comparable && (
              <span role="status" className="min-w-0 flex-1 sm:text-right">
                {narrowed ? <span className="text-muted-foreground">Part of the figure ({money(expected)}): the list is narrowed.</span>
                  : !listComplete ? <span className="text-muted-foreground">Not every transaction is loaded, so the total is not compared with the figure.</span>
                  : query.isFetching ? null
                  : natural(matched) === expected ? <span className="font-medium">Matches the figure ({money(expected)}).</span>
                  : <span role="alert" className="font-medium text-amber-700 dark:text-amber-400">Differs from the figure by {money(natural(matched) - expected)}: the figure is {money(expected)}, the list adds up to {money(natural(matched))}.</span>}
              </span>
            )}
            {showTotal && <span className="font-semibold tabular-nums">Total {money(total)}</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
