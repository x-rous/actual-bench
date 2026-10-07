"use client";

import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import type { PreviewRow } from "./renderPreviewRows";

/**
 * The rows Actual holds or will hold, register-faithful (RD-084 P1.6 T137;
 * FR-175–FR-179, SC-019). Used for Before and After in an expanded Activity
 * row. Every cell carries its label for screen readers; colour is never the
 * only signal.
 */

export const PREVIEW_HEADER = "This is what Actual Bench will write to Actual.";
const COLUMNS = ["Date", "Account", "Payee", "Category", "Notes", "Amount", "Status"] as const;

function statusText(row: PreviewRow): string {
  return [row.reconciled ? "Reconciled" : row.cleared === "cleared" ? "Cleared" : "Not cleared", row.linkedChip ? "Linked" : null].filter(Boolean).join(", ");
}

export function PreviewTable({ rows, label }: { rows: PreviewRow[]; label: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No existing rows; Bench creates new ones.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs" aria-label={label} aria-rowcount={rows.length + 1} aria-colcount={COLUMNS.length}>
        <thead>
          <tr className="border-b border-border text-[11px] text-muted-foreground" aria-rowindex={1}>
            {COLUMNS.map((column, index) => <th key={column} scope="col" aria-colindex={index + 1} className={cn("px-2 py-1 font-medium", column === "Amount" && "text-right")}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const category = row.categoryName ?? "-";
            const amount = formatAmount(row.amountMinor, row.currencyMinorDigits);
            return (
              <tr key={row.key} aria-rowindex={index + 2} className={cn("border-b border-border/60", row.splitParent && "font-medium", row.transferAccountName && "bg-muted/30")}>
                <td aria-colindex={1} aria-label={`Date: ${row.date}`} className="px-2 py-1 tabular-nums">{row.date}</td>
                <td aria-colindex={2} aria-label={`Account: ${row.accountName}${row.accountBudgetStatus === "off-budget" ? ", off-budget" : ""}`} className="px-2 py-1">
                  {row.accountName}{row.accountBudgetStatus === "off-budget" ? <span className="ml-1 rounded border border-border px-1 text-[10px] text-muted-foreground">Off-budget</span> : null}
                </td>
                <td aria-colindex={3} aria-label={`Payee: ${row.payeeName || "none"}`} className={cn("px-2 py-1", row.splitChildOf && "pl-6")}>
                  {row.transferAccountName ? <Link2 aria-hidden className="mr-1 inline size-3" /> : null}{row.payeeName}
                </td>
                <td aria-colindex={4} aria-label={`Category: ${row.categoryName ?? "none"}`} className="px-2 py-1">{category}</td>
                <td aria-colindex={5} aria-label={`Notes: ${row.notes ?? "none"}`} className="max-w-[16rem] truncate px-2 py-1" title={row.notes ?? undefined}>{row.notes}</td>
                <td aria-colindex={6} aria-label={`Amount: ${amount}`} className={cn("px-2 py-1 text-right tabular-nums", row.amountMinor < 0 && "text-destructive")}>{amount}</td>
                <td aria-colindex={7} aria-label={`Status: ${statusText(row)}`} className="px-2 py-1">
                  {statusText(row)}{row.linkedChip ? <span className="ml-1 rounded border border-border px-1 text-[10px]">Linked</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
