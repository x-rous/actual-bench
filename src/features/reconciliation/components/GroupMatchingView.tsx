"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MatchingGroup } from "@/lib/reconciliation/session/groups";
import type { ReconciliationItem } from "@/lib/reconciliation/types";
import { dayDelta } from "@/lib/reconciliation/match/score";
import { formatMinorUnits, formatShortDate } from "../lib/format";
import { statementText } from "@/lib/reconciliation/statement/text";
import type { WorkbenchProps } from "./Workbench";
import { Inspector } from "./Inspector";

type Props = Pick<WorkbenchProps, "items" | "statementRows" | "transactions" | "payees" |
  "categories" | "onDisposition" | "onUseCandidate" | "onCorrectAmount" | "onStage" | "onUnstage"> & {
  group: MatchingGroup;
  onClose: () => void;
  onRestoreItems: (items: ReconciliationItem[]) => void;
  evidenceFor: (itemId: string, transactionId: string) => string[];
};

/** A view over existing candidate edges, never a second matching pipeline. */
export function GroupMatchingView({ group, items, statementRows, transactions, payees, categories,
  onClose, onRestoreItems, evidenceFor, onUseCandidate, onDisposition, onCorrectAmount, onStage, onUnstage }: Props) {
  const [selection, setSelection] = useState<{ itemId: string; transactionId: string } | null>(null);
  const [undo, setUndo] = useState<ReconciliationItem[] | null>(null);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const members = group.itemIds.map((id) => byId.get(id)).filter((item): item is ReconciliationItem => Boolean(item));
  const pending = members.filter((item) => item.disposition === "unresolved");
  const resolved = members.filter((item) => item.disposition === "matched" || item.disposition === "correct-amount");
  const claimed = new Set(items.filter((item) => item.disposition === "matched" || item.disposition === "correct-amount")
    .flatMap((item) => item.actualTransactionIds));
  const columns = group.transactionIds.filter((id) => !claimed.has(id)).map((id) => transactions.get(id))
    .filter((transaction): transaction is NonNullable<typeof transaction> => Boolean(transaction));
  const selected = selection ? byId.get(selection.itemId) : undefined;
  const transaction = selection ? transactions.get(selection.transactionId) : undefined;
  const isCandidate = selected?.disposition === "unresolved";
  const selectable = selected && transaction && (isCandidate
    ? selected.actualTransactionIds.includes(transaction.id) && !claimed.has(transaction.id)
    : selected.actualTransactionIds.includes(transaction.id));
  const preview = selectable ? { ...selected, actualTransactionIds: [transaction.id], guards: {
    protectedReconciled: transaction.reconciled,
    splitParent: transaction.isParent,
    transfer: transaction.transferId ? "yes" as const : (selected.guards.transfer === "unknown" ? "unknown" as const : "no" as const),
  } } : null;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      <Button size="sm" variant="outline" onClick={onClose}>Back to all rows</Button>
      <h3 className="text-sm font-semibold">Resolve group</h3>
      <span className="text-xs text-muted-foreground">{pending.length} bank rows left</span>
      {undo && <Button size="sm" variant="ghost" onClick={() => {
        onRestoreItems(undo); setUndo(null); setSelection(null);
      }}>Undo last pairing</Button>}
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto">
        {pending.length > 0 ? <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Bank rows and their existing Actual candidates</caption>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr><th scope="col" className="sticky left-0 z-20 min-w-56 border-b border-r border-border bg-muted p-3 text-left">Bank statement</th>
              {columns.map((actual) => <th key={actual.id} scope="col" className="min-w-40 border-b border-border bg-muted p-3 text-left font-normal">
                <div>{formatShortDate(actual.date)} · {formatMinorUnits(actual.amount)}</div>
                <div className="mt-1 max-w-56 break-words font-medium">{actual.payeeName ?? actual.importedPayee ?? "No payee"}</div>
              </th>)}
              <th scope="col" className="border-b border-border p-3">Other</th>
            </tr>
          </thead>
          <tbody>{pending.map((item) => {
            const row = statementRows.get(item.statementRowIds[0]);
            if (!row) return null;
            const candidates = new Set(item.actualTransactionIds);
            return <tr key={item.id} className="border-b border-border/40">
              <th scope="row" className="sticky left-0 border-r border-border bg-background p-3 text-left font-normal">
                <div className="tabular-nums">{formatShortDate(row.postedDate)} · {formatMinorUnits(row.amount)}</div>
                <div className="mt-1 max-w-72 break-words font-medium">{statementText(row)}</div>
              </th>
              {columns.map((actual) => {
                // Integer minor units, Actual minus bank, matching the inspector.
                const difference = actual.amount - row.amount;
                const gap = dayDelta(row.postedDate, actual.date);
                const active = selection?.itemId === item.id && selection.transactionId === actual.id;
                return <td key={actual.id} className="p-2 text-center">
                  {candidates.has(actual.id) ? <Button variant={active ? "secondary" : "outline"} size="sm"
                    className={cn("h-auto w-full flex-col gap-0.5 py-2", active && "ring-1 ring-ring")}
                    aria-label={`Compare ${statementText(row)} with ${actual.payeeName ?? actual.importedPayee ?? "transaction"} ${formatMinorUnits(actual.amount)} on ${actual.date}`}
                    onClick={() => setSelection({ itemId: item.id, transactionId: actual.id })}>
                    <span className="tabular-nums">{difference === 0 ? "Same amount" : `${difference > 0 ? "+" : ""}${formatMinorUnits(difference)}`}</span>
                    <span className="text-[11px] text-muted-foreground">{gap === 0 ? "Same day" : `${Math.abs(gap)} day${Math.abs(gap) === 1 ? "" : "s"} ${gap > 0 ? "later" : "earlier"}`}</span>
                  </Button> : <span className="text-muted-foreground">-</span>}
                </td>;
              })}
              <td className="p-2"><Button size="sm" variant="ghost" onClick={() => {
                setUndo(items); onUseCandidate(item.id, null); setSelection(null);
              }}>None of these</Button></td>
            </tr>;
          })}</tbody>
        </table> : <p role="status" className="p-4 text-sm">The bank rows in this group are decided.</p>}
        {resolved.length > 0 && <section className="space-y-1 border-t border-border p-4">
          <h4 className="mb-2 text-xs font-semibold">Paired</h4>
          {resolved.map((item) => {
            const row = statementRows.get(item.statementRowIds[0]);
            const actual = transactions.get(item.actualTransactionIds[0]);
            return actual && row ? <Button key={item.id} size="sm" variant="ghost" className="flex h-auto whitespace-normal text-left"
              onClick={() => setSelection({ itemId: item.id, transactionId: actual.id })}>
              {statementText(row)} · {formatMinorUnits(row.amount)} → {actual.payeeName ?? actual.importedPayee ?? "transaction"}
            </Button> : null;
          })}
        </section>}
      </div>
      {preview && transaction && <Inspector item={preview}
        statementRow={statementRows.get(preview.statementRowIds[0])} transactions={[transaction]} payees={payees} categories={categories}
        candidateSelection={isCandidate} evidenceFor={(id) => evidenceFor(preview.id, id)} onClose={() => setSelection(null)}
        onUseCandidate={(id) => { setUndo(items); onUseCandidate(preview.id, id); }}
        onDisposition={(disposition) => { setUndo(null); onDisposition(preview.id, disposition); }}
        onCorrectAmount={(id, amount) => { setUndo(null); onCorrectAmount(preview.id, id, amount); }}
        onStage={(field, value) => { setUndo(null); onStage(preview.id, field, value); }}
        onUnstage={(field) => { setUndo(null); onUnstage(preview.id, field); }} />}
    </div>
  </div>;
}
