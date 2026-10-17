"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MatchingGroup } from "@/lib/reconciliation/session/groups";
import type { ActualTransactionSnapshot, ReconciliationItem } from "@/lib/reconciliation/types";
import { dayDelta } from "@/lib/reconciliation/match/score";
import { datesSpanYears, formatMinorUnits, formatShortDate } from "../lib/format";
import { statementText } from "@/lib/reconciliation/statement/text";
import type { WorkbenchProps } from "./Workbench";
import { Inspector } from "./Inspector";
import { WorkbenchRow } from "./WorkbenchRow";
import { useTableHeaderHeight } from "../hooks/useTableHeaderHeight";

type Props = Pick<WorkbenchProps, "items" | "statementRows" | "transactions" | "payees" |
  "categories" | "onDisposition" | "onUseCandidate" | "onCorrectAmount" | "onStage" | "onUnstage"> & {
  group: MatchingGroup;
  onClose: () => void;
  onRestoreItems: (items: ReconciliationItem[]) => void;
  evidenceFor: (itemId: string, transactionId: string) => string[];
};

function TransactionHeading({ date, amount, description, showYear }: Pick<ActualTransactionSnapshot, "date" | "amount"> & {
  description: string;
  showYear: boolean;
}) {
  return <div>
    <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatMinorUnits(amount)}</div>
    <div className="mt-1 max-w-56 break-words font-medium">
      <span className="whitespace-nowrap font-normal text-muted-foreground">{formatShortDate(date, showYear)} · </span>
      {description}
    </div>
  </div>;
}

