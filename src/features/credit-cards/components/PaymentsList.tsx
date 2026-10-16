"use client";
import { ChevronRight } from "lucide-react";
import type { Account } from "@/types/entities";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatCardDate } from "../lib/displayDates";
import { paymentEffects, type PaymentEffect } from "../lib/paymentEffects";
import type { Card, Statement, Workspace } from "../lib/models";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { PaymentDistribution, PaymentTiming } from "./PaymentTiming";
import { WorkspaceTable } from "./WorkspaceTable";
import type { Settlement } from "../lib/repayments";
import { ReviewText } from "./ReviewText";
import { ClearingStatus } from "./ClearingStatus";
import { FieldInfo } from "./FieldInfo";
export function PaymentsList({ card, payments, snapshot, accounts = [], available, onStatements, onDetails, today, workspace, statuses }: { card: Card; payments: { row: ActivityRow; matchedStatement?: Statement }[]; snapshot?: ActivitySnapshot; accounts?: Pick<Account, "id" | "name">[]; available: boolean; onStatements: (statementId?: string) => void; onDetails: (id: string) => void; today?: string; workspace?: Workspace; statuses?: Settlement[] }) {
  const fundingAccounts = new Map((snapshot?.counterparts ?? []).map((peer) => [peer.id, accounts.find((account) => account.id === peer.accountId)?.name]));
  const paidFrom = (row: ActivityRow) => row.transferId ? fundingAccounts.get(row.transferId) ?? row.label : row.label;
  const effects = available && workspace && snapshot && statuses && today ? paymentEffects(card, workspace, snapshot, statuses, today) : new Map<string, PaymentEffect>();
  const effect = (id: string) => effects.get(id) ?? { label: "Effect unavailable", detail: "Refresh complete payment and statement evidence to assess this transfer." };
  const confirmed = payments.filter((entry) => entry.row.cleared === true && (!card.firstTrackedStatementDate || entry.row.date > card.firstTrackedStatementDate));
  const pending = payments.filter((entry) => entry.row.cleared === false);
  const unknown = payments.filter((entry) => entry.row.cleared === null);
  const amount = (entries: typeof payments) => formatAmount(entries.reduce((sum, entry) => sum + entry.row.amountMinor, 0), 2);
  return <div className="flex min-h-0 flex-1 flex-col">
    <section className="grid shrink-0 gap-6 border-b bg-muted/15 px-5 py-5 lg:grid-cols-[18rem_1fr]" aria-label="When you pay">
      <div className="rounded-xl border bg-background p-4">
        <h2 className="text-sm font-semibold">When you pay</h2>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground" title="Cleared repayments since tracking began">Cleared paid</dt><dd className="text-right font-medium tabular-nums">{available ? amount(confirmed) : "-"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Pending</dt><dd className="text-right font-medium tabular-nums">{available ? <><span>{amount(pending)} · {pending.length} {pending.length === 1 ? "payment" : "payments"}</span>{unknown.length > 0 && <span className="mt-1 block text-muted-foreground">{amount(unknown)} · {unknown.length} unknown clearing</span>}</> : "-"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Payments</dt><dd className="text-right font-medium tabular-nums">{payments.length}</dd></div>
        </dl>
      </div>
      <div className="self-center">{available ? <PaymentDistribution payments={payments} onDetails={onDetails} /> : <p className="text-xs text-muted-foreground">Refresh Actual activity to inspect payment timing.</p>}</div>
    </section>
    <WorkspaceTable compact singleLine tableClassName="min-w-[1440px]" title="Card repayments" rows={payments} columns={[
    { label: "Payment Date", width: "140px", value: ({ row }) => row.date, searchValue: ({ row }) => formatCardDate(row.date) },
    { label: "Paid from", width: "160px", value: ({ row }) => paidFrom(row), searchValue: ({ row }) => row.label },
    { label: "Notes", value: ({ row }) => row.notes },
    { label: "Amount", width: "112px", align: "right", value: ({ row }) => row.amountMinor },
    { label: "Cleared", width: "80px", value: ({ row }) => row.cleared === true ? "Cleared" : row.cleared === false ? "Pending" : "Unknown" },
    { label: "For Statement", width: "148px", value: ({ matchedStatement }) => matchedStatement?.closingDate, searchValue: ({ matchedStatement }) => matchedStatement ? formatCardDate(matchedStatement.closingDate) : "No matching statement" },
    { label: "Payment Effect", width: "180px", value: ({ row }) => effect(row.id).label, searchValue: ({ row }) => effect(row.id).minimum ?? "" },
    { label: "Against the Due Date", width: "304px", value: ({ row, matchedStatement }) => matchedStatement ? daysBetween(matchedStatement.dueDate, row.date) : null },
  ]} filters={[
    { label: "Payment match", options: [{ value: "", label: `All (${payments.length})` }, { value: "matched", label: `Matched (${payments.filter((entry) => entry.matchedStatement).length})` }, { value: "unmatched", label: `Unmatched (${payments.filter((entry) => !entry.matchedStatement).length})` }], matches: ({ matchedStatement }, value) => value === "matched" ? Boolean(matchedStatement) : !matchedStatement },
    { label: "Payment clearing", options: [{ value: "", label: "Any clearing status" }, { value: "cleared", label: "Cleared" }, { value: "pending", label: "Pending" }, { value: "unknown", label: "Unknown" }], matches: ({ row }, value) => value === "cleared" ? row.cleared === true : value === "pending" ? row.cleared === false : row.cleared === null },
  ]} actions={<><FieldInfo label="Payment matching">Payments are matched to a statement by date. Several payments may contribute to one statement. Payment Effect describes each payment’s contribution in sequence; uncleared amounts remain pending. Cashback and other statement credits are not payments.</FieldInfo><Button size="sm" variant="outline" onClick={() => onStatements()}>View statements</Button></>} renderRow={({ row, matchedStatement }) => {
    const delay = matchedStatement ? daysBetween(matchedStatement.dueDate, row.date) : 0;
    const paymentEffect = effect(row.id);
    const noStatement = !available ? "Refresh needed" : card.firstTrackedStatementDate && row.date <= card.firstTrackedStatementDate ? "Before tracking began" : "No matching statement";
    return <tr key={row.id} className="border-b hover:bg-muted/20">
      <td><Button variant="link" size="xs" className="h-auto whitespace-nowrap p-0 text-xs" aria-label={`View payment details for ${formatCardDate(row.date)} ${row.label}`} onClick={() => onDetails(row.id)} disabled={!snapshot}>{formatCardDate(row.date)}<ChevronRight className="size-3" aria-hidden /></Button></td>
      <td><ReviewText className="text-xs" text={paidFrom(row)} detail={row.transferId && fundingAccounts.get(row.transferId) ? paidFrom(row) : `${row.label}. Card-side transfer label; linked funding account details are unavailable.`} label="payment funding account" /></td>
      <td className="text-muted-foreground"><ReviewText className="max-w-[28rem] text-xs" text={row.notes ?? "-"} label="payment notes" /></td>
      <td className="text-right font-medium text-emerald-800 dark:text-emerald-300 tabular-nums">{formatAmount(row.amountMinor, 2)}</td>
      <td><ClearingStatus cleared={row.cleared} available={available} /></td>
      <td>{matchedStatement ? <Button variant="link" size="xs" className="h-auto whitespace-nowrap p-0 text-xs" aria-label={`View statement ${formatCardDate(matchedStatement.closingDate)}`} onClick={() => onStatements(matchedStatement.id)}>{formatCardDate(matchedStatement.closingDate)}</Button> : <ReviewText text={noStatement} label="payment statement match" />}</td>
      <td><ReviewText text={paymentEffect.label} detail={paymentEffect.detail} label={`payment effect for ${formatCardDate(row.date)} ${row.label}`} /></td>
      <td>{matchedStatement ? <PaymentTiming dueDate={matchedStatement.dueDate} date={row.date} pending={!available || !matchedStatement.bankConfirmed || row.cleared !== true} label={!available ? "Refresh needed" : !matchedStatement.bankConfirmed ? "Estimated due date" : row.cleared !== true ? "Clearing pending" : delay > 0 ? `${delay} days late` : delay === 0 ? "On due date" : `${-delay} days early`} /> : <span className="text-muted-foreground">No tracked due date</span>}</td>
    </tr>;
  }} /></div>;
}
