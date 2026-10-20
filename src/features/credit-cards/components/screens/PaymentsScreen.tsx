"use client";
import { useRef } from "react";
import type { Account } from "@/types/entities";
import { Button } from "@/components/ui/button";
import { ClearedHeader, ClearedStatus } from "@/components/ui/cleared-status";
import { PillGroup } from "@/components/ui/pill-group";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import type { ActivityRow } from "../../lib/activity";
import type { Statement } from "../../lib/models";
import { formatCardDate } from "../../lib/displayDates";
import { sumMinor } from "../../lib/statements";
import type { Tone } from "../../lib/derive/status";
import type { CardEntry } from "../cardEntry";
import { HEADER_ROW_HEIGHT, DataTable, Text, type Column, type TableController } from "../primitives/DataTable";
import { PanelRow, PanelSection, SidePanel } from "../primitives/SidePanel";
import { StatusBadge } from "../primitives/StatusBadge";
import { MISSING, money, plural, shortDate } from "../primitives/format";

type Payment = { row: ActivityRow; date: string; statement: Statement | undefined };
type PaymentFilter = "all" | "pending" | "late" | "reversed" | "unmatched";

type Props = {
  entry: CardEntry;
  accounts: Pick<Account, "id" | "name">[];
  filter: string | null;
  onFilter: (filter: string | null) => void;
  panelId: string | null;
  onPanel: (id: string | null) => void;
  onStatement: (id: string) => void;
};

const clearing = (row: ActivityRow) => (row.cleared === true ? "Cleared" : row.cleared === false ? "Pending" : MISSING);

/** The timing badge: early / on due date / late / pending / reversed / no bill. */
export function paymentTiming({ row, date, statement }: Payment, since: string | null): { label: string; tone: Tone; late: boolean } {
  if (row.amountMinor < 0) return { label: "Reversed", tone: "attention", late: false };
  if (!statement) return { label: since && date <= since ? "Before tracking" : "No bill", tone: "muted", late: false };
  if (row.cleared !== true) return { label: "Pending", tone: "info", late: false };
  const delay = daysBetween(statement.dueDate, date);
  if (delay > 0) return { label: `${plural(delay, "day")} late`, tone: "attention", late: true };
  if (delay === 0) return { label: "On due date", tone: "success", late: false };
  return { label: `${plural(-delay, "day")} early`, tone: "success", late: false };
}

/** Payments (§9.8): every payment into the card and which bill it paid (Rule P). */
export function PaymentsScreen({ entry, accounts, filter, onFilter, panelId, onPanel, onStatement }: Props) {
  const { card, view, snapshot, today, name } = entry;
  const table = useRef<TableController | null>(null);
  const since = card.firstTrackedStatementDate;
  const payments = [...view.paymentList].sort((a, b) => b.date.localeCompare(a.date) || a.row.id.localeCompare(b.row.id));
  const peers = new Map((snapshot?.counterparts ?? []).map((peer) => [peer.id, peer]));
  const accountName = (id: string | undefined) => accounts.find((account) => account.id === id)?.name;
  const from = (row: ActivityRow) => (row.transferId ? accountName(peers.get(row.transferId)?.accountId) : undefined) ?? row.label;
  const matches = (payment: Payment, key: PaymentFilter) => {
    const timing = paymentTiming(payment, since);
    return key === "pending" ? payment.row.cleared !== true && payment.row.amountMinor > 0
      : key === "late" ? timing.late
        : key === "reversed" ? payment.row.amountMinor < 0
          : key === "unmatched" ? !payment.statement : true;
  };
  const current = (filter ?? "all") as PaymentFilter;
  const visible = payments.filter((payment) => matches(payment, current));
  const saved = view.rows.filter((row) => !row.statement.estimate && !row.startingPoint && row.status.known && row.statement.closingDate <= today);
  const paidInFull = saved.filter((row) => row.status.key === "paid" || row.status.key === "paid-late" || row.status.key === "covered-with-credits" || row.status.key === "settled-with-plan");
  const cleared = payments.filter(({ row, date }) => row.cleared === true && date <= today && (!since || date > since));
  const columns: Column<Payment>[] = [
    { key: "date", header: "Date", width: 96, description: "The payment's effective date: the bank posting date when you saved one.",
      cell: (payment) => <Text title={payment.date !== payment.row.date ? `Actual date ${formatCardDate(payment.row.date)}` : undefined}>
        {shortDate(payment.date, today)}{payment.date !== payment.row.date ? " *" : ""}
      </Text> },
    { key: "from", header: "From", width: 180, cell: (payment) => <Text>{from(payment.row)}</Text> },
    { key: "notes", header: "Notes", width: 320, grow: true, cell: (payment) => <Text className="text-muted-foreground">{payment.row.notes || MISSING}</Text> },
    { key: "amount", header: "Amount", width: 120, align: "right", cell: (payment) => money(payment.row.amountMinor) },
    { key: "cleared", header: "Cleared", headerIcon: <ClearedHeader />, width: 44, align: "center", cell: (payment) => <ClearedStatus cleared={payment.row.cleared} /> },
    {
      key: "pays", header: "Pays statement", width: 120, description: "The bill this payment pays: the one whose payment window contains it.",
      cell: (payment) => (payment.statement ? shortDate(payment.statement.closingDate, today) : MISSING),
    },
    { key: "due", header: "Bill due", width: 96, cell: (payment) => (payment.statement ? shortDate(payment.statement.dueDate, today) : MISSING) },
    { key: "timing", header: "Timing", width: 150, cell: (payment) => {
      const timing = paymentTiming(payment, since);
      return <StatusBadge label={timing.label} tone={timing.tone} />;
    } },
  ];
  const selected = payments.find((payment) => payment.row.id === panelId);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
      <PillGroup<PaymentFilter>
        value={current}
        onChange={(value) => onFilter(value === "all" ? null : value)}
        options={[
          { value: "all", label: "All", count: payments.length },
          { value: "pending", label: "Pending", count: payments.filter((payment) => matches(payment, "pending")).length },
          { value: "late", label: "Late", count: payments.filter((payment) => matches(payment, "late")).length },
          { value: "reversed", label: "Reversed", count: payments.filter((payment) => matches(payment, "reversed")).length },
          { value: "unmatched", label: "Not matched", count: payments.filter((payment) => matches(payment, "unmatched")).length },
        ]}
      />
      <p className="ml-auto text-xs text-muted-foreground" role="status">
        Paid <span className="font-medium text-foreground tabular-nums">{snapshot ? money(sumMinor(cleared.map(({ row }) => row.amountMinor))) : MISSING}</span>
        {since ? ` since ${formatCardDate(since)}` : " since tracking"}
        {" · "}{paidInFull.length} of {plural(saved.length, "bill")} paid in full
        {" · "}{saved.filter((row) => row.status.late).length} late
        {" · "}{payments.filter((payment) => matches(payment, "pending")).length} pending
      </p>
    </div>
    <div className="flex min-h-0 flex-1">
      <DataTable<Payment>
        label={`Payments to ${name}`}
        compact
        columns={columns}
        rows={visible}
        rowKey={(payment) => payment.row.id}
        rowLabel={(payment) => `${from(payment.row)} · ${formatCardDate(payment.date)} · ${money(payment.row.amountMinor)}`}
        activeKey={panelId}
        controller={table}
        onOpen={(payment) => onPanel(payment.row.id)}
        empty={snapshot ? (payments.length ? "No payments match this filter." : "No payments in the loaded history.") : "Refresh Actual to read payments."}
      />
      {selected && <PaymentPanel
        key={selected.row.id}
        payment={selected}
        entry={entry}
        peer={selected.row.transferId ? peers.get(selected.row.transferId) : undefined}
        accountName={accountName}
        onClose={() => onPanel(null)}
        returnFocus={() => table.current?.focusRow(selected.row.id)}
        onStatement={onStatement}
      />}
    </div>
  </div>;
}

