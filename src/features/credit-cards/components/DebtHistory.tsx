"use client";
import { useId, useMemo, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Card, Workspace } from "../lib/models";
import type { ActivitySnapshot } from "../lib/activity";
import { activityKind } from "../lib/activity";
import { formatCardDate } from "../lib/displayDates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { addDays, daysBetween } from "@/lib/financial-models/calendar/dates";
import { calculateCardDebt, cardModel, projectCardMinimums } from "../lib/financialAdapter";
import { observedChargeTotals, cumulativeInterestCharges, observedInterestTotals, statementHistory, statementMovement } from "../lib/history";
import { carriedDebtPoints } from "../lib/insights";
import { trackedDebtPoints } from "../lib/planTracking";
import { statementChargeBreakdown } from "../lib/planReporting";
import { repaymentLedger } from "../lib/repayments";
import { sumMinor } from "../lib/statements";
import { statementOutcome, isStartingPoint } from "../lib/paymentSummary";
import { StatementOutcome } from "./StatementOutcome";
import { DashboardPanel, DashboardStat } from "./DashboardPanels";
import { FieldInfo } from "./FieldInfo";
import { HistoryChart } from "./HistoryChart";
const money = (value: number | null | undefined) => value == null ? "-" : formatAmount(value, 2);

function MinimumSimulation({ card, today, debtMinor }: { card: Card; today: string; debtMinor: number }) {
  const projection = useMemo(() => projectCardMinimums(card, today, debtMinor), [card, today, debtMinor]);
  const illustration = card.interestModel !== "off" && card.purchaseAprBps !== null ? calculateCardDebt({ model: cardModel(card, today, debtMinor), anchor: { date: today, principalMinor: debtMinor, accruedInterestMinor: 0, source: "current-actual-balance" }, events: [], to: addDays(today, 30) }) : null;
  return <div className="mt-4 space-y-4 border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>Illustration from current debt {money(debtMinor)} · {card.purchaseAprBps === null ? "APR not set" : `${card.purchaseAprBps / 100}% APR`} · not a bank payoff quote</p><span className="flex items-center">Model assumptions<FieldInfo label="Minimum repayment assumptions">No new purchases, fees or APR changes. Daily simple interest with monthly capitalization; no grace period. One purchase APR applies to all current debt; separate cash-advance and balance-transfer APR buckets, future instalment-specific terms, purchase grace periods and issuer residual-interest rules are not modeled. Your issuer’s minimum formula and interest rules may differ. This does not describe your observed payment strategy.</FieldInfo></span></div>
    {projection?.ok ? <>
      <dl className="grid grid-cols-3 gap-3">
        <DashboardStat label="Estimated payoff" value={projection.payoffDate ? `~${Math.ceil(daysBetween(today, projection.payoffDate) / 30.4375)} months` : "Beyond 30 years"} detail={projection.payoffDate ? formatCardDate(projection.payoffDate) : "Not repaid within the modeled period"} />
        <DashboardStat label="Future interest with minimums" value={money(projection.interestMinor)} detail={projection.payoffDate ? "To estimated payoff" : "Over 30 years"} className="border-chart-5/25 bg-chart-5/5" />
        <DashboardStat label="30-day interest illustration" value={money(illustration?.ok ? sumMinor([illustration.closing.accruedInterestMinor, ...illustration.events.map((event) => event.interestMinor)]) : null)} detail="No repayments or grace period" />
      </dl>
      {(projection.insufficientInterestPayments || !projection.payoffDate) && <p className="text-xs text-destructive">{projection.insufficientInterestPayments ? "Some minimum payments do not cover accrued interest; debt can grow." : "Minimums cover interest, but do not settle the debt within 30 years."}</p>}
      <div className="grid grid-cols-2 gap-4"><HistoryChart title="Projected balance with minimums" historical={false} points={projection.balancePoints} /><HistoryChart title="Projected cumulative interest with minimums" tone="interest" zeroReference historical={false} points={projection.interestPoints} /></div>
    </> : <p className="text-xs text-muted-foreground">{projection && !projection.ok ? projection.message : "Set APR, minimum percentage, billing cycle and a supported illustration in Settings."}</p>}
  </div>;

}

