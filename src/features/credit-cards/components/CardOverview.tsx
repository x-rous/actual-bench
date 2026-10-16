"use client";
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { DashboardPanel } from "./DashboardPanels";
import { CreditRing } from "./CardIdentity";
import { ClearingStatus } from "./ClearingStatus";
import type { Card, Statement, Workspace } from "../lib/models";
import type { ActivitySnapshot } from "../lib/activity";
import { paymentTarget } from "../lib/paymentTargets";
import { settlements, type Settlement } from "../lib/repayments";
import { isStartingPoint, statementOutcome } from "../lib/paymentSummary";
import { netActivitySinceStatement } from "../lib/insights";
import { formatCardDate } from "../lib/displayDates";
import { formatAmount, minorToMajorText } from "@/features/assets-debt/lib/money";
import { cardFacility, cardModel } from "../lib/financialAdapter";
import { statementHealth } from "../lib/statementHealth";
import { sumMinor } from "../lib/statements";
import { Status } from "./WorkspaceVisuals";
import { StatementOutcome } from "./StatementOutcome";
import { PaymentTiming } from "./PaymentTiming";
import { ReviewText } from "./ReviewText";
import { trackedCardDebt } from "../lib/planTracking";
import { planDebtBreakdown } from "../lib/planReporting";
import { PlanDebtBreakdown } from "./PlanDebtBreakdown";
import { PlansSection } from "./PlansSection";
import { FieldInfo } from "./FieldInfo";
const money = (value: number | null | undefined) => value == null ? "-" : formatAmount(value, 2);
type Balance = { rawSignedBalanceMinor?: number; signedBalanceMinor: number; debtMinor: number; creditMinor: number };
export function CardOverview({ budget, card, bank, payment, balance, workspace, snapshot, today, available, awaitingStatement, onConfirmDraft, onStatement, onSettings, onPayments, onReview, onStatements, statements, statuses }: { budget: string; card: Card; bank?: Statement; payment?: Settlement; balance?: Balance; workspace: Workspace; snapshot?: ActivitySnapshot; today: string; available: boolean; awaitingStatement?: Statement; onConfirmDraft?: () => void; onStatement: () => void; onSettings: () => void; onPayments: () => void; onReview?: () => void; onStatements?: (id?: string) => void; statements?: Statement[]; statuses?: Settlement[] }) {
  const [showActivity, setShowActivity] = useState(false), [search, setSearch] = useState("");
  const panelId = useId();
  const bridge = bank && snapshot && balance && available ? netActivitySinceStatement(card, bank, workspace, snapshot, balance.rawSignedBalanceMinor ?? balance.signedBalanceMinor, today) : null;
  const known = payment?.fullRemainingMinor != null;
  const credits = payment?.confirmedCreditMinor ?? payment?.confirmedCashbackMinor ?? 0;
  const remaining = bank && known ? Math.max(0, paymentTarget(bank) - payment!.confirmedPaidMinor - credits) : null;
  const minimum = bank && known ? Math.max(0, bank.minimumDueMinor - payment!.confirmedPaidMinor) : null;
  const paid = known ? payment!.confirmedPaidMinor : null;
  const percent = bank && paymentTarget(bank) > 0 && paid !== null ? Math.min(100, (paid + credits) / paymentTarget(bank) * 100) : 0;
  const marker = bank && paymentTarget(bank) > 0 ? Math.min(100, bank.minimumDueMinor / paymentTarget(bank) * 100) : 0;
  const rows = bridge?.rows.filter((row) => [row.label, row.notes ?? "", row.categoryName ?? "", formatCardDate(row.date), formatAmount(row.amountMinor, 2)].some((value) => value.toLowerCase().includes(search.toLowerCase()))) ?? [];
  const tracked = balance && snapshot && available ? trackedCardDebt(card, workspace, snapshot, balance.signedBalanceMinor, today) : undefined;
  const needsPlanBalance = workspace.plans?.some((plan) => plan.cardId === card.id && plan.tracking);
  const currentDebt = tracked?.tracked ? tracked.known ? tracked.debtMinor : undefined : needsPlanBalance ? undefined : balance?.debtMinor;
  const creditDebt = tracked?.tracked ? tracked.known ? tracked.creditUsedMinor : undefined : needsPlanBalance ? undefined : balance?.debtMinor;
  const facility = balance && creditDebt !== undefined ? cardFacility(cardModel(card, today, creditDebt), tracked?.tracked ? -creditDebt : balance.signedBalanceMinor) : null;
  const health = bank ? statementHealth(bank, workspace, snapshot, available) : null;
  const display = statementOutcome(bank, payment, today, available, isStartingPoint(bank, workspace, snapshot, available));
  const outcomes = available ? statuses ?? (snapshot ? settlements(card, { ...workspace, statements: statements ?? workspace.statements }, snapshot, today) : []) : [];
  let fullStreak = 0;
  const statementEvidence = new Map((statements ?? workspace.statements).filter((entry) => entry.cardId === card.id).map((entry) => [entry.id, entry]));
  for (const entry of [...outcomes].reverse().filter((entry) => entry.dueDate < today)) {
    const evidence = statementEvidence.get(entry.statementId);
    if (evidence?.bankConfirmed && evidence.officialBalanceMinor <= 0) continue;
    if (!evidence?.bankConfirmed || entry.fullByDue !== true || entry.minimumByDue !== true) break;
    fullStreak++;
  }
  const charges = bridge ? sumMinor(bridge.rows.filter((row) => row.amountMinor < 0).map((row) => -row.amountMinor)) : null;
  const activityCredits = bridge ? sumMinor(bridge.rows.filter((row) => row.amountMinor > 0).map((row) => row.amountMinor)) : null;
  const hasPlans = workspace.plans?.some((plan) => plan.cardId === card.id);
  const recentStatements = (statements ?? workspace.statements).filter((entry) => entry.cardId === card.id).sort((a, b) => b.closingDate.localeCompare(a.closingDate)).slice(0, 5);
  const obligation = remaining === 0 && minimum ? minimum : remaining;
  const utilization = creditDebt !== undefined && card.creditLimitMinor ? creditDebt / card.creditLimitMinor * 100 : null;
  const minimumOnly = remaining === 0 && minimum !== null && minimum > 0;
  const overdue = Boolean(bank && known && obligation && bank.dueDate < today);
  const statementCount = (statements ?? workspace.statements).filter((entry) => entry.cardId === card.id).length;
  return <div className="space-y-4 bg-muted/15 p-5">
    {awaitingStatement && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 text-xs"><p>Statement {formatCardDate(awaitingStatement.closingDate)} awaits confirmation. Payment amounts use the latest confirmed statement.</p><Button size="xs" variant="outline" onClick={onConfirmDraft}>Confirm statement</Button></div>}
    <div className="grid items-start gap-4 xl:grid-cols-[1.35fr_1fr]">
      <DashboardPanel label="Statement and payment" className="flex flex-col p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{bank ? `Statement of ${formatCardDate(bank.closingDate)}` : "Statement and payment"}</h2>
          {health && (health.key === "verified" ? <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><Check className="size-3" aria-hidden />Verified</span> : <Status tone="neutral">{health.label}</Status>)}
        </div>
        <div className="my-5 grid grid-cols-[1fr_auto] items-end gap-6">
          <div>
            <p className="text-xs text-muted-foreground">{minimumOnly ? "Minimum payment remaining" : overdue ? "Payment remaining · late" : "Remaining to pay"}</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{money(obligation)}</p>
            <div className="mt-3"><StatementOutcome outcome={display} /></div>
            <p className="mt-2 text-xs text-muted-foreground">{bank && known ? obligation === 0 ? display.timing : <><span>Payment due date</span> <span className={cn("font-medium text-foreground", overdue && "text-destructive")}>{formatCardDate(bank.dueDate)}</span>{overdue ? ` · ${daysBetween(bank.dueDate, today)} days past due` : display.countdown ? ` · ${display.countdown}` : ""}</> : available ? "Confirm a statement to track payments" : "Refresh Actual activity"}</p>
          </div>
          <div className="min-w-40 border-l pl-5">
            <p className="text-xs text-muted-foreground">{minimumOnly ? "Remaining to pay" : "Minimum remaining"}</p>
            <p className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", !minimumOnly && bank && bank.dueDate < today && minimum && "text-destructive")}>{money(minimumOnly ? remaining : minimum)}</p>
            {minimum === 0 && known && <p className="mt-1 text-xs text-muted-foreground">Minimum covered</p>}
            {bank && remaining !== null && remaining !== bank.officialBalanceMinor && <p className="mt-3 text-xs text-muted-foreground"><span>Billed balance</span> <span>{money(bank.officialBalanceMinor)}</span></p>}
          </div>
        </div>
        {bank && <p className="text-xs text-muted-foreground">Total Payment Due {money(paymentTarget(bank))}{bank.totalPaymentDueMinor == null ? " · defaults to statement balance" : ""}</p>}
        <div className="mt-4">
          <div className="relative" role="progressbar" aria-label="Confirmed payment progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent.toFixed(1)}% balance covered; minimum remaining ${money(minimum)}`}><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-chart-2" style={{ width: `${percent}%` }} /></div>{marker > 0 && <span className="absolute -top-1 h-3.5 w-0.5 bg-foreground" style={{ left: `min(calc(100% - 2px), ${marker}%)` }} title={`Minimum payment threshold ${money(bank?.minimumDueMinor)}`}><span className="sr-only">Minimum marker {money(bank?.minimumDueMinor)}</span></span>}</div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><p><span>Confirmed paid</span> {money(paid)}</p><span className="flex items-center">Payment basis<FieldInfo label="Payment basis">Only cleared payments count as confirmed. Credits {money(credits)} reduce the balance but do not count toward the minimum. Original minimum due {money(bank?.minimumDueMinor)}. Auto-pay: {card.autoPay}. The progress marker shows the original minimum threshold; it is not a payment forecast.</FieldInfo></span></div>
          {credits > 0 && <p className="mt-2 text-xs text-muted-foreground">Credits {money(credits)} reduce the balance; they don’t count toward the minimum.</p>}
          {payment?.provisionalMinor ? <p className="mt-2 text-xs text-muted-foreground">{money(payment.provisionalMinor)} payment recorded · clearing pending</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">{bank && onReview && <Button size="sm" onClick={onReview}>Review statement</Button>}<Button size="sm" variant="outline" onClick={onPayments}>Review repayments</Button><Button size="xs" variant="ghost" onClick={onStatement}>{bank ? "Edit statement values" : "Add latest statement"}</Button></div>
        </div>
      </DashboardPanel>
      <DashboardPanel label="Current balance and activity" className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-xs font-medium text-muted-foreground">Total debt</h2><p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{money(currentDebt)}</p>{needsPlanBalance && (!tracked || !tracked.known) && balance && <p className="mt-2 text-xs text-muted-foreground">On card {money(-balance.signedBalanceMinor)} · refresh plan balance</p>}{tracked?.tracked && tracked.known && <p className="mt-2 text-xs text-muted-foreground">On card {money(balance ? -balance.signedBalanceMinor : null)} + in plan account {money(tracked.trackingMinor)}{tracked.transitMinor ? ` · transfer in transit ${money(tracked.transitMinor)}` : ""}{tracked.problems.some((problem) => problem.includes("unassigned")) ? " · assigned plans only" : ""}</p>}{tracked?.tracked && tracked.known && tracked.confirmedDebtMinor !== tracked.debtMinor && <p className="mt-1 text-xs text-muted-foreground">Before pending activity {money(tracked.confirmedDebtMinor)} · pending payments do not release credit</p>}{facility?.availableMinor != null && <p className="mt-2 text-xs text-muted-foreground">{money(facility.availableMinor)} estimated available<FieldInfo label="Estimated available credit">Derived from the entered limit and recorded debt. Pending repayments do not release credit. This is not the bank’s live authorization limit.</FieldInfo></p>}</div>
          <CreditRing percent={utilization} />
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{card.creditLimitMinor ? `Limit ${money(card.creditLimitMinor)}` : "Credit limit not set"}</span>{balance?.creditMinor ? <span>Card credit remaining {money(balance.creditMinor)}</span> : null}</div>
        {hasPlans && snapshot && balance && available && <PlanDebtBreakdown breakdown={planDebtBreakdown(card, workspace, snapshot, balance.rawSignedBalanceMinor ?? balance.signedBalanceMinor, today)} />}
        <div className="mt-4 border-t pt-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Current balance and activity</h3><FieldInfo label="Activity basis">Reviewed statement cutoff decisions are respected; otherwise Actual or saved bank posting dates apply. Scheduled future entries are excluded. Uncleared activity is included provisionally. A negative current balance is card credit.</FieldInfo></div><p className="mt-1 text-xs text-muted-foreground">{bank ? `Not yet on a statement · since ${formatCardDate(bank.closingDate)}` : "Confirm a statement to reconcile activity"}</p>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Charges</dt><dd className="font-medium tabular-nums">{money(charges)}</dd></div>
            {(activityCredits === null || activityCredits > 0) && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Payments / credits</dt><dd className="font-medium tabular-nums">{money(activityCredits)}</dd></div>}

          </dl>
          {bridge && <>

            {!bridge.covered && <p className="mt-3 text-xs text-muted-foreground">Couldn’t load complete activity. Retry Refresh; the statement match is separate.</p>}
            {bridge.pendingCount > 0 && <p className="mt-3 text-xs text-muted-foreground">{bridge.pendingCount} uncleared {bridge.pendingCount === 1 ? "transaction is" : "transactions are"} included in activity; figures are provisional.</p>}
            <Button className="mt-3" size="xs" variant="outline" aria-expanded={showActivity} aria-controls={panelId} onClick={() => setShowActivity(!showActivity)}>{showActivity ? "Hide contributing transactions" : "View contributing transactions"}</Button>
          </>}
        </div>
      </DashboardPanel>
    </div>
    {fullStreak > 0 && <p className="flex items-center gap-2 rounded-lg border border-chart-2/20 bg-chart-2/5 px-4 py-3 text-xs text-green-700 dark:text-green-400"><Check className="size-3.5 shrink-0" aria-hidden />Full balance settled by the due date for {fullStreak} consecutive tracked {fullStreak === 1 ? "statement" : "statements"}.{hasPlans ? " This refers to billed statements; remaining plan principal is separate." : ""}</p>}
    {showActivity && bridge && <DashboardPanel label="Contributing activity" className="overflow-hidden"><div id={panelId} className="overflow-auto p-4"><SearchInput size="sm" className="mb-3 max-w-sm" aria-label="Search contributing transactions" placeholder="Search transactions…" value={search} onValueChange={setSearch} /><table className="w-full min-w-[600px] table-fixed text-left text-xs"><caption className="sr-only">Transactions outside the latest statement</caption><thead className="bg-muted/30"><tr>{["Date", "Payee", "Notes", "Amount", "Cleared"].map((label) => <th key={label} className={cn("p-2", label === "Amount" && "text-right")}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t hover:bg-muted/20"><td className="p-2">{formatCardDate(row.date)}</td><td className="p-2"><ReviewText text={row.label} label="contributing payee" /></td><td className="p-2"><ReviewText text={row.notes ?? "-"} label="contributing notes" /></td><td className="p-2 text-right tabular-nums">{money(row.amountMinor)}</td><td className="p-2"><ClearingStatus cleared={row.cleared} available={available} /></td></tr>)}</tbody></table>{!rows.length && <p className="pt-3 text-xs text-muted-foreground">No transactions match your search.</p>}</div></DashboardPanel>}
    <div className="grid items-start gap-4 xl:grid-cols-[1.65fr_1fr]">
      <DashboardPanel label="Recent statements" className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-semibold">Recent statements</h2><p className="mt-1 text-xs text-muted-foreground">Billed balances and payment timing</p></div><Button variant="outline" size="xs" onClick={() => onStatements?.()}>All statements ({statementCount})</Button></div>
        <div className="overflow-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b bg-muted/20 text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Statement</th><th className="px-4 py-2 text-right font-medium">Balance</th><th className="px-4 py-2 font-medium">Paid against due date</th><th className="px-4 py-2 font-medium">Outcome</th></tr></thead><tbody>{recentStatements.map((entry) => { const outcome = outcomes.find((value) => value.statementId === entry.id), state = statementOutcome(entry, outcome, today, available, isStartingPoint(entry, workspace, snapshot, available)); return <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20"><td className="px-4 py-3"><Button variant="link" size="xs" className="h-auto whitespace-nowrap p-0 text-xs" onClick={() => onStatements?.(entry.id)}>{formatCardDate(entry.closingDate)}</Button></td><td className="px-4 py-3 text-right font-medium tabular-nums">{money(entry.officialBalanceMinor)}</td><td className="px-4 py-3"><PaymentTiming closingDate={entry.closingDate} dueDate={entry.dueDate} date={state.date} label={state.timing} state={state.marker} /></td><td className="px-4 py-3"><StatementOutcome outcome={state} label={`payment outcome for ${formatCardDate(entry.closingDate)}`} /></td></tr>; })}</tbody></table>{!recentStatements.length && <p className="p-4 text-xs text-muted-foreground">No saved statements yet.</p>}</div>
      </DashboardPanel>
      <div className="min-w-0 space-y-4">
        <DashboardPanel label="Card terms" className="px-4 py-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Card terms</h2><Button size="xs" variant="ghost" onClick={onSettings}>Edit card terms</Button></div><dl className="mt-2 divide-y text-xs">{[["Credit limit", money(card.creditLimitMinor)], ["Purchase APR", card.purchaseAprBps == null ? "Not set" : `${minorToMajorText(card.purchaseAprBps, 2)}%`], ["Billing cycle", card.closingDay == null ? "Not set" : `Closes day ${card.closingDay}`], ["Payment rule", card.dueRule?.kind === "days-after-close" ? `${card.dueRule.days} days after close` : card.dueRule ? `Day ${card.dueRule.day} of month` : "Not set"], ["Minimum estimate", card.minimumPercentBps == null ? "Not set" : `${minorToMajorText(card.minimumPercentBps, 2)}% / floor ${money(card.minimumFloorMinor)}`], ["Auto-pay", card.autoPay[0].toUpperCase() + card.autoPay.slice(1)]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></DashboardPanel>
        {!hasPlans && <PlansSection budget={budget} card={card} workspace={workspace} snapshot={snapshot} available={available} today={today} />}
      </div>
    </div>
    {hasPlans && <PlansSection budget={budget} card={card} workspace={workspace} snapshot={snapshot} available={available} today={today} />}
  </div>;
}
