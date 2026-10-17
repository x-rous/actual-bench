"use client";
import { addDays } from "@/lib/financial-models/calendar/dates";
import { sumMinor } from "../lib/statements";
import { useState } from "react";
import { confirmedPaymentProgress } from "../lib/paymentTargets";
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
import { PlanAccountNotice } from "./PlanAccountNotice";
import { ReviewText } from "./ReviewText";
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
  const limitedDebt = limits.reduce((sum, card) => sum + (debtViews[cards.indexOf(card)]?.known ? debtViews[cards.indexOf(card)]!.creditUsedMinor : displayBalances.get(card.accountId)?.debtMinor ?? 0), 0);
  const utilization = totalLimit > 0 ? limitedDebt / totalLimit * 100 : null;
  const records = cards.map((card, index) => { const bank = latestStatement(workspace.statements.filter((entry) => entry.bankConfirmed), card.id); const due = sources[index] && bank ? settlements(card, statementWorkspace, sources[index]!, today[index]).find((entry) => entry.statementId === bank.id) : undefined; const progress = bank ? confirmedPaymentProgress(bank, due) : null; const remaining = progress?.toPayMinor ?? null; const minimum = progress?.minimumToPayMinor ?? null; const overdue = Boolean(bank && bank.dueDate < today[index] && minimum !== null && minimum > 0); const issues = workspace.statements.filter((entry) => entry.cardId === card.id && statementHealth(entry, workspace, sources[index], Boolean(sources[index])).issue); return { card, bank, due, remaining, minimum, overdue, issues, balance: displayBalances.get(card.accountId), today: today[index] }; }).sort((a, b) => sort === "name" ? a.card.nickname.localeCompare(b.card.nickname) : sort === "debt" ? (b.balance?.debtMinor ?? -1) - (a.balance?.debtMinor ?? -1) : (a.bank && ((a.remaining ?? 0) > 0 || (a.minimum ?? 0) > 0) ? a.bank.dueDate : "9999").localeCompare(b.bank && ((b.remaining ?? 0) > 0 || (b.minimum ?? 0) > 0) ? b.bank.dueDate : "9999") || a.card.nickname.localeCompare(b.card.nickname));
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
  // Every total is integer minor units; missing card evidence stays out of coverage.
  const dueSoon = records.filter((entry) => entry.bank && entry.remaining !== null && entry.bank.dueDate >= entry.today && entry.bank.dueDate <= addDays(entry.today, 7));
  const dueSoonMinor = sumMinor(dueSoon.map((entry) => entry.remaining!));
  const overdueTargetsMinor = sumMinor(records.filter((entry) => entry.bank && entry.remaining !== null && entry.bank.dueDate < entry.today).map((entry) => entry.remaining!));
  const availableCreditMinor = sumMinor(limits.map((card) => {
    const index = cards.indexOf(card), balance = displayBalances.get(card.accountId)!;
    return Math.max(0, card.creditLimitMinor! + (debtViews[index]?.known ? debtViews[index]!.capacitySignedMinor : balance.signedBalanceMinor));
  }));
  const paymentCoverage = payments.coverage < cards.length ? ` · ${payments.coverage} of ${cards.length} statements available` : "";
  return <div className="space-y-4 bg-muted/15 p-5">
    <dl className="grid grid-cols-6 gap-2 [&>div]:px-3 [&>div]:py-3 [&>div>dd:nth-child(2)]:text-xl [&>div>dd:nth-child(2)]:whitespace-nowrap" aria-label="Portfolio summary">
      <DashboardStat label="Total owed" value={money(totals.balanceCoverage ? totals.debtMinor : null)} detail={<>{hasTracking ? debtViews.some((entry) => entry?.tracked && entry.known) ? `Includes ${money(debtViews.reduce((sum, entry) => sum + (entry?.tracked && entry.known ? entry.trackingMinor : 0), 0))} in plan accounts` : "Plan balance unavailable" : "Across registered cards"}{totals.balanceCoverage < cards.length && <span className="mt-1 block">{totals.balanceCoverage} of {cards.length} balances available</span>}<PlanAccountNotice tracking={debtViews.find((entry) => entry && (!entry.known || entry.problems.length)) ?? debtViews.find((entry) => entry?.sharedAccounts.some((account) => account.unlinkedCurrentCount || account.differenceMinor < 0)) ?? debtViews.find((entry) => entry?.sharedAccounts.length)} /></>} />
      <DashboardStat label="To pay" value={money(payments.coverage ? payments.remainingMinor : null)} detail={payments.coverage < cards.length ? `${payments.coverage} of ${cards.length} statements available` : "After confirmed payments"} />
      <DashboardStat label={payments.overdueMinimumMinor > 0 ? "Overdue minimum" : "Minimum to pay"} value={money(payments.coverage ? payments.overdueMinimumMinor || payments.minimumMinor : null)} detail={payments.overdueMinimumMinor > 0 ? "Requires attention" : "Confirmed payments only"} className={payments.overdueMinimumMinor > 0 ? "border-destructive/25 bg-destructive/5" : undefined} />
      <DashboardStat label="Interest charged" value={money(interestKnown || interest > 0 ? interest : null)} detail={interestFrom && interestTo ? `${formatCardDate(interestFrom)} – ${formatCardDate(interestTo)}${interestKnown ? "" : " · partial evidence"}` : "Refresh activity to load history"} />
      <DashboardStat label="Due in the next 7 days" value={money(payments.coverage ? dueSoonMinor : null)} detail={<><span className="block">Overdue {money(payments.coverage ? overdueTargetsMinor : null)}{paymentCoverage}</span><span className="inline-flex items-center">Remaining monthly targets<FieldInfo label="Payments due soon">Latest confirmed monthly target per card, less confirmed payments, due today or within the next seven days. Earlier deadlines appear separately as overdue; pending repayments do not reduce these amounts.</FieldInfo></span></>} />
      <DashboardStat label="Available credit" value={money(limits.length ? availableCreditMinor : null)} detail={<span className="inline-flex items-center">{limits.length} of {cards.length} cards with known limits<FieldInfo label="Portfolio available credit">Estimated from entered limits and recorded debt, including assigned plan balances. Pending repayments do not release credit. Cards with missing balances or limits are excluded; this is not a live bank authorization figure.</FieldInfo></span>} />

    </dl>
    <section aria-label="Registered credit cards" className="overflow-x-auto rounded-lg border bg-background"><table className="w-full min-w-[1000px] table-fixed text-left text-xs"><caption className="sr-only">Registered credit cards</caption><colgroup>{["24%", "14%", "17%", "10%", "21%", "14%"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup><thead className="border-b bg-muted/10 text-xs text-muted-foreground"><tr>{["Card", "To pay", "Payment status", "Net activity", "Credit used", "Total owed"].map((label) => <th key={label} className={`px-3 py-2 font-medium ${label === "To pay" ? "text-right" : ""}`}>{label}</th>)}</tr></thead><tbody>{records.map(({ card, bank, due, remaining, minimum, balance, today }) => {
      const index = cards.findIndex((entry) => entry.id === card.id), source = sources[index], view = debtViews[index];
      const creditUsed = view?.known ? view.creditUsedMinor : balance?.debtMinor;
      const display = statementOutcome(bank, due, today, Boolean(source), isStartingPoint(bank, workspace, source, Boolean(source)));
      const bridge = bank && source && balance ? netActivitySinceStatement(card, bank, workspace, source, balances.get(card.accountId)!.signedBalanceMinor + (source.futureDeltaMinor ?? 0), today) : null;
      const shortDate = (date: string) => formatCardDate(date).slice(0, date.slice(0, 4) === today.slice(0, 4) ? 6 : undefined);
      const paymentNote = [display.countdown, due?.provisionalMinor ? `${money(due.provisionalMinor)} pending` : ""].filter(Boolean).join(" · ");
      const dueNote = remaining === 0 && minimum === 0 ? "Settled" : `${bank ? `Due ${shortDate(bank.dueDate)}` : "Confirm statement"}${minimum === null ? "" : minimum === 0 ? " · minimum covered" : ` · min ${money(minimum)}`}`;
      const debtNote = [view?.tracked ? view.known ? `Plan account ${money(view.trackingMinor)}` : "Plan balance unavailable" : "", balance?.creditMinor ? `Credit ${money(balance.creditMinor)}` : ""].filter(Boolean).join(" · ");
      const availableCredit = balance && card.creditLimitMinor ? Math.max(0, card.creditLimitMinor + (view?.known ? view.capacitySignedMinor : balance.signedBalanceMinor)) : null;
      return <tr key={card.id} className="border-b last:border-b-0 hover:bg-muted/25 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle">
        <td><div className="flex min-w-0 items-center gap-2"><CardMark card={card} /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1"><Button variant="link" className="h-auto min-w-0 max-w-full justify-start p-0 text-xs font-semibold" title={card.nickname} onClick={() => onOpen(card.id)}><span className="truncate">{card.nickname}</span></Button>{card.status !== "active" && <Status>Inactive</Status>}</div><ReviewText className="mt-1 text-muted-foreground" text={`${card.purchaseAprBps == null ? "APR not set" : `${card.purchaseAprBps / 100}% APR`}${card.closingDay ? ` · closes day ${card.closingDay}` : ""}`} label={`card terms for ${card.nickname}`} /></div></div></td>
        <td className="text-right"><p className="font-semibold tabular-nums">{money(remaining)}</p><ReviewText className="mt-1 text-right text-muted-foreground" text={dueNote} detail={`${dueNote}${bank ? ` · full deadline ${formatCardDate(bank.dueDate)}` : ""}`} label={`payment target for ${card.nickname}`} /></td>
        <td><StatementOutcome outcome={display} compact />{paymentNote && <ReviewText className="mt-1 text-muted-foreground" text={paymentNote} label={`payment progress for ${card.nickname}`} />}</td>
        <td><p className="tabular-nums">{money(bridge?.netMinor)}</p><p className="mt-1 truncate text-muted-foreground" title={bank ? formatCardDate(bank.closingDate) : undefined}>{bank ? `Since ${shortDate(bank.closingDate)}` : "Confirm opening"}</p></td>
        <td>{balance && card.creditLimitMinor ? <><BalanceProgress compact label={`${card.nickname} credit used`} percent={(creditUsed ?? 0) / card.creditLimitMinor * 100} /><p className="mt-1 flex justify-between gap-1 whitespace-nowrap text-[11px] text-muted-foreground tabular-nums"><span>Limit {money(card.creditLimitMinor)}</span><span>Available {money(availableCredit)}</span></p></> : <span className="text-muted-foreground">{balance ? "Credit limit not set" : "Refresh needed"}</span>}</td>
        <td><div className="flex items-center gap-3 pr-3"><p className="min-w-0 font-semibold tabular-nums">{money(balance?.debtMinor)}</p><Button size="icon-xs" variant="ghost" aria-label={`Open ${card.nickname}`} onClick={() => onOpen(card.id)}><ChevronRight className="size-3.5" /></Button></div>{debtNote && <ReviewText className="mt-1 text-muted-foreground" text={debtNote} label={`debt breakdown for ${card.nickname}`} />}</td>
      </tr>;
    })}</tbody></table></section>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <span>{cards.length} {cards.length === 1 ? "card" : "cards"}</span>
        <span>{utilization == null ? "Credit limits unavailable" : `${utilization.toFixed(1)}% of ${money(totalLimit)} credit used`}</span>
        {totals.creditMinor > 0 && <span>Card credit {money(totals.creditMinor)}</span>}
        {limits.length < cards.length && <span>{limits.length} of {cards.length} limits available</span>}
        {!interestKnown && <span>{classified} of {cards.length} cards classified</span>}
        <span className="flex items-center"><FieldInfo label="Portfolio data coverage">{totals.balanceCoverage} of {cards.length} balances available. {limits.length} of {cards.length} credit limits available. {classified} of {cards.length} cards have known interest classification. {paymentTotalsDetail(payments)} Totals include available evidence only. Net activity respects statement membership decisions, including transactions excluded at the closing boundary; it can include provisional uncleared entries.</FieldInfo></span>
      </div>
      {review.length > 0 && <Button size="xs" variant="outline" onClick={() => onReview(review[0].card.id)}>{review.reduce((sum, entry) => sum + entry.issues.length, 0)} statements need review</Button>}
    </div>
    <div className={`grid gap-4 ${showInterest ? "lg:grid-cols-2" : ""}`}><div className="space-y-2"><div className="flex justify-end gap-1" role="group" aria-label="Debt chart view">{(["debt", "statements"] as const).map((view) => <Button key={view} size="xs" variant={trendView === view ? "outline" : "ghost"} aria-pressed={trendView === view} onClick={() => setTrendView(view)}>{view === "debt" ? "Total owed" : "Statement balances"}</Button>)}</div><HistoryChart title={trendView === "debt" ? "Total owed over time" : "Statement balances"} points={trendView === "debt" ? combinedTrend : trend} monthly kind="line" /></div>{showInterest && <HistoryChart title="Interest charged by month" points={interestTrend} monthly allowSingle tone="interest" kind="bar" />}</div>
  </div>;
}

export function PortfolioSort({ value, onChange }: { value: "due" | "debt" | "name"; onChange: (value: "due" | "debt" | "name") => void }) {
  return <div className="inline-flex self-center rounded-md border bg-muted/20 p-0.5" role="group" aria-label="Sort cards">{([["due", "Next due first"], ["debt", "Largest debt"], ["name", "Name"]] as const).map(([key, label]) => <Button key={key} size="xs" variant={value === key ? "outline" : "ghost"} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</Button>)}</div>;
}
