"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Card, Statement, Workspace } from "../lib/models";
import type { ActivitySnapshot } from "../lib/activity";
import { paymentDeadline, type Settlement } from "../lib/repayments";
import { netActivitySinceStatement } from "../lib/insights";
import { formatCardDate } from "../lib/displayDates";
import { formatAmount, minorToMajorText } from "@/features/assets-debt/lib/money";
import { cardFacility, cardModel } from "../lib/financialAdapter";
import { Status, settlementTone } from "./WorkspaceVisuals";
import { ReviewText } from "./ReviewText";

type Balance = { signedBalanceMinor: number; debtMinor: number; creditMinor: number };
const money = (value: number | null | undefined) => value === null || value === undefined ? "Unavailable" : formatAmount(value, 2);
export function CardOverview({ card, bank, payment, balance, workspace, snapshot, today, available, onStatement, onSettings, onPayments }: { card: Card; bank?: Statement; payment?: Settlement; balance?: Balance; workspace: Workspace; snapshot?: ActivitySnapshot; today: string; available: boolean; onStatement: () => void; onSettings: () => void; onPayments: () => void }) {
  const [showActivity, setShowActivity] = useState(false);
  const [search, setSearch] = useState("");
  const panelId = useId();
  const bridge = bank && snapshot && balance && available ? netActivitySinceStatement(card, bank, workspace, snapshot, balance.signedBalanceMinor, today) : null;
  const known = payment?.fullRemainingMinor !== null && payment?.fullRemainingMinor !== undefined;
  const confirmedRemaining = bank && known ? Math.max(0, bank.officialBalanceMinor - payment!.confirmedPaidMinor) : null;
  const confirmedMinimum = bank && known ? Math.max(0, bank.minimumDueMinor - payment!.confirmedPaidMinor) : null;
  const rows = bridge?.rows.filter((row) => [row.label, row.notes ?? "", row.categoryName ?? "", formatCardDate(row.date), formatAmount(row.amountMinor, 2)].some((value) => value.toLowerCase().includes(search.toLowerCase()))) ?? [];
  const facility = balance ? cardFacility(cardModel(card, today, balance.debtMinor), balance.signedBalanceMinor) : null;
  const paymentStatus = confirmedRemaining === 0 ? payment?.status : confirmedMinimum === 0 ? "Minimum met · balance remains" : payment?.provisionalMinor && payment.minimumRemainingMinor === 0 ? "Clearing pending" : bank ? paymentDeadline(bank.dueDate, today) : null;
  return <>
    <section className="min-w-0 rounded-md border border-border p-3" aria-label="Statement and payment">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-sm font-semibold">Statement and payment</h2><p className="text-xs text-muted-foreground">{bank ? `Latest statement · ${formatCardDate(bank.closingDate)}` : "Confirm bank values to start repayment tracking."}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Button size="xs" variant="outline" onClick={onStatement}>{bank ? "Correct bank facts" : "Add latest statement"}</Button><Button size="xs" variant="outline" onClick={onPayments}>Review repayments</Button></div>
      </div>
      <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-x-4 gap-y-2">
        <OverviewField label="Billed statement balance" value={money(bank?.officialBalanceMinor)} detail={bank ? `Minimum due: ${money(bank.minimumDueMinor)}` : "Bank values not confirmed"} />
        <OverviewField label="Payment due date" value={bank ? formatCardDate(bank.dueDate) : "Confirm statement"} detail="Issuer’s confirmed deadline" />
        <OverviewField label="Full payment remaining" value={money(confirmedRemaining)} detail="After confirmed payments" />
        <OverviewField label="Minimum remaining" value={money(confirmedMinimum)} detail={known ? `Confirmed paid: ${money(payment?.confirmedPaidMinor)}` : "Payment evidence unavailable"} />
        <div className="text-xs"><dt className="text-muted-foreground">Payment status</dt><dd className="mt-1">{paymentStatus ? <Status tone={settlementTone(payment)}>{paymentStatus}</Status> : "Confirm the latest bank statement"}</dd><dd className="mt-1 text-muted-foreground">{bank ? <><span>Evidence: </span><span>{bank.verification === "verified" ? "Verified" : bank.openingAnchor ? "Bank recorded · opening anchor" : "Needs transaction review"}</span></> : "No saved statement"}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Official balance and minimum are bank facts, not remaining amounts due. Remaining amounts deduct confirmed payments.{payment?.provisionalMinor ? ` ${money(payment.provisionalMinor)} recorded · clearing pending.` : ""}</p>
    </section>
    <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
    <section className="min-w-0 rounded-md border border-border p-3" aria-label="Current balance and activity">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Current balance and activity</h2>{bridge && <Button size="xs" variant="outline" aria-expanded={showActivity} aria-controls={panelId} onClick={() => setShowActivity(!showActivity)}>{showActivity ? "Hide contributing transactions" : "View contributing transactions"}</Button>}</div>
      <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-x-4 gap-y-2">
        <OverviewField label="Current debt" value={money(balance?.debtMinor)} detail="Actual account balance" />
        <OverviewField label="Card credit remaining" value={money(balance?.creditMinor)} detail="Actual surplus, distinct from statement overpayment" />
        <OverviewField label="Available credit" value={money(facility?.availableMinor)} detail={balance && card.creditLimitMinor ? `${(balance.debtMinor / card.creditLimitMinor * 100).toFixed(1)}% utilization` : "Set a credit limit in Settings"} />
        <OverviewField label="Net activity since statement" value={money(bridge?.differenceMinor)} detail={bridge ? `Since ${formatCardDate(bank!.closingDate)}` : "Confirm statement and refresh activity"} />
      </dl>
      {bridge && <div className="mt-2 border-t border-border pt-2">
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{bridge.groups.map((group) => <div className="flex items-baseline gap-1" key={group.label}><dt className="text-muted-foreground">{group.label}</dt><dd className="font-medium tabular-nums">{money(group.value)}</dd></div>)}{(!bridge.covered || bridge.netMinor !== bridge.differenceMinor) && <div className="flex items-baseline gap-1"><dt className="text-muted-foreground">Net transactions</dt><dd className="tabular-nums">{money(bridge.covered ? bridge.netMinor : null)}</dd></div>}<div className="flex items-baseline gap-1"><dt className="text-muted-foreground">Unexplained difference</dt><dd className={`tabular-nums ${bridge.unexplainedMinor ? "text-destructive" : "text-muted-foreground"}`}>{money(bridge.unexplainedMinor)}</dd></div></dl>
        <p className="mt-2 text-xs text-muted-foreground">{bridge.covered ? `${bridge.pendingCount} uncleared transactions included provisionally. ` : "Load complete history to reconcile the bridge. "}Activity includes spending, payments and credits using posting dates, not month tags; scheduled future activity is excluded.</p>
        {showActivity && <div id={panelId} className="mt-3 overflow-auto"><Input size="sm" className="mb-2 max-w-sm" aria-label="Search contributing transactions" placeholder="Search transactions…" value={search} onChange={(event) => setSearch(event.target.value)} /><table className="w-full table-fixed text-left text-xs"><caption className="sr-only">Transactions since statement closing</caption><thead className="bg-muted"><tr>{["Date", "Payee", "Notes", "Amount", "Cleared"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-2">{formatCardDate(row.date)}</td><td className="p-2"><ReviewText text={row.label} label="contributing payee" /></td><td className="p-2"><ReviewText text={row.notes ?? "-"} label="contributing notes" /></td><td className={`p-2 tabular-nums ${row.amountMinor < 0 ? "text-destructive" : "text-chart-2"}`}>{money(row.amountMinor)}</td><td className="p-2">{row.cleared === true ? "Cleared" : "Pending / unknown"}</td></tr>)}</tbody></table></div>}
      </div>}
    </section>
    <section className="min-w-0 rounded-md border border-border p-3" aria-label="Card terms"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Card terms</h2><Button size="xs" variant="outline" onClick={onSettings}>Edit card terms</Button></div><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-2">{[["Credit limit", money(card.creditLimitMinor)], ["Purchase APR", card.purchaseAprBps === null ? "Not set" : `${minorToMajorText(card.purchaseAprBps, 2)}%`], ["Billing cycle", card.closingDay === null ? "Not set" : `Closes day ${card.closingDay}`], ["Payment rule", card.dueRule?.kind === "days-after-close" ? `${card.dueRule.days} days after close` : card.dueRule ? `Day ${card.dueRule.day}` : "Not set"], ["Minimum estimate", card.minimumPercentBps === null ? "Not set" : `${minorToMajorText(card.minimumPercentBps, 2)}% / floor ${money(card.minimumFloorMinor)}`], ["Auto-pay", card.autoPay]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>)}</dl></section>
    </div>
  </>;
}

function OverviewField({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd><dd className="mt-0.5 text-xs text-muted-foreground">{detail}</dd></div>;
}
