"use client";
import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { addDays, daysBetween } from "@/lib/financial-models/calendar/dates";
import type { Card, Workspace } from "../../lib/models";
import { familyOf } from "../../lib/derive/families";
import { activityKind } from "../../lib/derive/types";
import { calculateCardDebt, cardModel, projectCardMinimums } from "../../lib/financialAdapter";
import { cumulativeInterestCharges, observedChargeTotals, observedInterestTotals, statementHistory } from "../../lib/history";
import { carriedDebtPoints } from "../../lib/insights";
import { formatCardDate } from "../../lib/displayDates";
import { formatPercentBps } from "../../lib/percent";
import { sumMinor } from "../../lib/statements";
import { HistoryChart } from "../HistoryChart";
import type { CardEntry } from "../cardEntry";
import { MISSING, money, plural } from "../primitives/format";

type Props = {
  entry: CardEntry;
  workspace: Workspace;
  onStatement: (id: string) => void;
  onSettings: () => void;
};

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="min-w-0 rounded-lg border bg-background px-4 py-3">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    {detail && <dd className="mt-0.5 text-xs text-muted-foreground">{detail}</dd>}
  </div>;
}

const costDetail = (total: { suggestedCount: number; grossMinor: number; refundsMinor: number }) => (total.suggestedCount
  ? `${plural(total.suggestedCount, "suggestion")} not counted`
  : `charged ${money(total.grossMinor)} · refunded ${money(total.refundsMinor)}`);

function MinimumIllustration({ card, today, debtMinor, activePlans }: { card: Card; today: string; debtMinor: number; activePlans: boolean }) {
  const projection = useMemo(() => (activePlans ? null : projectCardMinimums(card, today, debtMinor)), [card, today, debtMinor, activePlans]);
  const modelled = !activePlans && card.interestModel !== "off" && card.purchaseAprBps !== null;
  const illustration = modelled ? calculateCardDebt({
    model: cardModel(card, today, debtMinor),
    anchor: { date: today, principalMinor: debtMinor, accruedInterestMinor: 0, source: "current-actual-balance" },
    events: [],
    to: addDays(today, 30),
  }) : null;
  const thirtyDays = illustration?.ok
    ? sumMinor([illustration.closing.accruedInterestMinor, ...illustration.events.map((event) => event.interestMinor)])
    : null;
  const apr = card.purchaseAprBps !== null ? ` at ${formatPercentBps(card.purchaseAprBps)}% APR` : "";
  return <section aria-label="If you only pay the minimum" className="rounded-lg border bg-background">
    <div className="border-b px-4 py-2.5">
      <h2 className="text-sm font-semibold">If you only pay the minimum</h2>
      <p className="text-xs text-muted-foreground">
        An estimate from Total owed {money(debtMinor)}{apr}; not a bank payoff quote.
        No new purchases, fees or rate changes; daily interest, no grace period.
      </p>
    </div>
    <div className="space-y-3 p-4">
      {activePlans ? <p className="text-sm text-muted-foreground">Not available while a plan is active: one purchase APR can&apos;t represent plan terms.</p>
        : projection?.ok && projection.neverPaysOff ? <p className="text-sm text-red-700 dark:text-red-400">
          This minimum never pays the debt off: it doesn&apos;t cover the interest.
        </p>
          : projection?.ok ? <>
            <dl className="grid grid-cols-3 gap-3">
              <Stat
                label="Estimated payoff"
                value={projection.payoffDate ? `~${Math.ceil(daysBetween(today, projection.payoffDate) / 30.4375)} months` : "Over 30 years"}
                detail={projection.payoffDate ? formatCardDate(projection.payoffDate) : undefined} />
              <Stat label="Interest until then" value={money(projection.interestMinor)} />
              <Stat label="Interest in the next 30 days" value={money(thirtyDays)} detail="With no payments" />
            </dl>
            <div className="grid grid-cols-2 gap-4">
              <HistoryChart title="Balance with minimum payments" historical={false} points={projection.balancePoints} />
              <HistoryChart title="Interest with minimum payments" tone="interest" historical={false} points={projection.interestPoints} />
            </div>
          </> : <p className="text-sm text-muted-foreground">
            {projection && !projection.ok ? projection.message : "Set the APR and minimum rule in Settings to see this estimate."}
          </p>}
    </div>
  </section>;
}

