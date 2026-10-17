"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAmount, minorToMajorText } from "@/features/assets-debt/lib/money";
import { activityKind, type ActivitySnapshot } from "../lib/activity";
import { formatCardDate } from "../lib/displayDates";
import type { Card, Statement, Workspace } from "../lib/models";
import { isStartingPoint, statementOutcome } from "../lib/paymentSummary";
import { settlements, type Settlement } from "../lib/repayments";
import { ClearingStatus } from "./ClearingStatus";
import { DashboardPanel } from "./DashboardPanels";
import { PaymentTiming } from "./PaymentTiming";
import { ReviewText } from "./ReviewText";
import { StatementOutcome } from "./StatementOutcome";

const money = (minor: number | null | undefined) => minor == null ? "-" : formatAmount(minor, 2);

export function OverviewDetails({ card, workspace, snapshot, statements = workspace.statements, statuses, today, available, onSettings, onStatements, onPayments, onPayment }: {
  card: Card; workspace: Workspace; snapshot?: ActivitySnapshot; statements?: Statement[]; statuses?: Settlement[];
  today: string; available: boolean; onSettings: () => void; onStatements?: (id?: string) => void;
  onPayments?: () => void; onPayment?: (id: string) => void;
}) {
  const recentStatements = statements.filter((entry) => entry.cardId === card.id && entry.closingDate <= today)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate)).slice(0, 5);
  const outcomes = available ? statuses ?? (snapshot ? settlements(card, { ...workspace, statements }, snapshot, today) : []) : [];
  const recentPayments = available && snapshot ? snapshot.rows.filter((row) => row.accountId === card.accountId && row.date <= today && row.amountMinor > 0 && row.transferId && activityKind(row, card, workspace, snapshot) === "payment")
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, 5) : [];
  const peers = new Map(snapshot?.counterparts.map((row) => [row.id, row]));
  const accountNames = new Map(snapshot?.accounts?.map((account) => [account.id, account.name]));

  return <div className="grid items-stretch gap-3 xl:grid-cols-4">
    <DashboardPanel label="Recent statements" className="flex flex-col overflow-hidden xl:col-span-2">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2"><h2 className="text-sm font-semibold">Recent statements</h2><Button variant="ghost" size="xs" aria-label="View all statements" onClick={() => onStatements?.()}>View all</Button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] table-fixed text-left text-xs">
        <caption className="sr-only">Recent statements</caption>
        <colgroup><col className="w-26" /><col className="w-32" /><col /></colgroup>
        <thead className="border-b bg-muted/10 whitespace-nowrap text-muted-foreground"><tr><th scope="col" className="px-3 py-1.5 font-medium">Statement</th><th scope="col" className="px-3 py-1.5 text-right font-medium">Statement balance</th><th scope="col" className="px-3 py-1.5 font-medium">Payment</th></tr></thead>
        <tbody>{recentStatements.map((entry) => {
          const status = outcomes.find((outcome) => outcome.statementId === entry.id);
          const state = statementOutcome(entry, status, today, available, isStartingPoint(entry, workspace, snapshot, available));
          return <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
            <td className="px-3 py-1"><Button variant="link" size="xs" className="h-auto whitespace-nowrap p-0 text-xs" onClick={() => onStatements?.(entry.id)}>{formatCardDate(entry.closingDate)}</Button></td>
            <td className="px-3 py-1 text-right font-medium tabular-nums">{money(entry.officialBalanceMinor)}</td>
            <td className="px-3 py-1"><div className="flex items-center justify-between gap-3"><div className="min-w-0 flex-1"><PaymentTiming closingDate={entry.closingDate} dueDate={entry.dueDate} date={state.date} label={state.timing} state={state.marker} /></div><div className="max-w-40 shrink-0"><StatementOutcome outcome={state} compact label={`payment outcome for ${formatCardDate(entry.closingDate)}`} /></div></div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!recentStatements.length && <p className="p-4 text-xs text-muted-foreground">No statements yet.</p>}
    </DashboardPanel>

    <DashboardPanel label="Recent payments" className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2"><h2 className="text-sm font-semibold">Recent payments</h2><Button variant="ghost" size="xs" aria-label="View all payments" onClick={onPayments}>View all</Button></div>
      <ul className="divide-y">{recentPayments.map((row) => {
        const peer = row.transferId ? peers.get(row.transferId) : undefined;
        const funding = (peer && accountNames.get(peer.accountId)) || row.label;
        return <li key={row.id} className="flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-muted/20">
          <div className="min-w-0 flex-1"><p>{formatCardDate(row.date)}</p><ReviewText text={funding} label={`payment funding account for ${formatCardDate(row.date)}`} className="mt-0.5 text-muted-foreground" /></div>
          <span className={`shrink-0 font-medium tabular-nums ${row.cleared === true ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>{money(row.amountMinor)}</span>
          <ClearingStatus cleared={row.cleared} />
          <Button variant="ghost" size="icon-xs" aria-label={`View payment details for ${formatCardDate(row.date)} ${row.label}`} title="View payment details" onClick={() => onPayment?.(row.id)}><Eye className="size-3.5" aria-hidden /></Button>
        </li>;
      })}</ul>
      {!recentPayments.length && <p className="p-4 text-xs text-muted-foreground">{available ? "No payments yet." : "Refresh Actual activity to view recent payments."}</p>}
    </DashboardPanel>

    <DashboardPanel label="Card terms" className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2"><h2 className="text-sm font-semibold">Card terms</h2><Button size="xs" variant="ghost" onClick={onSettings}>Edit settings</Button></div>
      <dl className="flex flex-1 flex-col justify-evenly px-4 py-2 text-xs">{[
        ["Credit limit", money(card.creditLimitMinor)],
        ["Purchase APR", card.purchaseAprBps == null ? "Not set" : `${minorToMajorText(card.purchaseAprBps, 2)}%`],
        ["Billing cycle", card.closingDay == null ? "Not set" : `Closes day ${card.closingDay}`],
        ["Payment rule", card.dueRule?.kind === "days-after-close" ? `${card.dueRule.days} days after close` : card.dueRule ? `Day ${card.dueRule.day} of month` : "Not set"],
        ["Minimum estimate", card.minimumPercentBps == null ? "Not set" : `${minorToMajorText(card.minimumPercentBps, 2)}% / floor ${money(card.minimumFloorMinor)}`],
        ["Auto-pay", card.autoPay[0].toUpperCase() + card.autoPay.slice(1)],
      ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-b py-1.5 last:border-0"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium tabular-nums">{value}</dd></div>)}</dl>
    </DashboardPanel>
  </div>;
}
