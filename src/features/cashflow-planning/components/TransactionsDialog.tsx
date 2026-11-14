"use client";

import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getTransport } from "@/lib/actual";
import { runQuery } from "@/lib/api/query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import type { Placed, Snapshot } from "@/lib/cashflow-planning/actuals";
import { monthEnd } from "@/lib/cashflow-planning/months";
import type { PlanDocument } from "@/lib/cashflow-planning/types";
import { money } from "@/features/financial-insights/format";
import type { TransactionsRequest } from "./Inspector";

type Row = { id: string; date: string; amount: number; account: string; category: string | null; notes: string | null; payee: string | null; "payee.transfer_acct": string | null };

const LIMIT = 2000;

/**
 * The transactions behind a figure, read from Actual when asked for and never kept. Read-only: to change one, open Actual.
 * The list follows the same placement as the grid: a transfer that another row follows through its account is left out of a
 * category's list, so the rows shown add up to the figure.
 */
export function TransactionsDialog({ request, doc, snapshot, placed, onClose }: { request: TransactionsRequest; doc: PlanDocument; snapshot: Snapshot; placed: Placed; onClose: () => void }) {
  const connection = useConnectionStore(selectActiveInstance);
  const months = [...request.months].sort();
  const from = `${months[0]}-01`;
  const lastDay = monthEnd(months[months.length - 1]);
  const to = lastDay < snapshot.today ? lastDay : snapshot.today;
  const categories = request.items.filter((i) => i.kind === "category").map((i) => i.id);
  const transfers = request.items.filter((i) => i.kind === "transfer").map((i) => i.id);
  const uncategorized = request.items.filter((i) => i.kind === "uncategorized").map((i) => i.id);

  const query = useQuery({
    queryKey: ["cashflow-planning", "transactions", connection?.id, from, to, categories, transfers, uncategorized, [...placed.cashIds]],
    enabled: !!connection,
    gcTime: 0,
    queryFn: async () => {
      const any: object[] = [];
      if (categories.length) any.push({ category: { $oneof: categories } });
      if (transfers.length) any.push({ "payee.transfer_acct": { $oneof: transfers } });
      if (uncategorized.length) any.push({ $and: [{ account: { $oneof: uncategorized } }, { category: null }, { "payee.transfer_acct": null }] });
      if (any.length === 0) return { rows: [] as Row[], payees: new Map<string, string>() };
      const response = await runQuery<{ data: Row[] }>(connection!, {
        ActualQLquery: {
          table: "transactions",
          filter: { $and: [{ date: { $gte: from } }, { date: { $lte: to } }, { account: { $oneof: [...placed.cashIds] } }, { $or: any }] },
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
  // Accounts some row follows: their transfers belong to that row, whatever category they carry.
  const followed = new Set(doc.rows.flatMap((r) => r.links.accounts.map((a) => a.id)));
  const wantedTransfers = new Set(transfers), wantedMonths = new Set(months);
  const rows = (query.data?.rows ?? []).filter((row) => {
    if (!wantedMonths.has(row.date.slice(0, 7))) return false;
    const other = row["payee.transfer_acct"];
    if (!other) return true;
    if (placed.cashIds.has(other)) return false;
    return wantedTransfers.has(other) || !followed.has(other);
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0) * request.sign;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[80vh] max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-3">
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>Transactions in the plan&apos;s cash accounts, as recorded in Actual. Read-only.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isLoading ? <p className="p-5 text-sm text-muted-foreground" role="status">Reading transactions…</p>
            : query.isError ? <div className="space-y-2 p-5 text-sm"><p role="alert">The transactions could not be read.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>
            : rows.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No transactions.</p>
            : (
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] text-muted-foreground">
                  <tr>{["Date", "Account", "Payee", "Category", "Notes"].map((h) => <th key={h} scope="col" className="h-8 border-b border-border px-3 font-medium">{h}</th>)}<th scope="col" className="h-8 border-b border-border px-3 text-right font-medium">Amount</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const other = row["payee.transfer_acct"];
                    return (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="h-7 border-b border-border/40 px-3 tabular-nums whitespace-nowrap">{row.date}</td>
                        <td className="max-w-[180px] truncate border-b border-border/40 px-3">{accountName.get(row.account) ?? "-"}</td>
                        <td className="max-w-[220px] truncate border-b border-border/40 px-3">{other ? `Transfer: ${accountName.get(other) ?? "another account"}` : row.payee ? query.data!.payees.get(row.payee) ?? "-" : "-"}</td>
                        <td className="max-w-[180px] truncate border-b border-border/40 px-3">{row.category ? categoryName.get(row.category) ?? "-" : "-"}</td>
                        <td className="max-w-[260px] truncate border-b border-border/40 px-3 text-muted-foreground" title={row.notes ?? undefined}>{row.notes ?? ""}</td>
                        <td className="border-b border-border/40 px-3 text-right tabular-nums whitespace-nowrap">{money(row.amount * request.sign)}</td>
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
            <span className="font-semibold tabular-nums">Total {money(total)}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
