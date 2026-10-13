"use client";

import { formatCardDate } from "../lib/displayDates";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { Account } from "@/types/entities";
import type { ActivityRow } from "../lib/activity";
import type { Statement } from "../lib/models";
import { TransactionNotes } from "./TransactionNotes";
import { Status } from "./WorkspaceVisuals";

function Transaction({ title, row, accounts }: { title: string; row: ActivityRow; accounts: Account[] }) {
  return <section className="rounded-md border border-border p-3"><h3 className="mb-3 text-sm font-semibold">{title}</h3><dl className="grid grid-cols-2 gap-3 text-xs">
    <div><dt className="text-muted-foreground">Account</dt><dd>{accounts.find((account) => account.id === row.accountId)?.name ?? row.label}</dd></div>
    <div><dt className="text-muted-foreground">Date</dt><dd>{formatCardDate(row.date)}</dd></div>
    <div><dt className="text-muted-foreground">Payee / transfer</dt><dd>{row.label}</dd></div>
    <div><dt className="text-muted-foreground">Amount</dt><dd className="tabular-nums">{formatAmount(row.amountMinor, 2)}</dd></div>
    <div><dt className="text-muted-foreground">Cleared</dt><dd><Status tone={row.cleared === true ? "success" : row.cleared === false ? "attention" : "neutral"}>{row.cleared === null ? "Unknown" : row.cleared ? "Cleared" : "Uncleared"}</Status></dd></div>
    <div className="col-span-2"><dt className="mb-1 text-muted-foreground">Notes</dt><dd><TransactionNotes notes={row.notes} /></dd></div>
  </dl></section>;
}

/** Read-only source inspection; statement matching never requires purchase-by-purchase allocation. */
export function PaymentDetails({ payment, peer, accounts, statement, available, onClose, onViewStatement }: {
  payment: ActivityRow; peer?: ActivityRow; accounts: Account[]; statement?: Statement; available: boolean; onClose: () => void; onViewStatement: () => void;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
    <DialogHeader><DialogTitle>Payment details</DialogTitle><DialogDescription>{formatCardDate(payment.date)} · {formatAmount(payment.amountMinor, 2)} to your credit card</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-3 overflow-auto">
      <div className="rounded-md border border-border bg-background p-3 text-xs">{!available ? "Refresh Actual data to confirm this payment and its statement match." : statement ? <>Matched to statement <strong>{formatCardDate(statement.closingDate)}</strong> by payment date · Due {formatCardDate(statement.dueDate)}{!statement.bankConfirmed && " · Estimated statement"}</> : "No matching statement in the loaded history. View Statements or load a longer history window."}</div>
      <Transaction title="Credit-card transaction" row={payment} accounts={accounts} />
      {peer ? <Transaction title="Funding transaction" row={peer} accounts={accounts} /> : <p className="text-xs text-muted-foreground">Funding transaction details are unavailable. The incoming card transfer is sufficient to identify the payment.</p>}
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose}>Close details</Button><Button onClick={onViewStatement}>View statements</Button></div>
  </DialogContent></Dialog>;
}