export function DebtHistory({ card, workspace, snapshot, today, debtMinor, signedBalanceMinor, available, onSettings, onStatement }: { card: Card; workspace: Workspace; snapshot?: ActivitySnapshot; today: string; debtMinor?: number; signedBalanceMinor?: number; available: boolean; onSettings: () => void; onStatement?: (id: string) => void }) {
  const [showSimulation, setShowSimulation] = useState(false);
  const [showZeroInterest, setShowZeroInterest] = useState(false);
  const simulationId = useId();
  if (!snapshot || !available) return <p className="text-xs text-muted-foreground">Refresh Actual activity to view confirmed debt history. Bank statements are retained.</p>;
  const history = statementHistory(card, workspace, snapshot, today);
  const interest = observedInterestTotals(card, workspace, snapshot, today);
  const observedFees = observedChargeTotals(card, workspace, snapshot, today, "fee");
  const fees = observedFees.totalMinor;
  const feesKnown = observedFees.classificationKnown;
  const ledger = repaymentLedger(card, workspace, snapshot, today);
  const carry = carriedDebtPoints(card, workspace, snapshot, today);
  const cumulative = cumulativeInterestCharges(history);
  const zeroInterest = cumulative.length > 0 && cumulative.every((point) => point.value === 0);
  const historical = [...history].reverse().filter((entry) => entry.statement.bankConfirmed && entry.covered);
  const balancePoints = historical.map((entry) => {
    const bridge = statementMovement(card, entry.statement, workspace, snapshot);
    return { date: entry.statement.closingDate, value: entry.statement.officialBalanceMinor, source: "Confirmed bank value", breakdown: [{ label: "Previous billed balance", value: bridge.openingMinor }, { label: "Purchases and borrowing", value: bridge.purchasesMinor }, { label: "Charges (unclassified)", value: bridge.unclassifiedMinor }, { label: "Interest", value: bridge.interestMinor }, { label: "Fees", value: bridge.feesMinor }, { label: "Cycle payments", value: bridge.paymentsMinor }, { label: "Refunds", value: bridge.refundsMinor }, { label: "Cashback", value: bridge.cashbackMinor }, { label: "Plan charges (included in posted movements)", value: statementChargeBreakdown(card, entry.statement, workspace, snapshot)?.planChargesMinor ?? null }, { label: "Other adjustments", value: bridge.otherMinor }, { label: "Statement balance difference", value: bridge.varianceMinor }] };
  });
  const interestPoints = cumulative.map((point) => { const entry = history.find((item) => item.statement.closingDate === point.date)!; const cumulativeFees = sumMinor(history.filter((item) => item.statement.closingDate <= point.date).map((item) => item.feesMinor ?? 0)); return { ...point, source: "Observed Actual charges", breakdown: [{ label: "Interest this cycle", value: entry.interestMinor }, { label: "Fees this cycle", value: entry.feesMinor }, { label: "Cumulative fees (separate from interest)", value: feesKnown ? cumulativeFees : null }] }; });
  const hasTracking = workspace.plans?.some((plan) => plan.cardId === card.id && plan.tracking);
  const signedCard = signedBalanceMinor;
  const combinedPoints = signedCard !== undefined ? trackedDebtPoints(card, workspace, snapshot, signedCard, [...new Set([...history.map((entry) => entry.statement.closingDate), today])].sort()) : [];
  const carriedCount = carry.filter((point) => point.value !== null && point.value > 0).length;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{formatCardDate(interest.from)} – {formatCardDate(interest.to)} · tracked history</p>
      <span className="flex items-center text-xs text-muted-foreground">Historical debt evidence<FieldInfo label="Historical debt evidence">Actual carry is the balance left at each passed due date, based on confirmed payments by that deadline. Later payments do not erase it. Upcoming, estimated and pending-evidence periods are omitted; gaps are not proof of zero debt. Charts use recorded bank balances; plan expectations never add extra debt. Your bank may already include converted principal. Posted interest is observed separately; carried debt does not establish that interest was charged.</FieldInfo></span>
    </div>
    <dl className="grid grid-cols-4 gap-4" aria-label="Debt history summary">
      <DashboardStat label="Observed interest charges" value={money(interest.classificationKnown || interest.totalMinor > 0 ? interest.totalMinor : null)} detail={<span className="flex items-center">Actual posting dates<FieldInfo label="Recorded interest detail">Gross charges {money(interest.grossMinor)}; refunds {money(interest.refundsMinor)}. Net recorded interest, including plan interest; not interest paid or forecast.</FieldInfo></span>} />
      <DashboardStat label="Observed fees" value={money(feesKnown || fees > 0 ? fees : null)} detail={<span className="flex items-center">Separate from interest<FieldInfo label="Recorded fee detail">Gross fees {money(observedFees.grossMinor)}; refunds {money(observedFees.refundsMinor)}. Plan fees are included once; future costs are excluded.</FieldInfo></span>} />
      <DashboardStat label="Repayments confirmed" value={money(sumMinor(snapshot.rows.filter((row) => row.cleared === true && activityKind(row, card, workspace, snapshot) === "payment" && row.date > (ledger.anchorDate ?? card.firstTrackedStatementDate ?? snapshot.from) && row.date <= today).map((row) => row.amountMinor)))} detail="Since opening billed statement" />
      <DashboardStat label="Carried at last due date" value={money(carry.at(-1)?.value)} detail={carry.at(-1) ? `After ${formatCardDate(carry.at(-1)!.date)}` : "No passed due date with evidence"} />
    </dl>
    {(!interest.classificationKnown || !feesKnown) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"><p className="flex items-center gap-2 text-xs"><Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />Classification or history is incomplete. Unknown charges are not zero.</p><Button size="xs" variant="outline" onClick={onSettings}>Set charge categories</Button></div>}
    {carriedCount > 0 && <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><Info className="size-3.5 shrink-0" aria-hidden />Balance remained after {carriedCount} tracked due {carriedCount === 1 ? "date" : "dates"}. Later repayments do not change this history.</p>}
    <HistoryChart title="Total debt over time" points={combinedPoints} observationLabel={hasTracking ? "On card + assigned plan account. Billing moves debt; payments reduce it." : "Recorded card balance; separate from statement balances."} />
    <div className={`grid items-stretch gap-4 ${zeroInterest && !showZeroInterest ? "grid-cols-2" : "grid-cols-3"}`}>
      <HistoryChart title="Balance carried at due date" points={carry} kind="bar" />
      <HistoryChart title="Statement balances" points={balancePoints} kind="line" />
      {(!zeroInterest || showZeroInterest) && <HistoryChart title="Cumulative interest charged" tone="interest" zeroReference kind="line" points={interestPoints} />}
    </div>
    {zeroInterest && !showZeroInterest && <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3"><p className="text-xs"><span className="font-medium">Cumulative interest charged: 0.00</span><span className="ml-2 text-muted-foreground">No identified interest charges in the covered statement periods.</span></p><Button variant="ghost" size="xs" onClick={() => setShowZeroInterest(true)}>Show zero-interest chart</Button></div>}
    {debtMinor !== undefined && debtMinor > 0 && <DashboardPanel label="Minimum-only illustration" className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">If you only pay the minimum</h3><p className="mt-1 text-xs text-muted-foreground">Explore a repayment illustration{debtMinor === undefined ? "" : ` from current debt ${money(debtMinor)}`}</p></div><Button variant="outline" size="sm" aria-expanded={showSimulation} aria-controls={simulationId} onClick={() => setShowSimulation(!showSimulation)}>{showSimulation ? "Hide illustration" : "What if I only pay the minimum?"}<ChevronDown className={`size-3.5 transition-transform ${showSimulation ? "rotate-180" : ""}`} aria-hidden /></Button></div>{showSimulation && <div id={simulationId}>{workspace.plans?.some((plan) => plan.cardId === card.id && plan.status === "active") ? <p className="mt-4 rounded-lg border border-chart-5/30 bg-chart-5/5 p-3 text-xs">Payoff illustration unavailable for cards with active repayment plans. A single purchase APR cannot represent plan rates, remaining schedules and issuer payment allocation. Review each plan’s schedule instead.</p> : debtMinor === undefined ? <p className="mt-3 text-xs">Refresh the current card balance to simulate repayments.</p> : <MinimumSimulation card={card} today={today} debtMinor={debtMinor} />}</div>}</DashboardPanel>}
    <div className="overflow-auto rounded-xl border bg-background"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-semibold">Statement breakdown</h2><p className="mt-1 text-xs text-muted-foreground">Charges, credits and repayments by statement</p></div><span className="flex items-center text-xs text-muted-foreground">Reading this table<FieldInfo label="Statement breakdown">Cycle charges and credits describe statement membership. Confirmed repayments show payments toward that statement, which can occur in a later cycle. These columns are not an arithmetic equation for billed balance. Historical carried amounts reflect only the due-date deadline. Unknown amounts remain unavailable.</FieldInfo></span></div><table className="w-full min-w-[1100px] text-left text-xs [&_th:not(:first-child):not(:last-child)]:text-right [&_td:not(:first-child):not(:last-child)]:text-right [&_td]:tabular-nums"><caption className="sr-only">Actual statement debt history</caption><thead className="bg-muted/10 text-xs font-medium text-muted-foreground"><tr>{["Statement", "Billed balance", "New charges", "Interest", "Fees", "Refunds", "Cashback", "Confirmed repayments", "Carried at due date", "Payment outcome"].map((label) => <th className="px-3 py-2" scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{history.map((entry) => <tr key={entry.statement.id} className="border-t hover:bg-muted/20"><td className="px-4 py-2 whitespace-nowrap">{onStatement ? <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => onStatement(entry.statement.id)}>{formatCardDate(entry.statement.closingDate)}</Button> : formatCardDate(entry.statement.closingDate)}{!entry.statement.bankConfirmed && " · estimate"}</td><td className="px-3 py-2">{money(entry.statement.officialBalanceMinor)}</td><td className="px-3 py-2">{money(entry.spendingMinor)}{(entry.unclassifiedMinor ?? 0) > 0 && <FieldInfo label={`Unclassified charges for ${formatCardDate(entry.statement.closingDate)}`}>Includes {money(entry.unclassifiedMinor)} unclassified charges.</FieldInfo>}</td><td className="px-3 py-2">{money(entry.interestMinor)}</td><td className="px-3 py-2">{money(entry.feesMinor)}</td><td className="px-3 py-2">{money(entry.refundsMinor)}</td><td className="px-3 py-2">{money(entry.cashbackMinor)}</td><td className="px-3 py-2">{money(entry.settlement.confirmedPaidMinor)}</td><td className="px-3 py-2">{entry.statement.dueDate >= today ? "Not past due date" : money(entry.settlement.carriedAtDueMinor)}</td><td className="px-3 py-2"><StatementOutcome outcome={statementOutcome(entry.statement, entry.settlement, today, available, isStartingPoint(entry.statement, workspace, snapshot, available))} label={`payment outcome for ${formatCardDate(entry.statement.closingDate)}`} /></td></tr>)}</tbody></table></div>
    <div className="flex items-center gap-1 text-xs text-muted-foreground">Interest and repayment basis<FieldInfo label="Interest and repayment basis">Interest charged is separate from interest paid. A transfer alone cannot establish the bank’s allocation between interest and principal. Annual fees and their VAT remain fees even if the issuer groups them under Finance Charges.</FieldInfo></div>
  </>;
}