function Leg({ title, row, account }: { title: string; row: ActivityRow; account: string | undefined }) {
  return <PanelSection title={title}>
    <dl>
      <PanelRow label="Account" value={account ?? row.label} />
      <PanelRow label="Date" value={formatCardDate(row.date)} />
      <PanelRow label="Amount" value={money(row.amountMinor)} />
      <PanelRow label="Cleared" value={clearing(row)} />
    </dl>
    {row.notes && <p className="mt-1 text-sm whitespace-pre-wrap break-words text-muted-foreground">{row.notes}</p>}
  </PanelSection>;
}

type PanelProps = {
  payment: Payment;
  entry: CardEntry;
  peer: ActivityRow | undefined;
  accountName: (id: string | undefined) => string | undefined;
  onClose: () => void;
  returnFocus: () => void;
  onStatement: (id: string) => void;
};

/** Both transfer legs, notes, and the bill this payment pays with what is left after it. */
function PaymentPanel({ payment, entry, peer, accountName, onClose, returnFocus, onStatement }: PanelProps) {
  const { row, statement } = payment;
  const bill = statement ? entry.view.payments.find((item) => item.statementId === statement.id) : undefined;
  const through = bill?.rows.filter((item) => item.row.cleared === true && (item.date < payment.date || (item.date === payment.date && item.row.id <= row.id)));
  // Plan conversions up to this payment settled part of the bill too.
  const converted = bill?.conversions.filter((item) => item.row.cleared === true && item.date <= payment.date) ?? [];
  const leftAfter = bill && through
    ? Math.max(0, bill.amountDueMinor - sumMinor([...through, ...converted].map((item) => item.row.amountMinor))) : null;
  const timing = paymentTiming(payment, entry.card.firstTrackedStatementDate);
  return <SidePanel
    title={`Payment ${shortDate(payment.date, entry.today)} · ${money(row.amountMinor)}`}
    description={<StatusBadge label={timing.label} tone={timing.tone} />}
    headerHeight={HEADER_ROW_HEIGHT}
    onClose={onClose}
    returnFocus={returnFocus}
    footer={statement && <Button size="sm" variant="outline" onClick={() => onStatement(statement.id)}>
      Open statement {shortDate(statement.closingDate, entry.today)}
    </Button>}
  >
    <PanelSection title="Pays statement">
      {statement && bill ? <dl>
        <PanelRow label="Statement" value={formatCardDate(statement.closingDate)} />
        <PanelRow label="Due" value={formatCardDate(statement.dueDate)} />
        <PanelRow label="Amount due" value={money(bill.amountDueMinor)} />
        <PanelRow strong label="Left to pay after this payment" value={row.cleared === true ? money(leftAfter) : `${money(bill.leftToPayMinor)} (pending)`} />
      </dl> : <p className="text-sm text-muted-foreground">No tracked bill: the payment is outside every statement&apos;s payment window.</p>}
    </PanelSection>
    <Leg title="On the card" row={row} account={accountName(row.accountId) ?? entry.name} />
    {peer ? <Leg title="From" row={peer} account={accountName(peer.accountId)} />
      : <PanelSection title="From">
        <p className="text-sm text-muted-foreground">{row.label}. The funding side isn&apos;t a transfer in Actual.</p>
      </PanelSection>}
  </SidePanel>;
}
