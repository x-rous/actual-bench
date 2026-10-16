"use client";
import { useState } from "react";
import { paymentTarget } from "../lib/paymentTargets";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Workspace } from "../lib/models";
import type { ActivitySnapshot } from "../lib/activity";
import { settlements, latestStatement } from "../lib/repayments";
import { isStartingPoint, statementOutcome } from "../lib/paymentSummary";
import { bankToday } from "../lib/cycles";
import { statementHealth } from "../lib/statementHealth";
import { formatCardDate } from "../lib/displayDates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { statementPaymentTotals } from "../lib/insights";
import { portfolio, observedInterestTotals } from "../lib/history";
import { paymentTotalsDetail, portfolioStatementTrend, portfolioInterestTrend } from "../lib/portfolioView";
import { Status, BalanceProgress } from "./WorkspaceVisuals";
import { netActivitySinceStatement } from "../lib/insights";
import { StatementOutcome } from "./StatementOutcome";
import { CardMark } from "./CardIdentity";
import { HistoryChart } from "./HistoryChart";
import { DashboardStat } from "./DashboardPanels";
import { trackedCardDebt, trackedDebtPoints } from "../lib/planTracking";
import { planDebtBreakdown } from "../lib/planReporting";
import { PlanDebtBreakdown } from "./PlanDebtBreakdown";
import { FieldInfo } from "./FieldInfo";
export function PortfolioOverview({ workspace, balances, sources, trendStatements, onOpen, onReview, sort = "due" }: { workspace: Workspace; balances: Map<string, { signedBalanceMinor: number; debtMinor: number; creditMinor: number }>; sources: (ActivitySnapshot | undefined)[]; trendStatements: Workspace["statements"]; onOpen: (id: string) => void; onReview: (id: string) => void; sort?: "due" | "debt" | "name" }) {
  const [trendView, setTrendView] = useState<"debt" | "statements">("debt");
  const cards = workspace.cards;
  const today = cards.map((card) => bankToday(card.bankTimeZone));
  const debtViews = cards.map((card, index) => {
    const balance = balances.get(card.accountId), source = sources[index];
    return balance && source ? trackedCardDebt(card, workspace, source, balance.signedBalanceMinor, today[index]) : undefined;
  });
  const displayBalances = new Map(cards.flatMap((card, index) => {
    const balance = balances.get(card.accountId), view = debtViews[index];
    const needsPlanBalance = workspace.plans?.some((plan) => plan.cardId === card.id && plan.tracking);
    return !balance || needsPlanBalance && !view?.known ? [] : [[card.accountId, view?.tracked ? { signedBalanceMinor: view.signedMinor, debtMinor: view.debtMinor, creditMinor: Math.max(0, view.signedMinor) } : balance] as const];
  }));
  const totals = portfolio(cards, displayBalances);
  const statementWorkspace = { ...workspace, statements: trendStatements };
  const payments = statementPaymentTotals(cards, statementWorkspace, sources, today);
  const interests = cards.map((card, index) => sources[index] ? observedInterestTotals(card, workspace, sources[index]!, today[index]) : null);
  const interest = interests.reduce((sum, entry) => sum + (entry?.totalMinor ?? 0), 0);
  const limits = cards.filter((card) => card.creditLimitMinor != null && displayBalances.has(card.accountId));
  const totalLimit = limits.reduce((sum, card) => sum + card.creditLimitMinor!, 0);
  const limitedDebt = limits.reduce((sum, card) => sum + (debtViews[cards.indexOf(card)]?.tracked ? debtViews[cards.indexOf(card)]!.creditUsedMinor : displayBalances.get(card.accountId)?.debtMinor ?? 0), 0);
  const utilization = totalLimit > 0 ? limitedDebt / totalLimit * 100 : null;
  const splits = cards.map((card, index) => {
    const source = sources[index], balance = balances.get(card.accountId);
    if (!source || !balance) return null;
    return planDebtBreakdown(card, workspace, source, balance.signedBalanceMinor + (source.futureDeltaMinor ?? 0), today[index]);
  });
  const hasPlans = workspace.plans?.length;
  const records = cards.map((card, index) => { const bank = latestStatement(workspace.statements.filter((entry) => entry.bankConfirmed), card.id); const due = sources[index] && bank ? settlements(card, statementWorkspace, sources[index]!, today[index]).find((entry) => entry.statementId === bank.id) : undefined; const remaining = bank && due?.fullRemainingMinor != null ? Math.max(0, paymentTarget(bank) - due.confirmedPaidMinor - (due.confirmedCreditMinor ?? due.confirmedCashbackMinor ?? 0)) : null; const minimum = bank && due?.minimumRemainingMinor != null ? Math.max(0, bank.minimumDueMinor - due.confirmedPaidMinor) : null; const overdue = Boolean(bank && bank.dueDate < today[index] && minimum !== null && minimum > 0); const issues = workspace.statements.filter((entry) => entry.cardId === card.id && statementHealth(entry, workspace, sources[index], Boolean(sources[index])).issue); return { card, bank, due, remaining, minimum, overdue, issues, balance: displayBalances.get(card.accountId), today: today[index] }; }).sort((a, b) => sort === "name" ? a.card.nickname.localeCompare(b.card.nickname) : sort === "debt" ? (b.balance?.debtMinor ?? -1) - (a.balance?.debtMinor ?? -1) : (a.bank && ((a.remaining ?? 0) > 0 || (a.minimum ?? 0) > 0) ? a.bank.dueDate : "9999").localeCompare(b.bank && ((b.remaining ?? 0) > 0 || (b.minimum ?? 0) > 0) ? b.bank.dueDate : "9999") || a.card.nickname.localeCompare(b.card.nickname));
  const review = records.filter((entry) => entry.issues.length);
  const trend = portfolioStatementTrend(cards, trendStatements);
  const hasTracking = workspace.plans?.some((plan) => plan.tracking);
  const debtDates = [...new Set([...trendStatements.map((entry) => entry.closingDate), ...today])].sort();
  const combinedTrend = debtDates.map((date) => {
    const points = cards.map((card, index) => sources[index] && balances.get(card.accountId) ? trackedDebtPoints(card, workspace, sources[index]!, balances.get(card.accountId)!.signedBalanceMinor, [date])[0] : null);
    return { date, value: points.every((point) => point?.value != null) ? points.reduce((total, point) => total + point!.value!, 0) : null };
  });
  const interestTrend = portfolioInterestTrend(cards, workspace, sources, today);
  const showInterest = interestTrend.some((point) => point.value !== null && point.value !== 0);
  const money = (amount: number | null | undefined) => amount == null ? "-" : formatAmount(amount, 2);
  const classified = interests.filter((entry) => entry?.classificationKnown).length;
  const interestKnown = classified === cards.length;
  const interestFrom = interests.filter(Boolean).map((entry) => entry!.from).sort()[0];
  const interestTo = interests.filter(Boolean).map((entry) => entry!.to).sort().at(-1);
  return <div className="space-y-4 bg-muted/15 p-5">
    <dl className="grid grid-cols-4 gap-4" aria-label="Portfolio summary">
      <DashboardStat label="Total debt" value={money(totals.balanceCoverage ? totals.debtMinor : null)} detail={<>{totals.balanceCoverage < cards.length ? `${totals.balanceCoverage} of ${cards.length} balances available` : hasTracking ? "Cards + assigned plan accounts" : "Across registered cards"}{Boolean(hasPlans) && <span className="mt-1 block">{debtViews.some((entry) => entry?.tracked && entry.known) ? `${money(debtViews.reduce((sum, entry) => sum + (entry?.tracked && entry.known ? entry.trackingMinor : 0), 0))} in assigned plan accounts` : "Plan balance unavailable"}{debtViews.some((entry) => entry?.problems.length) && <span className="mt-1 block">Check plan entries · partial coverage</span>}</span>}</>} />
      <DashboardStat label="Remaining to pay" value={money(payments.coverage ? payments.remainingMinor : null)} detail={payments.coverage < cards.length ? `${payments.coverage} of ${cards.length} statements available` : "After confirmed payments and credits"} />
      <DashboardStat label={payments.overdueMinimumMinor > 0 ? "Overdue minimum" : "Minimum remaining"} value={money(payments.coverage ? payments.overdueMinimumMinor || payments.minimumMinor : null)} detail={payments.overdueMinimumMinor > 0 ? "Requires attention" : "Confirmed payments only"} className={payments.overdueMinimumMinor > 0 ? "border-destructive/25 bg-destructive/5" : undefined} />
      <DashboardStat label="Interest charged" value={money(interestKnown || interest > 0 ? interest : null)} detail={interestFrom && interestTo ? `${formatCardDate(interestFrom)} – ${formatCardDate(interestTo)}${interestKnown ? "" : " · partial evidence"}` : "Refresh activity to load history"} />
    </dl>
    <section aria-label="Registered credit cards" className="overflow-x-auto rounded-xl border bg-background"><table className="w-full min-w-[1140px] table-fixed text-left text-xs"><caption className="sr-only">Registered credit cards</caption><colgroup>{["24%", "15%", "19%", "14%", "16%", "12%"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup><thead className="border-b bg-muted/10 text-xs text-muted-foreground"><tr>{["Card", "Remaining to pay", "Payment status", "Net activity", "Credit used", "Total debt"].map((label) => <th key={label} className={`px-4 py-2 font-medium ${["Remaining to pay", "Total debt"].includes(label) ? "text-right" : ""}`}>{label}</th>)}</tr></thead><tbody>{records.map(({ card, bank, due, remaining, minimum, balance, today }) => {
      const index = cards.findIndex((entry) => entry.id === card.id), source = sources[index];
      const creditUsed = debtViews[index]?.tracked ? debtViews[index]!.creditUsedMinor : balance?.debtMinor;
      const display = statementOutcome(bank, due, today, Boolean(source), isStartingPoint(bank, workspace, source, Boolean(source)));
      const bridge = bank && source && balance ? netActivitySinceStatement(card, bank, workspace, source, balances.get(card.accountId)!.signedBalanceMinor + (source.futureDeltaMinor ?? 0), today) : null;
      return <tr key={card.id} className="border-b last:border-b-0 hover:bg-muted/25"><td className="px-4 py-3"><div className="flex min-w-0 items-center gap-2"><CardMark card={card} /><div className="min-w-0"><Button variant="link" className="h-auto max-w-full justify-start p-0 text-sm font-semibold" title={card.nickname} onClick={() => onOpen(card.id)}><span className="truncate">{card.nickname}</span></Button><p className="mt-1 truncate text-xs text-muted-foreground">{card.purchaseAprBps == null ? "APR not set" : `${card.purchaseAprBps / 100}% APR`}{card.closingDay ? ` · closes day ${card.closingDay}` : ""}</p>{workspace.plans?.some((plan) => plan.cardId === card.id) && splits[index] && <PlanDebtBreakdown compact breakdown={splits[index]!} />}{card.status !== "active" && <Status>Inactive</Status>}</div></div></td>
      <td className="px-4 py-3 text-right"><p className="font-semibold tabular-nums">{money(remaining)}</p><p className="mt-1 text-xs text-muted-foreground">{remaining === 0 && minimum === 0 ? "Settled" : <>{bank ? `Due ${formatCardDate(bank.dueDate)}` : "Confirm statement"}{minimum === null ? "" : minimum === 0 ? " · minimum covered" : ` · min ${money(minimum)}`}</>}</p></td>
      <td className="px-4 py-3"><StatementOutcome outcome={display} />{display.countdown && <p className="mt-1 text-xs text-muted-foreground">{display.carried && !display.overdue ? display.countdown.replace("overdue", "past full-payment due date") : display.countdown}</p>}{due?.provisionalMinor ? <p className="mt-1 text-xs text-muted-foreground">{money(due.provisionalMinor)} pending</p> : null}{balance?.creditMinor ? <p className="mt-1 text-xs">Card credit {money(balance.creditMinor)}</p> : null}</td>
      <td className="px-4 py-3"><p className="tabular-nums">{money(bridge?.netMinor)}</p><p className="mt-1 text-xs text-muted-foreground">{bank ? `Outside ${formatCardDate(bank.closingDate)}` : "Confirm opening statement"}</p></td>
      <td className="px-4 py-3">{balance && card.creditLimitMinor ? <><BalanceProgress compact label={`${card.nickname} credit used`} percent={(creditUsed ?? 0) / card.creditLimitMinor * 100} /><p className="mt-1 text-xs text-muted-foreground">{money(card.creditLimitMinor)} limit · {money(Math.max(0, card.creditLimitMinor - (creditUsed ?? 0) + balance.creditMinor))} estimated available</p></> : <span className="text-xs text-muted-foreground">{balance ? "Credit limit not set" : "Refresh needed"}</span>}</td>
      <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1"><p className="font-semibold tabular-nums">{money(balance?.debtMinor)}</p><Button size="icon-xs" variant="ghost" aria-label={`Open ${card.nickname}`} onClick={() => onOpen(card.id)}><ChevronRight className="size-3.5" /></Button></div></td></tr>;
    })}</tbody></table></section>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <span>{cards.length} {cards.length === 1 ? "card" : "cards"}</span>
        <span>{utilization == null ? "Credit limits unavailable" : `${utilization.toFixed(1)}% of ${money(totalLimit)} credit used`}</span>
        {totals.creditMinor > 0 && <span>Card credit {money(totals.creditMinor)}</span>}
        {limits.length < cards.length && <span>{limits.length} of {cards.length} limits available</span>}
        {!interestKnown && <span>{classified} of {cards.length} cards classified</span>}
        <span className="flex items-center">Data coverage<FieldInfo label="Portfolio data coverage">{totals.balanceCoverage} of {cards.length} balances available. {limits.length} of {cards.length} credit limits available. {classified} of {cards.length} cards have known interest classification. {paymentTotalsDetail(payments)} Totals include available evidence only. Net activity respects statement membership decisions, including transactions excluded at the closing boundary; it can include provisional uncleared entries.</FieldInfo></span>
      </div>
      {review.length > 0 && <Button size="xs" variant="outline" onClick={() => onReview(review[0].card.id)}>{review.reduce((sum, entry) => sum + entry.issues.length, 0)} statements need review</Button>}
    </div>
    <div className={`grid gap-4 ${showInterest ? "lg:grid-cols-2" : ""}`}><div className="space-y-2"><div className="flex justify-end gap-1" role="group" aria-label="Debt chart view">{(["debt", "statements"] as const).map((view) => <Button key={view} size="xs" variant={trendView === view ? "outline" : "ghost"} aria-pressed={trendView === view} onClick={() => setTrendView(view)}>{view === "debt" ? "Total debt" : "Statement balances"}</Button>)}</div><HistoryChart title={trendView === "debt" ? "Total debt over time" : "Statement balances"} points={trendView === "debt" ? combinedTrend : trend} monthly kind="line" /></div>{showInterest && <HistoryChart title="Interest charged by month" points={interestTrend} monthly allowSingle tone="interest" kind="bar" observationLabel="Identified Actual charges; partial coverage is disclosed in tooltips." />}</div>
  </div>;
}

export function PortfolioSort({ value, onChange }: { value: "due" | "debt" | "name"; onChange: (value: "due" | "debt" | "name") => void }) {
  return <div className="inline-flex self-center rounded-md border bg-muted/20 p-0.5" role="group" aria-label="Sort cards">{([["due", "Next due first"], ["debt", "Largest debt"], ["name", "Name"]] as const).map(([key, label]) => <Button key={key} size="xs" variant={value === key ? "outline" : "ghost"} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</Button>)}</div>;
}
