"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { getTransport } from "@/lib/actual";
import { runQuery } from "@/lib/api/query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { transferOwner, type Placed, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { setMove } from "@/lib/cashflow-planning/document";
import { addMonths, monthEnd, monthLabel } from "@/lib/cashflow-planning/months";
import type { Month, PlanDocument } from "@/lib/cashflow-planning/types";
import { money } from "@/features/financial-insights/format";
import type { TransactionsRequest } from "../lib/transactions";

type Row = { id: string; date: string; amount: number; account: string; category: string | null; notes: string | null; payee: string | null; "payee.transfer_acct": string | null };

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
      if (wantedTransfers.has(other)) { const owner = transferOwner(doc, snapshot, other, row.amount >= 0 ? "in" : "out"); return owner ? request.targets.includes(owner) : request.targets.some((t) => t.startsWith("unplanned:")); }
      return !followed.has(other) && !!row.category && wantedCategories.has(row.category);
    }
    return row.category ? wantedCategories.has(row.category) : wantedUncategorized.has(row.account);
  });
  // The search looks at everything shown in a line: date, account, payee, category, notes and amount.
  const needle = find.trim().toLowerCase();
  const rows = !needle ? matched : matched.filter((row) => {
    const other = row["payee.transfer_acct"];
    const text = [row.date, accountName.get(row.account), other ? `Transfer: ${accountName.get(other) ?? ""}` : row.payee ? query.data?.payees.get(row.payee) : "", row.category ? categoryName.get(row.category) : "", row.notes, money(row.amount * request.sign), String(row.amount / 100)].join(" ").toLowerCase();
    return text.includes(needle);
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0) * request.sign;
  // A move lists money that left one month and joined another, and a transit pairs the two sides of a transfer: neither has a total.
  const showTotal = !mode;

  const move = (row: Row, month: Month) => {
    const dated = row.date.slice(0, 7);
    // Back to its own month: forget the plan's move, or, when its note carries a tag, say so explicitly so the tag no longer applies.
    onEdit((d) => setMove(d, row.id, month !== dated ? month : tagOf.get(row.id) && tagOf.get(row.id) !== dated ? dated : null));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1600px)]">
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-3">
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>Transactions in the plan&apos;s cash accounts, as recorded in Actual. Nothing here changes Actual. “Counted in” moves a transaction to a neighbouring month in this plan only; a <span className="font-mono">#YYYY-MM</span> tag in its Actual note does the same for every plan.</DialogDescription>
        </DialogHeader>
        <div className="shrink-0 border-b border-border px-5 py-2"><SearchInput value={find} onValueChange={setFind} placeholder="Search these transactions" aria-label="Search these transactions" className="h-8 w-full max-w-sm text-xs" /></div>
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isLoading ? <p className="p-5 text-sm text-muted-foreground" role="status">Reading transactions…</p>
            : query.isError ? <div className="space-y-2 p-5 text-sm"><p role="alert">The transactions could not be read.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>
            : rows.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{needle ? "No transaction matches the search." : "No transactions."}</p>
            : (
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] text-muted-foreground">
                  <tr>{[["Date", "w-[104px]"], ["Account", "w-[150px]"], ["Payee", "w-[190px]"], ["Category", "w-[200px]"], ["Notes", ""]].map(([h, w]) => <th key={h} scope="col" className={`h-8 border-b border-border px-3 font-medium ${w}`}>{h}</th>)}<th scope="col" className="h-8 border-b border-border px-3 text-right font-medium">Amount</th><th scope="col" className="h-8 w-40 border-b border-border px-3 font-medium">Counted in</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const other = row["payee.transfer_acct"];
                    const dated = row.date.slice(0, 7), counted = countedIn(row);
                    const shift = placed.shifted.get(row.id);
                    // The month before, its own, and the month after; a month that has not ended holds no actuals to join.
                    const choices = [...new Set([addMonths(dated, -1), dated, addMonths(dated, 1), counted])].filter((m) => m <= currentMonth || m === counted).sort();
                    return (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="h-8 border-b border-border/40 px-3 tabular-nums whitespace-nowrap">{shortDate(row.date)}</td>
                        <td className="max-w-[150px] truncate border-b border-border/40 px-3">{accountName.get(row.account) ?? "-"}</td>
                        <td className="max-w-[200px] truncate border-b border-border/40 px-3">{other ? `Transfer: ${accountName.get(other) ?? "another account"}` : row.payee ? query.data!.payees.get(row.payee) ?? "-" : "-"}</td>
                        <td className="max-w-[170px] truncate border-b border-border/40 px-3">{row.category ? categoryName.get(row.category) ?? "-" : "-"}</td>
                        <td className="max-w-0 truncate border-b border-border/40 px-3 text-muted-foreground" title={row.notes ?? undefined}>{row.notes ?? ""}</td>
                        <td className="border-b border-border/40 px-3 text-right tabular-nums whitespace-nowrap">{money(row.amount * request.sign)}</td>
                        <td className="border-b border-border/40 px-3">
                          <div className="flex items-center gap-1.5">
                            <div role="radiogroup" aria-label="Month this transaction counts in" title={shift?.byTag ? "Counted in the month its note's tag names" : undefined} className="flex gap-px rounded-md border border-border bg-muted/40 p-px">
                              {choices.map((m) => (
                                <button key={m} type="button" role="radio" aria-checked={m === counted} onClick={() => { if (m !== counted) move(row, m); }} className={cn("h-6 whitespace-nowrap rounded px-2 text-[11px]", m === counted ? "bg-background font-semibold text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground/70 hover:text-foreground")}>{monthLabel(m)}</button>
                              ))}
                            </div>
                            {counted !== dated && <span title={shift?.byTag ? "Moved by the tag in its note" : "Moved in this plan"} className="text-muted-foreground"><ArrowLeftRight className="size-3.5" aria-hidden /><span className="sr-only">{shift?.byTag ? "Moved by the tag in its note" : "Moved in this plan"}</span></span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
        {rows.length > 0 && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-2 text-xs">
            <span className="text-muted-foreground">{rows.length} {rows.length === 1 ? "transaction" : "transactions"}{(query.data?.rows.length ?? 0) >= LIMIT && ` (the first ${LIMIT}; the total may be incomplete)`}</span>
            {showTotal && <span className="font-semibold tabular-nums">Total {money(total)}</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
