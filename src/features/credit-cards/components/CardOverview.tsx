"use client";
import { useId, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DashboardPanel } from "./DashboardPanels";
import { ClearingStatus } from "./ClearingStatus";
import type { Card, Statement, Workspace } from "../lib/models";
import { activityKind, type ActivitySnapshot } from "../lib/activity";
import { paymentTarget, confirmedPaymentProgress } from "../lib/paymentTargets";
import type { Settlement } from "../lib/repayments";
import { isStartingPoint, statementOutcome } from "../lib/paymentSummary";
import { netActivitySinceStatement } from "../lib/insights";
import { formatCardDate } from "../lib/displayDates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { cardFacility, cardModel } from "../lib/financialAdapter";
import { statementHealth } from "../lib/statementHealth";
import { sumMinor } from "../lib/statements";
import { Status, BalanceProgress } from "./WorkspaceVisuals";
import { StatementOutcome } from "./StatementOutcome";
import { ReviewText } from "./ReviewText";
import { trackedCardDebt } from "../lib/planTracking";
import { PlanAccountNotice } from "./PlanAccountNotice";
import { PlansSection } from "./PlansSection";
import { FieldInfo } from "./FieldInfo";
import { OverviewDetails } from "./OverviewDetails";
const money = (value: number | null | undefined) => value == null ? "-" : formatAmount(value, 2);
type Balance = { rawSignedBalanceMinor?: number; signedBalanceMinor: number; debtMinor: number; creditMinor: number };
export function CardOverview({ budget, card, bank, payment, balance, workspace, snapshot, today, available, awaitingStatement, onConfirmDraft, onSettings, statements, statuses, onStatements, onPayments, onPayment }: { budget: string; card: Card; bank?: Statement; payment?: Settlement; balance?: Balance; workspace: Workspace; snapshot?: ActivitySnapshot; today: string; available: boolean; awaitingStatement?: Statement; onConfirmDraft?: () => void; onSettings: () => void; statements?: Statement[]; statuses?: Settlement[]; onStatements?: (id?: string) => void; onPayments?: () => void; onPayment?: (id: string) => void }) {
  const [showActivity, setShowActivity] = useState(false), [search, setSearch] = useState("");
  const panelId = useId();
  const bridge = bank && snapshot && balance && available ? netActivitySinceStatement(card, bank, workspace, snapshot, balance.rawSignedBalanceMinor ?? balance.signedBalanceMinor, today) : null;
  const activityNotice = bridge && !bridge.covered && snapshot ? snapshot.issues.length
    ? "Some transaction details are incomplete. Refresh to retry."
    : snapshot.to < today ? `Activity loaded through ${formatCardDate(snapshot.to)}. Refresh for today.`
      : `Activity starts on ${formatCardDate(snapshot.from)}. Refresh to load the full period.` : null;
  const progress = bank ? confirmedPaymentProgress(bank, payment) : null;
  const known = progress?.known ?? false;
  const credits = payment?.confirmedCreditMinor ?? payment?.confirmedCashbackMinor ?? 0;
  const pendingStatementCredits = payment?.provisionalCreditMinor ?? payment?.provisionalCashbackMinor ?? 0;
  const remaining = progress?.toPayMinor ?? null;
  const minimum = progress?.minimumToPayMinor ?? null;
  const paid = known ? payment!.confirmedPaidMinor : null;
  const percent = bank && paymentTarget(bank) > 0 && paid !== null ? Math.min(100, paid / paymentTarget(bank) * 100) : 0;
  const marker = bank && paymentTarget(bank) > 0 ? Math.min(100, bank.minimumDueMinor / paymentTarget(bank) * 100) : 0;
  const rows = bridge?.rows.filter((row) => [row.label, row.notes ?? "", row.categoryName ?? "", formatCardDate(row.date), formatAmount(row.amountMinor, 2)].some((value) => value.toLowerCase().includes(search.toLowerCase()))) ?? [];
  const tracked = balance && snapshot && available ? trackedCardDebt(card, workspace, snapshot, balance.signedBalanceMinor, today) : undefined;
  const needsPlanBalance = workspace.plans?.some((plan) => plan.cardId === card.id && plan.tracking);
  const currentDebt = tracked?.tracked ? tracked.known ? tracked.debtMinor : undefined : needsPlanBalance ? undefined : balance?.debtMinor;
  const creditDebt = tracked ? tracked.known ? tracked.creditUsedMinor : undefined : needsPlanBalance ? undefined : balance?.debtMinor;
  const facility = balance && creditDebt !== undefined ? cardFacility(cardModel(card, today, creditDebt), tracked?.known ? tracked.capacitySignedMinor : balance.signedBalanceMinor) : null;
  const health = bank ? statementHealth(bank, workspace, snapshot, available) : null;
  const display = statementOutcome(bank, payment, today, available, isStartingPoint(bank, workspace, snapshot, available));
  const charges = bridge ? sumMinor(bridge.rows.filter((row) => row.amountMinor < 0).map((row) => -row.amountMinor)) : null;
  const activityPayments = bridge && snapshot ? sumMinor(bridge.rows.filter((row) => row.amountMinor > 0 && activityKind(row, card, workspace, snapshot) === "payment").map((row) => row.amountMinor)) : null;
  const otherCredits = bridge && snapshot ? sumMinor(bridge.rows.filter((row) => row.amountMinor > 0 && activityKind(row, card, workspace, snapshot) !== "payment").map((row) => row.amountMinor)) : null;
  const pendingRows = bridge?.rows.filter((row) => row.cleared !== true) ?? [];
  const pendingCharges = sumMinor(pendingRows.filter((row) => row.amountMinor < 0).map((row) => -row.amountMinor));
  const pendingCredits = sumMinor(pendingRows.filter((row) => row.amountMinor > 0).map((row) => row.amountMinor));
  // Integer minor units withheld from available credit until the credit-side entries clear.
  const pendingCapacityCredits = tracked?.known ? Math.max(0, sumMinor([tracked.signedMinor, -tracked.capacitySignedMinor])) : 0;
  const obligation = remaining === 0 && minimum ? minimum : remaining;
  const utilization = creditDebt !== undefined && card.creditLimitMinor ? creditDebt / card.creditLimitMinor * 100 : null;
  const minimumOnly = remaining === 0 && minimum !== null && minimum > 0;
  const minimumOverdue = Boolean(bank && known && minimum && bank.dueDate < today);
  return <div className="space-y-4 bg-muted/15 p-5">
    {awaitingStatement && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 text-xs"><p>{bank ? <>Next statement to confirm: {formatCardDate(awaitingStatement.closingDate)}. Payment amounts use your latest confirmed statement.</> : <>Start by confirming your opening statement: {formatCardDate(awaitingStatement.closingDate)}.</>}</p><Button size="xs" variant="outline" onClick={onConfirmDraft}>Confirm statement</Button></div>}
    <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-4">
      <DashboardPanel label="Statement and payment" className="p-3">
        <div className="flex min-h-5 items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">{minimumOnly ? "Minimum to pay" : "To pay"}</h2>
          {health && (health.key === "verified" ? <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><Check className="size-3" aria-hidden />Verified</span> : <Status tone="neutral">{health.label}</Status>)}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{money(obligation)}</p>
          <StatementOutcome outcome={display} compact />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <p className={cn("text-muted-foreground", minimumOverdue && "text-destructive")}>{bank && known ? <>Due {formatCardDate(bank.dueDate)}{display.countdown && (minimumOverdue || bank.dueDate >= today) && ` · ${display.countdown}`}</> : bank ? "Refresh Actual activity to update payments" : available ? "Confirm a statement to track payments" : "Refresh Actual activity"}</p>
          <p><span className="text-muted-foreground">{minimumOnly ? "To pay" : "Minimum to pay"}</span> <span className={cn("font-medium tabular-nums", minimumOverdue && "text-destructive")}>{money(minimumOnly ? remaining : minimum)}</span></p>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <p><span className="text-muted-foreground">Repaid</span> <span className="font-medium tabular-nums">{money(paid)}</span></p>
          <Popover>
            <PopoverTrigger render={<Button size="xs" variant="ghost" className="h-5 px-1 text-xs text-muted-foreground" />}>Payment breakdown<ChevronDown className="size-3" aria-hidden /></PopoverTrigger>
            <PopoverContent aria-label="Payment breakdown" align="start" className="max-h-[80dvh] w-80 max-w-[90vw] overflow-auto p-3 text-xs">
              <h3 className="font-semibold">Payment breakdown</h3>
              <dl className="mt-3 space-y-2">{[
                ["Statement", bank ? formatCardDate(bank.closingDate) : "Not confirmed"],
                ["Statement balance", money(bank?.officialBalanceMinor)],
                ["Total Payment Due", bank ? money(paymentTarget(bank)) : "-"],
                ["Minimum due", money(bank?.minimumDueMinor)],
                ["Repaid", money(paid)], ["Credits", money(known ? credits : null)],
                ["To pay", money(remaining)], ["Minimum to pay", money(minimum)],
                ...(payment?.provisionalMinor ? [["Pending payments", money(payment.provisionalMinor)]] : []),
                ...(pendingStatementCredits ? [["Pending credits", money(pendingStatementCredits)]] : []),
              ].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}</dl>
              <p className="mt-3 border-t pt-2 leading-relaxed text-muted-foreground">Only confirmed payments reduce To pay, increase Repaid and count toward the minimum. The bar shows these payments. Refunds and credits reduce Total owed. If your bank changes the amount due, update Total Payment Due. {bank?.totalPaymentDueMinor == null ? "Total Payment Due defaults to the statement balance." : "Total Payment Due is your entered monthly target."}{card.autoPay !== "unknown" && ` Auto-pay setting: ${card.autoPay}.`}</p>
            </PopoverContent>
          </Popover>
        </div>
        <div className="relative mt-1.5" role="progressbar" aria-label="Payment target coverage" title="Target covered by cleared payments" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent.toFixed(1)}% of target covered by cleared payments; minimum to pay ${money(minimum)}`}>
          <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-chart-2" style={{ width: `${percent}%` }} /></div>
          {marker > 0 && <span className="absolute -top-1 h-3 w-px bg-foreground" style={{ left: `min(calc(100% - 2px), ${marker}%)` }} title={`Minimum payment threshold ${money(bank?.minimumDueMinor)}`} />}
        </div>
        {Boolean(payment?.provisionalMinor) && <p className="mt-1.5 text-xs text-muted-foreground">{money(payment?.provisionalMinor)} payment pending</p>}
      </DashboardPanel>
      <DashboardPanel label="Total owed" className="p-3">
        <h2 className="flex min-h-5 items-center text-xs font-medium text-muted-foreground">Total owed</h2>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{money(currentDebt)}</p>
        <dl className="mt-2 space-y-1.5 text-xs">{tracked?.tracked ? <>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">On card</dt><dd className="tabular-nums">{money(balance ? -balance.signedBalanceMinor : null)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">In plan account</dt><dd className="tabular-nums">{tracked.known ? money(tracked.trackingMinor) : "Unavailable"}</dd></div>
          {tracked.transitMinor !== 0 && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Transfer in transit</dt><dd className="tabular-nums">{money(tracked.transitMinor)}</dd></div>}
        </> : <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Statement balance</dt><dd className="tabular-nums">{money(bank?.officialBalanceMinor)}</dd></div>}</dl>
        {needsPlanBalance && !tracked?.known && <p className="mt-2 text-xs text-muted-foreground">Plan balance unavailable; refresh or check its links.</p>}
        {tracked?.tracked && tracked.known && tracked.confirmedDebtMinor !== tracked.debtMinor && <p className="mt-2 text-xs text-muted-foreground">Before pending activity {money(tracked.confirmedDebtMinor)}</p>}
        <PlanAccountNotice tracking={tracked} showSharedBalance={false} />
      </DashboardPanel>
      <DashboardPanel label="Credit used" className="p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
          <h2 className="flex min-h-5 items-center text-xs font-medium text-muted-foreground">Credit used</h2>
          <dl className="col-start-2 row-span-2 row-start-1 text-right"><dt className="flex min-h-5 items-center justify-end text-xs text-muted-foreground [&>button]:size-5">Available<FieldInfo label="Available credit">Derived from the entered limit and recorded debt. Pending repayments and other pending credits do not release credit. This is not the bank’s live authorization limit.</FieldInfo></dt><dd className="mt-1 text-xl leading-9 font-semibold tabular-nums">{money(facility?.availableMinor)}</dd></dl>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{utilization === null ? "-" : `${utilization.toFixed(1)}%`}</p>
        </div>
        {utilization !== null && <div className="mt-2 [&>div>span]:sr-only"><BalanceProgress compact label={`${card.nickname} credit used`} percent={utilization} /></div>}
        <dl className="mt-2 space-y-1.5 text-xs"><div className="flex justify-between gap-2"><dt className="text-muted-foreground">Limit</dt><dd className="tabular-nums">{money(card.creditLimitMinor)}</dd></div>{balance?.creditMinor ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Card credit</dt><dd className="tabular-nums">{money(balance.creditMinor)}</dd></div> : null}</dl>
        {pendingCapacityCredits > 0 && <p className="mt-2 text-xs text-muted-foreground">{money(pendingCapacityCredits)} pending credits not yet available.</p>}
      </DashboardPanel>
      <DashboardPanel label="Current balance and activity" className="p-3">
        <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <h2 className="inline-flex items-center text-xs font-medium text-muted-foreground [&>button]:size-5">Since last statement<FieldInfo label="Activity basis">Net card activity: charges increase it; payments and other credits reduce it. Plan transfers may move debt between accounts without changing total owed. Reviewed statement decisions are respected; otherwise Actual or saved bank posting dates apply. Scheduled future entries are excluded. Uncleared activity is provisional.</FieldInfo></h2>
          <p className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">{bank ? `${formatCardDate(bank.closingDate)} → today` : "Confirm an opening statement"}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="text-3xl font-semibold tracking-tight tabular-nums" aria-label="Net activity">{money(bridge?.netMinor)}</p>
          {bridge && <Button className="shrink-0" size="xs" variant="outline" aria-label={showActivity ? "Hide contributing transactions" : "View contributing transactions"} aria-expanded={showActivity} aria-controls={panelId} onClick={() => setShowActivity(!showActivity)}>{showActivity ? "Hide activity" : "View activity"}</Button>}
        </div>
        <dl className="mt-2 space-y-1.5 text-xs">
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Charges</dt><dd className="tabular-nums">{money(charges)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Payments</dt><dd className="tabular-nums">{money(activityPayments)}</dd></div>
          {otherCredits !== null && otherCredits > 0 && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Other credits</dt><dd className="tabular-nums">{money(otherCredits)}</dd></div>}
        </dl>
        {bridge && bridge.pendingCount > 0 && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"><p>{bridge.pendingCount} uncleared {bridge.pendingCount === 1 ? "transaction" : "transactions"} included.</p><p>{[pendingCharges > 0 ? `Charges ${money(pendingCharges)}` : null, pendingCredits > 0 ? `Credits ${money(pendingCredits)}` : null].filter(Boolean).join(" · ")}</p></div>}
        {activityNotice && <p className="mt-2 text-xs text-muted-foreground" role="status">{activityNotice}{snapshot?.issues.length ? <FieldInfo label="Incomplete activity details">{[...new Set(snapshot.issues)].map((issue) => <span className="block" key={issue}>{issue}</span>)}</FieldInfo> : null}</p>}
      </DashboardPanel>
    </div>
    {showActivity && bridge && <DashboardPanel label="Contributing activity" className="overflow-hidden"><div id={panelId} className="overflow-auto p-4"><SearchInput size="sm" className="mb-3 max-w-sm" aria-label="Search contributing transactions" placeholder="Search transactions…" value={search} onValueChange={setSearch} /><table className="w-full min-w-[600px] table-fixed text-left text-xs"><caption className="sr-only">Transactions outside the latest statement</caption><thead className="bg-muted/30"><tr>{["Date", "Payee", "Notes", "Amount", "Cleared"].map((label) => <th key={label} className={cn("p-2", label === "Amount" && "text-right")}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t hover:bg-muted/20"><td className="p-2">{formatCardDate(row.date)}</td><td className="p-2"><ReviewText text={row.label} label="contributing payee" /></td><td className="p-2"><ReviewText text={row.notes ?? "-"} label="contributing notes" /></td><td className="p-2 text-right tabular-nums">{money(row.amountMinor)}</td><td className="p-2"><ClearingStatus cleared={row.cleared} available={available} /></td></tr>)}</tbody></table>{!rows.length && <p className="pt-3 text-xs text-muted-foreground">No transactions match your search.</p>}</div></DashboardPanel>}
    <OverviewDetails card={card} workspace={workspace} snapshot={snapshot} statements={statements} statuses={statuses} today={today} available={available} onSettings={onSettings} onStatements={onStatements} onPayments={onPayments} onPayment={onPayment} />
    <PlansSection budget={budget} card={card} workspace={workspace} snapshot={snapshot} available={available} today={today} />
  </div>;
}