/** Insights (§9.2): interest & fees, payment track record, history charts and the minimum-only estimate. */
export function InsightsScreen({ entry, workspace: saved, onStatement, onSettings }: Props) {
  const { card, snapshot, today, view } = entry;
  const workspace = view.statementWorkspace ?? saved;
  if (!snapshot) return <p className="p-4 text-sm text-muted-foreground">Refresh Actual to see this card&apos;s history. Bank statements are kept.</p>;
  const history = statementHistory(card, workspace, snapshot, today);
  const interest = observedInterestTotals(card, workspace, snapshot, today);
  const fees = observedChargeTotals(card, workspace, snapshot, today, "fee");
  const trackedFrom = card.firstTrackedStatementDate ?? snapshot.from;
  const paidMinor = sumMinor(snapshot.rows
    .filter((row) => row.cleared === true && row.date > trackedFrom && row.date <= today)
    .filter((row) => familyOf(activityKind(row, card, workspace, snapshot)) === "payment")
    .map((row) => row.amountMinor));
  const carry = carriedDebtPoints(card, workspace, snapshot, today);
  const cumulative = cumulativeInterestCharges(history);
  const debtMinor = entry.owed ? (entry.owed.known ? entry.owed.owedMinor : undefined) : entry.balance?.debtMinor;
  const bills = view.rows.filter((row) => !row.statement.estimate && !row.startingPoint && row.status.known && row.statement.dueDate < today);
  const inFull = bills.filter((row) => row.status.key === "paid" || row.status.key === "covered-with-credits" || row.status.key === "settled-with-plan").length;
  const late = bills.filter((row) => row.status.late).length;
  const unpaid = bills.filter((row) => (row.payment?.unpaidAtDueMinor ?? 0) > 0).length;
  const lastCarry = carry.at(-1);
  const balances = [...history].reverse().filter((item) => !item.statement.estimate && item.covered)
    .map((item) => ({ date: item.statement.closingDate, value: item.statement.balanceMinor, source: "Bank statement" }));
  const zeroInterest = interest.classificationKnown && interest.totalMinor === 0 && cumulative.every((point) => point.value === 0);
  const activePlans = workspace.plans.some((plan) => plan.cardId === card.id && plan.status === "active");
  const unknown = !interest.classificationKnown || !fees.classificationKnown;

  return <div className="min-h-0 flex-1 overflow-auto">
    <div className="space-y-4 p-4">
      <p className="text-xs text-muted-foreground">
        {formatCardDate(interest.from)} – {formatCardDate(interest.to)} · tracked history. Unknown periods stay gaps, never zero.
      </p>
      <dl className="grid grid-cols-4 gap-3" aria-label="Interest, fees and payments">
        <Stat label="Interest" value={interest.classificationKnown || interest.totalMinor > 0 ? money(interest.totalMinor) : MISSING}
          detail={costDetail(interest)} />
        <Stat label="Fees" value={fees.classificationKnown || fees.totalMinor > 0 ? money(fees.totalMinor) : MISSING}
          detail={costDetail(fees)} />
        <Stat label="Paid since tracking" value={money(paidMinor)} detail={`since ${formatCardDate(trackedFrom)}`} />
        <Stat label="Unpaid at last due date" value={money(lastCarry?.value)} detail={lastCarry ? formatCardDate(lastCarry.date) : "No due date passed yet"} />
      </dl>
      {unknown && <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <p>Some interest or fees aren&apos;t identified yet, so their totals may be incomplete.</p>
        <Button size="xs" variant="outline" onClick={onSettings}>Map categories</Button>
      </div>}
      <section aria-label="Payment track record" className="rounded-lg border bg-background px-4 py-3">
        <h2 className="text-sm font-semibold">Payment track record</h2>
        <p className="mt-1 text-sm">
          {bills.length
            ? `${inFull} of ${plural(bills.length, "bill")} paid in full by the due date · ${late} paid late`
              + ` · ${unpaid} with a balance unpaid at the due date`
            : "No bill has passed its due date yet."}
        </p>
        {bills.filter((row) => row.status.late || row.status.overdue).slice(0, 3).map((row) => <Button
          key={row.statement.id}
          variant="link"
          size="xs"
          className="mr-3 h-auto p-0"
          onClick={() => onStatement(row.statement.id)}
        >{formatCardDate(row.statement.closingDate)} · {row.status.label}</Button>)}
      </section>
      <div className={`grid items-stretch gap-4 ${zeroInterest ? "grid-cols-2" : "grid-cols-3"}`}>
        <HistoryChart title="Unpaid at due date" points={carry} kind="bar" />
        <HistoryChart title="Statement balances" points={balances} kind="line" />
        {!zeroInterest && <HistoryChart title="Interest charged, running total" tone="interest" kind="line" points={cumulative} />}
      </div>
      {debtMinor !== undefined && debtMinor > 0 && <MinimumIllustration card={{ ...card, creditLimitMinor: entry.limitMinor }} today={today} debtMinor={debtMinor} activePlans={activePlans} />}
    </div>
  </div>;
}