/** A view over existing candidate edges, never a second matching pipeline. */
export function GroupMatchingView({ group, items, statementRows, transactions, payees, categories,
  onClose, onRestoreItems, evidenceFor, onUseCandidate, onDisposition, onCorrectAmount, onStage, onUnstage }: Props) {
  const [selection, setSelection] = useState<{ itemId: string; transactionId: string } | null>(null);
  const [undo, setUndo] = useState<ReconciliationItem[] | null>(null);
  const { headerHeight, headerRef } = useTableHeaderHeight();
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const members = group.itemIds.map((id) => byId.get(id)).filter((item): item is ReconciliationItem => Boolean(item));
  const pending = members.filter((item) => item.disposition === "unresolved");
  const resolved = members.filter((item) => item.disposition === "matched" || item.disposition === "correct-amount");
  const claimed = new Set(items.filter((item) => item.disposition === "matched" || item.disposition === "correct-amount")
    .flatMap((item) => item.actualTransactionIds));
  const availableCandidates = new Set(pending.flatMap((item) => item.actualTransactionIds));
  const columns = group.transactionIds.filter((id) => !claimed.has(id) && availableCandidates.has(id)).map((id) => transactions.get(id))
    .filter((transaction): transaction is NonNullable<typeof transaction> => Boolean(transaction));
  const showYear = datesSpanYears(members.flatMap((item) => [
    statementRows.get(item.statementRowIds[0])?.postedDate,
    ...item.actualTransactionIds.map((id) => transactions.get(id)?.date),
  ]));
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

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">Resolve group</h3>
        <span className="text-xs text-muted-foreground">{pending.length} bank rows left</span>
      </div>
      <div className="flex items-center gap-2">
        {undo && <Button size="sm" variant="ghost" onClick={() => {
          onRestoreItems(undo); setUndo(null); setSelection(null);
        }}>Undo last pairing</Button>}
        <Button size="sm" variant={pending.length === 0 ? "default" : "outline"} onClick={onClose}>Back to all rows</Button>
      </div>
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto">
        {pending.length > 0 && <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Bank rows and their existing Actual candidates</caption>
          <thead ref={headerRef} className="sticky top-0 z-10 bg-muted">
            <tr><th scope="col" className="sticky left-0 z-20 min-w-56 border-b border-r border-border bg-muted p-3 text-left">Bank statement</th>
              {columns.map((actual) => <th key={actual.id} scope="col" className="min-w-40 border-b border-border bg-muted p-3 text-left font-normal">
                <TransactionHeading date={actual.date} amount={actual.amount} description={actual.payeeName ?? actual.importedPayee ?? "No payee"} showYear={showYear} />
                {actual.notes && <div className="mt-1 max-w-32 truncate text-[11px] text-muted-foreground" title={actual.notes}>{actual.notes}</div>}
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
                <TransactionHeading date={row.postedDate} amount={row.amount} description={statementText(row)} showYear={showYear} />
              </th>
              {columns.map((actual) => {
                // Integer minor units, Actual minus bank, matching the inspector.
                const difference = actual.amount - row.amount;
                const gap = dayDelta(row.postedDate, actual.date);
                const active = selection?.itemId === item.id && selection.transactionId === actual.id;
                return <td key={actual.id} className="p-2 text-center">
                  {candidates.has(actual.id) ? <Button variant={active ? "secondary" : "outline"} size="sm"
                    className={cn("h-auto w-full flex-col gap-0.5 py-2",
                      gap === 0 && "border-primary/25 bg-accent hover:bg-accent dark:border-primary/25 dark:bg-accent dark:hover:bg-accent",
                      active && "ring-1 ring-ring")}
                    aria-label={`Compare ${statementText(row)} with ${actual.payeeName ?? actual.importedPayee ?? "transaction"} ${formatMinorUnits(actual.amount)} on ${actual.date}`}
                    onClick={() => setSelection({ itemId: item.id, transactionId: actual.id })}>
                    <span className="tabular-nums">{difference === 0 ? "Same amount" : `${difference > 0 ? "+" : ""}${formatMinorUnits(difference)}`}</span>
                    <span className={cn("text-[11px]", gap === 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>{gap === 0 ? "Same day" : `${Math.abs(gap)} day${Math.abs(gap) === 1 ? "" : "s"} ${gap > 0 ? "later" : "earlier"}`}</span>
                  </Button> : <span className="text-muted-foreground">-</span>}
                </td>;
              })}
              <td className="p-2"><Button size="sm" variant="ghost" onClick={() => {
                setUndo(items); onUseCandidate(item.id, null); setSelection(null);
              }}>None of these</Button></td>
            </tr>;
          })}</tbody>
        </table>}
        {resolved.length > 0 && <section aria-label="Paired" className={cn(pending.length > 0 && "border-t border-border")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs">
            <h4 className="font-semibold">Paired</h4>
            {pending.length === 0 && <span role="status" className="text-muted-foreground">The bank rows in this group are decided.</span>}
          </div>
          <table className="w-full min-w-[56rem] border-collapse">
            <caption className="sr-only">Paired bank and Actual transactions</caption>
            <thead ref={pending.length === 0 ? headerRef : undefined} className="sticky top-0 z-10 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="w-8 bg-muted px-2 pt-2" />
                <th scope="colgroup" colSpan={3} className="bg-muted px-2 pt-2 text-left font-semibold text-foreground">From the bank statement</th>
                <th scope="col" className="border-x border-border bg-background px-2 pt-2 text-left font-semibold text-foreground">Match</th>
                <th scope="colgroup" colSpan={4} className="bg-background px-2 pt-2 text-left font-semibold text-foreground">In Actual</th>
              </tr>
              <tr>
                <th scope="col" className="w-8 border-b border-border bg-muted px-2 pb-2"><span className="sr-only">Decision status</span></th>
                <th scope="col" className="w-14 border-b border-border bg-muted px-2 pb-2 text-left font-medium">Date</th>
                <th scope="col" className="border-b border-border bg-muted px-2 pb-2 text-left font-medium">Description</th>
                <th scope="col" className="w-24 border-b border-border bg-muted px-2 pb-2 text-right font-medium">Amount</th>
                <th scope="col" className="w-40 border-x border-b border-border bg-background px-2 pb-2 text-left font-medium">Result</th>
                <th scope="col" className="w-14 border-b border-border bg-background px-2 pb-2 text-left font-medium">Date</th>
                <th scope="col" className="w-[18%] border-b border-border bg-background px-2 pb-2 text-left font-medium">Payee</th>
                <th scope="col" className="border-b border-border bg-background px-2 pb-2 text-left font-medium">Notes</th>
                <th scope="col" className="w-24 border-b border-border bg-background px-2 pb-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>{resolved.map((item) => {
              const row = statementRows.get(item.statementRowIds[0]);
              const actual = transactions.get(item.actualTransactionIds[0]);
              return actual && row ? <WorkbenchRow key={item.id} item={item} statementRow={row} transactions={[actual]}
                showYear={showYear} selected={selection?.itemId === item.id}
                onSelect={() => setSelection({ itemId: item.id, transactionId: actual.id })} /> : null;
            })}</tbody>
          </table>
        </section>}
      </div>
      {preview && transaction && <Inspector headerHeight={headerHeight} item={preview}
        statementRow={statementRows.get(preview.statementRowIds[0])} transactions={[transaction]} payees={payees} categories={categories}
        candidateSelection={isCandidate} evidenceFor={(id) => evidenceFor(preview.id, id)} onClose={() => setSelection(null)}
        onUseCandidate={(id) => { setUndo(items); onUseCandidate(preview.id, id); setSelection(null); }}
        onDisposition={(disposition) => { setUndo(null); onDisposition(preview.id, disposition); }}
        onCorrectAmount={(id, amount) => { setUndo(null); onCorrectAmount(preview.id, id, amount); }}
        onStage={(field, value) => { setUndo(null); onStage(preview.id, field, value); }}
        onUnstage={(field) => { setUndo(null); onUnstage(preview.id, field); }} />}
    </div>
  </div>;
}
