"use client";
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
export function PortfolioOverview({ workspace, balances, sources, trendStatements, onOpen, onReview, sort = "due" }: { workspace: Workspace; balances: Map<string, { signedBalanceMinor: number; debtMinor: number; creditMinor: number }>; sources: (ActivitySnapshot | undefined)[]; trendStatements: Workspace["statements"]; onOpen: (id: string) => void; onReview: (id: string) => void; sort?: "due" | "debt" | "name" }) {
  const cards = workspace.cards;
  const totals = portfolio(cards, balances);
  const today = cards.map((card) => bankToday(card.bankTimeZone));
  const statementWorkspace = { ...workspace, statements: trendStatements };
  const payments = statementPaymentTotals(cards, statementWorkspace, sources, today);
  const interests = cards.map((card, index) => sources[index] ? observedInterestTotals(card, workspace, sources[index]!, today[index]) : null);
  const interest = interests.reduce((sum, entry) => sum + (entry?.totalMinor ?? 0), 0);
  const limits = cards.filter((card) => card.creditLimitMinor != null && balances.has(card.accountId));
  const totalLimit = limits.reduce((sum, card) => sum + card.creditLimitMinor!, 0);
  const limitedDebt = limits.reduce((sum, card) => sum + balances.get(card.accountId)!.debtMinor, 0);
  const utilization = totalLimit > 0 ? limitedDebt / totalLimit * 100 : null;
  const records = cards.map((card, index) => { const bank = latestStatement(workspace.statements.filter((entry) => entry.bankConfirmed), card.id); const due = sources[index] && bank ? settlements(card, statementWorkspace, sources[index]!, today[index]).find((entry) => entry.statementId === bank.id) : undefined; const remaining = bank && due?.fullRemainingMinor != null ? Math.max(0, bank.officialBalanceMinor - due.confirmedPaidMinor - (due.confirmedCreditMinor ?? due.confirmedCashbackMinor ?? 0)) : null; const minimum = bank && due?.minimumRemainingMinor != null ? Math.max(0, bank.minimumDueMinor - due.confirmedPaidMinor) : null; const overdue = Boolean(bank && bank.dueDate < today[index] && minimum !== null && minimum > 0); const issues = workspace.statements.filter((entry) => entry.cardId === card.id && statementHealth(entry, workspace, sources[index], Boolean(sources[index])).issue); return { card, bank, due, remaining, minimum, overdue, issues, balance: balances.get(card.accountId), today: today[index] }; }).sort((a, b) => sort === "name" ? a.card.nickname.localeCompare(b.card.nickname) : sort === "debt" ? (b.balance?.debtMinor ?? -1) - (a.balance?.debtMinor ?? -1) : (a.bank && ((a.remaining ?? 0) > 0 || (a.minimum ?? 0) > 0) ? a.bank.dueDate : "9999").localeCompare(b.bank && ((b.remaining ?? 0) > 0 || (b.minimum ?? 0) > 0) ? b.bank.dueDate : "9999") || a.card.nickname.localeCompare(b.card.nickname));
  const review = records.filter((entry) => entry.issues.length);
  const trend = portfolioStatementTrend(cards, trendStatements);
  const interestTrend = portfolioInterestTrend(cards, workspace, sources, today);
  const showInterest = interestTrend.some((point) => point.value !== null && point.value > 0);
  const money = (amount: number | null | undefined) => amount == null ? "-" : formatAmount(amount, 2);
  return <div className="space-y-0">
    <section aria-label="Registered credit cards" className="overflow-x-auto"><table className="w-full min-w-[1020px] table-fixed text-left text-sm"><caption className="sr-only">Registered credit cards</caption><colgroup>{["24%", "16%", "20%", "15%", "15%", "10%"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup><thead className="border-b bg-muted/10 text-xs text-muted-foreground"><tr>{["Card", "To pay", "Status", "Activity", "Credit used", "Owed now"].map((label) => <th key={label} className={`px-4 py-2 font-medium ${["To pay", "Owed now"].includes(label) ? "text-right" : ""}`}>{label}</th>)}</tr></thead><tbody>{records.map(({ card, bank, due, remaining, minimum, balance, today }) => {
      const index = cards.findIndex((entry) => entry.id === card.id), source = sources[index];
      const display = statementOutcome(bank, due, today, Boolean(source), isStartingPoint(bank, workspace, source, Boolean(source)));
      const bridge = bank && source && balance ? netActivitySinceStatement(card, bank, workspace, source, balance.signedBalanceMinor + (source.futureDeltaMinor ?? 0), today) : null;
      return <tr key={card.id} className="border-b hover:bg-muted/20"><td className="px-4 py-2"><div className="flex min-w-0 items-center gap-2"><CardMark card={card} /><div className="min-w-0"><Button variant="link" className="h-auto max-w-full justify-start p-0 text-sm font-semibold" title={card.nickname} onClick={() => onOpen(card.id)}><span className="truncate">{card.nickname}</span></Button><p className="mt-1 truncate text-xs text-muted-foreground">{card.purchaseAprBps == null ? "APR not set" : `${card.purchaseAprBps / 100}% APR`}{card.closingDay ? ` · closes day ${card.closingDay}` : ""}</p>{card.status !== "active" && <Status>Inactive</Status>}</div></div></td>
      <td className="px-4 py-2 text-right"><p className="font-semibold tabular-nums">{money(remaining)}</p><p className="mt-1 text-xs text-muted-foreground">{bank ? `Due ${formatCardDate(bank.dueDate)}` : "Confirm statement"}{minimum === null ? "" : ` · min ${money(minimum)}`}</p></td>
      <td className="px-4 py-2"><StatementOutcome outcome={display} />{display.countdown && <p className="mt-1 text-xs text-muted-foreground">{display.carried && !display.overdue ? display.countdown.replace("overdue", "past full-payment due date") : display.countdown}</p>}{due?.provisionalMinor ? <p className="mt-1 text-xs text-muted-foreground">{money(due.provisionalMinor)} pending</p> : null}{balance?.creditMinor ? <p className="mt-1 text-xs">Card credit {money(balance.creditMinor)}</p> : null}</td>
      <td className="px-4 py-2"><p className="tabular-nums">{money(bridge?.netMinor)}</p><p className="mt-1 text-xs text-muted-foreground">{bank ? `Net activity since ${formatCardDate(bank.closingDate)}` : "Confirm opening statement"}</p></td>
      <td className="px-4 py-2">{balance && card.creditLimitMinor ? <><BalanceProgress compact label={`${card.nickname} credit used`} percent={balance.debtMinor / card.creditLimitMinor * 100} /><p className="mt-1 text-xs text-muted-foreground">{money(card.creditLimitMinor)} limit · {money(Math.max(0, card.creditLimitMinor - balance.debtMinor + balance.creditMinor))} available</p></> : <span className="text-xs text-muted-foreground">{balance ? "Credit limit not set" : "Refresh needed"}</span>}</td>
      <td className="px-4 py-2 text-right"><div className="flex items-center justify-end gap-1"><p className="font-semibold tabular-nums">{money(balance?.debtMinor)}</p><Button size="icon-xs" variant="ghost" aria-label={`Open ${card.nickname}`} onClick={() => onOpen(card.id)}><ChevronRight className="size-3.5" /></Button></div></td></tr>;
    })}</tbody><tfoot className="border-b bg-muted/20"><tr><th scope="row" className="px-4 py-2 text-left text-xs font-medium">{cards.length} {cards.length === 1 ? "card" : "cards"}</th><td className="px-4 py-2 text-right font-semibold tabular-nums">{money(payments.coverage ? payments.remainingMinor : null)}</td><td colSpan={2} className="px-4 py-2 text-xs text-muted-foreground">{paymentTotalsDetail(payments)}</td><td className="px-4 py-2 text-xs text-muted-foreground">{utilization == null ? "-" : `${utilization.toFixed(1)}%`} of {money(totalLimit || null)}<br />{limits.length} of {cards.length} limits available</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{money(totals.balanceCoverage ? totals.debtMinor : null)}</td></tr></tfoot></table></section>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs"><div className="space-y-1"><p>Interest charged <strong className="tabular-nums">{money(interests.some((entry) => entry?.classificationKnown || (entry?.totalMinor ?? 0) > 0) ? interest : null)}</strong>{interests.some(Boolean) && <span className="text-muted-foreground"> · {formatCardDate(interests.filter(Boolean).map((entry) => entry!.from).sort()[0])} – {formatCardDate(interests.filter(Boolean).map((entry) => entry!.to).sort().at(-1)!)}</span>}</p><p className="text-muted-foreground">{totals.balanceCoverage} of {cards.length} balances available · card credit {money(totals.creditMinor)} · {interests.filter((entry) => entry?.classificationKnown).length} of {cards.length} cards classified</p></div>{review.length > 0 && <Button size="xs" variant="link" onClick={() => onReview(review[0].card.id)}>{review.reduce((sum, entry) => sum + entry.issues.length, 0)} statements need review</Button>}</div>
    <div className={`grid gap-4 p-4 ${showInterest ? "lg:grid-cols-2" : ""}`}><HistoryChart title="Total statement debt" points={trend} monthly kind="line" />{showInterest && <HistoryChart title="Interest charged by month" points={interestTrend} monthly allowSingle tone="interest" kind="bar" observationLabel="Identified Actual charges; partial coverage is disclosed in tooltips." />}</div>
  </div>;
}

export function PortfolioSort({ value, onChange }: { value: "due" | "debt" | "name"; onChange: (value: "due" | "debt" | "name") => void }) {
  return <div className="inline-flex self-center rounded-md border bg-muted/20 p-0.5" role="group" aria-label="Sort cards">{([["due", "Next due first"], ["debt", "Largest debt"], ["name", "Name"]] as const).map(([key, label]) => <Button key={key} size="xs" variant={value === key ? "outline" : "ghost"} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</Button>)}</div>;
}
