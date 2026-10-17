"use client";
import { Eye } from "lucide-react";
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
import { sumMinor } from "../lib/statements";
export function PaymentsList({ card, payments, snapshot, accounts = [], available, onStatements, onDetails, today, workspace, statuses }: { card: Card; payments: { row: ActivityRow; matchedStatement?: Statement }[]; snapshot?: ActivitySnapshot; accounts?: Pick<Account, "id" | "name">[]; available: boolean; onStatements: (statementId?: string) => void; onDetails: (id: string) => void; today?: string; workspace?: Workspace; statuses?: Settlement[] }) {
  const fundingAccounts = new Map((snapshot?.counterparts ?? []).map((peer) => [peer.id, accounts.find((account) => account.id === peer.accountId)?.name]));
  const paidFrom = (row: ActivityRow) => row.transferId ? fundingAccounts.get(row.transferId) ?? row.label : row.label;
  const effects = available && workspace && snapshot && statuses && today ? paymentEffects(card, workspace, snapshot, statuses, today) : new Map<string, PaymentEffect>();
  const effect = (id: string) => effects.get(id) ?? { label: "Effect unavailable", detail: "Refresh complete payment and statement evidence to assess this transfer." };
  const confirmed = payments.filter((entry) => entry.row.cleared === true && (!today || entry.row.date <= today) && (!card.firstTrackedStatementDate || entry.row.date > card.firstTrackedStatementDate));
  const completed = (workspace?.statements ?? []).filter((statement) => statement.cardId === card.id && statement.bankConfirmed && statement.officialBalanceMinor > 0 && (!today || statement.closingDate <= today)).flatMap((statement) => {
    const status = statuses?.find((entry) => entry.statementId === statement.id);
    if (!status || status.fullRemainingMinor === null || status.confirmedPaidMinor < statement.officialBalanceMinor || status.confirmedPaidMinor < statement.minimumDueMinor) return [];
    const completedDate = [status.confirmedPaidDate, statement.minimumDueMinor > 0 ? status.confirmedMinimumPaidDate : null].filter((date): date is string => date !== null).sort().at(-1);
    return completedDate ? [{ late: completedDate > statement.dueDate }] : [];
  });
  const countsAvailable = available && (Boolean(workspace && statuses) || payments.length === 0);
  return <div className="flex min-h-0 flex-1 flex-col">
    <section className="grid shrink-0 items-center gap-6 border-b bg-muted/15 px-5 py-4 lg:grid-cols-[16rem_minmax(0,1fr)]" aria-label="When you pay">
      <div className="rounded-lg border bg-background px-3 py-2.5">
        <h2 className="text-xs font-semibold">When you pay</h2>
        <dl className="mt-2 space-y-2 text-xs" aria-label="Repayment summary">
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground" title="Cleared repayments since tracking began">Repaid</dt><dd className="font-semibold tabular-nums">{available ? formatAmount(sumMinor(confirmed.map((entry) => entry.row.amountMinor)), 2) : "-"}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground" title="Confirmed statements settled in full, including late completions">Paid in full</dt><dd className="font-semibold tabular-nums">{countsAvailable ? completed.length : "-"}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground" title="Of those settled in full, statements completed after the due date">Paid late</dt><dd className="font-semibold tabular-nums">{countsAvailable ? completed.filter((entry) => entry.late).length : "-"}</dd></div>
        </dl>
      </div>
      <div className="min-w-0">{available ? <PaymentDistribution payments={payments} onDetails={onDetails} /> : <p className="text-xs text-muted-foreground">Refresh Actual activity to inspect payment timing.</p>}</div>
    </section>
    <WorkspaceTable compact singleLine tableClassName="min-w-[1440px]" title="Card repayments" rows={payments} columns={[
    { label: "Payment Date", width: "120px", value: ({ row }) => row.date, searchValue: ({ row }) => formatCardDate(row.date) },
    { label: "Paid from", width: "224px", value: ({ row }) => paidFrom(row), searchValue: ({ row }) => row.label },
    { label: "Notes", width: "220px", value: ({ row }) => row.notes },
    { label: "Amount", width: "112px", align: "right", value: ({ row }) => row.amountMinor },
    { label: "Cleared", width: "64px", value: ({ row }) => row.cleared === true ? "Cleared" : row.cleared === false ? "Pending" : "Unknown" },
    { label: "For Statement", width: "148px", value: ({ matchedStatement }) => matchedStatement?.closingDate, searchValue: ({ matchedStatement }) => matchedStatement ? formatCardDate(matchedStatement.closingDate) : "No matching statement" },
    { label: "Payment Effect", width: "180px", value: ({ row }) => effect(row.id).label, searchValue: ({ row }) => effect(row.id).minimum ?? "" },
    { label: "Against the Due Date", width: "304px", value: ({ row, matchedStatement }) => matchedStatement ? daysBetween(matchedStatement.dueDate, row.date) : null },
    { label: "Details", width: "56px" },
  ]} filters={[
    { label: "Payment match", options: [{ value: "", label: `All (${payments.length})` }, { value: "matched", label: `Matched (${payments.filter((entry) => entry.matchedStatement).length})` }, { value: "unmatched", label: `Unmatched (${payments.filter((entry) => !entry.matchedStatement).length})` }], matches: ({ matchedStatement }, value) => value === "matched" ? Boolean(matchedStatement) : !matchedStatement },
    { label: "Payment clearing", options: [{ value: "", label: "Any clearing status" }, { value: "cleared", label: "Cleared" }, { value: "pending", label: "Pending" }, { value: "unknown", label: "Unknown" }], matches: ({ row }, value) => value === "cleared" ? row.cleared === true : value === "pending" ? row.cleared === false : row.cleared === null },
  ]} actions={<><FieldInfo label="Payment matching">Payments are matched to a statement by date. Several payments may contribute to one statement. Payment Effect describes the confirmed contribution through each date; uncleared amounts remain pending. Cashback and other statement credits are not payments. Repaid is the cleared amount since tracking began. Paid in full counts statements fully covered by confirmed payments, including the minimum. Paid late is the subset completed after its due date; split payments never inflate these counts.</FieldInfo><Button size="sm" variant="outline" onClick={() => onStatements()}>View statements</Button></>} renderRow={({ row, matchedStatement }) => {
    const delay = matchedStatement ? daysBetween(matchedStatement.dueDate, row.date) : 0;
    const paymentEffect = effect(row.id);
    const noStatement = !available ? "Refresh needed" : card.firstTrackedStatementDate && row.date <= card.firstTrackedStatementDate ? "Before tracking began" : "No matching statement";
    return <tr key={row.id} className="border-b hover:bg-muted/20">
      <td className="whitespace-nowrap">{formatCardDate(row.date)}</td>
      <td><ReviewText className="text-xs" text={paidFrom(row)} detail={row.transferId && fundingAccounts.get(row.transferId) ? paidFrom(row) : `${row.label}. Card-side transfer label; linked funding account details are unavailable.`} label="payment funding account" /></td>
      <td className="text-muted-foreground"><ReviewText className="max-w-[220px] text-xs text-muted-foreground" text={row.notes ?? "-"} label="payment notes" /></td>
      <td className="text-right font-medium text-emerald-800 dark:text-emerald-300 tabular-nums">{formatAmount(row.amountMinor, 2)}</td>
      <td><ClearingStatus cleared={row.cleared} available={available} /></td>
      <td>{matchedStatement ? <Button variant="link" size="xs" className="h-auto whitespace-nowrap p-0 text-xs" aria-label={`View statement ${formatCardDate(matchedStatement.closingDate)}`} onClick={() => onStatements(matchedStatement.id)}>{formatCardDate(matchedStatement.closingDate)}</Button> : <ReviewText text={noStatement} label="payment statement match" />}</td>
      <td><ReviewText text={paymentEffect.label} detail={paymentEffect.detail} label={`payment effect for ${formatCardDate(row.date)} ${row.label}`} /></td>
      <td>{matchedStatement ? <PaymentTiming dueDate={matchedStatement.dueDate} date={row.date} pending={!available || !matchedStatement.bankConfirmed || row.cleared !== true} label={!available ? "Refresh needed" : !matchedStatement.bankConfirmed ? "Estimated due date" : row.cleared !== true ? "Clearing pending" : delay > 0 ? `${delay} days late` : delay === 0 ? "On due date" : `${-delay} days early`} /> : <span className="text-muted-foreground">No tracked due date</span>}</td>
      <td className="text-center"><Button variant="ghost" size="icon-xs" aria-label={`View payment details for ${formatCardDate(row.date)} ${row.label}`} title="View payment details" onClick={() => onDetails(row.id)} disabled={!snapshot}><Eye className="size-3.5" aria-hidden /></Button></td>
    </tr>;
  }} /></div>;
}
