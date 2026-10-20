"use client";
import type { ReactNode } from "react";
import { CircleDashed, TriangleAlert, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Statement, Workspace } from "../../lib/models";
import { netActivitySinceStatement } from "../../lib/insights";
import { cardFacility, cardModel } from "../../lib/financialAdapter";
import { planProgress, planStatus, planTermsRemaining } from "../../lib/plans";
import { sumMinor } from "../../lib/statements";
import { BalanceHistory } from "../BalanceHistory";
import type { CardEntry } from "../cardEntry";
import { cardAttention } from "../cardAttention";
import { StatusBadge } from "../primitives/StatusBadge";
import { money, plural, shortDate } from "../primitives/format";

type Props = {
  budget: string;
  entry: CardEntry;
  workspace: Workspace;
  onStatement: (id: string) => void;
  onEnter: () => void;
  onReview: (statement: Statement) => void;
  onActivityCurrent: () => void;
  onPlans: () => void;
  onPayment: (id: string) => void;
};

type Attention = { key: string; icon: "warning" | "danger" | "estimate"; text: ReactNode; action: string; run: () => void; rank: number };

function Panel({ title, action, children, label }: { title: ReactNode; action?: ReactNode; children: ReactNode; label: string }) {
  return <section aria-label={label} className="min-w-0 rounded-lg border bg-background">
    <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
    <div className="px-4 py-3">{children}</div>
  </section>;
}

function Line({ label, value, children, className }: { label: ReactNode; value: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={`flex items-baseline justify-between gap-3 py-0.5 text-sm ${className ?? ""}`}>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="tabular-nums">{value}{children}</dd>
  </div>;
}

const signed = (minor: number) => `${minor > 0 ? "+" : ""}${money(minor)}`;
const ICONS = { warning: TriangleAlert, danger: CircleAlert, estimate: CircleDashed };
const ICON_TONES = { warning: "size-4 text-amber-700", danger: "size-4 text-red-700", estimate: "size-4 text-muted-foreground" };

/** Overview (§9.6): what needs you, the next payment, Total owed, the balance chart and plans. */
export function OverviewScreen({ entry, workspace, onStatement, onEnter, onReview, onActivityCurrent, onPlans, onPayment }: Props) {
  const { card, view, snapshot, balance, owed, today, limitMinor } = entry;
  const bank = view.bank;
  const payment = view.nextPayment;
  const row = view.rows.find((item) => item.statement.id === bank?.id);
  const bridge = bank && snapshot && balance
    ? netActivitySinceStatement(card, bank, workspace, snapshot, balance.rawSignedBalanceMinor, today)
    : null;
  const coverage = bridge && !bridge.covered && snapshot
    ? snapshot.issues.length ? "Some transaction details are incomplete. Refresh to try again."
      : snapshot.to < today ? `Activity read through ${shortDate(snapshot.to, today)}. Refresh for today.`
        : `Activity starts on ${shortDate(snapshot.from, today)}. Refresh to read the full period.`
    : null;
  const plans = workspace.plans.filter((plan) => plan.cardId === card.id && plan.status === "active");
  const ACTIONS = { statement: "Open", review: "Review", enter: "Enter", plans: "Plans" } as const;
  const attention: Attention[] = cardAttention(entry, workspace).map((item) => ({
    ...item,
    action: item.key === "found" ? "Review" : item.target.kind === "plans" && (item.key === "unassigned" || item.key === "ambiguous") ? "Show"
      : ACTIONS[item.target.kind],
    run: () => {
      const { target } = item;
      if (target.kind === "statement") onStatement(target.statement.id);
      else if (target.kind === "review") onReview(target.statement);
      else if (target.kind === "enter") onEnter();
      else onPlans();
    },
  }));

  const paid = payment?.known ? payment.paidMinor : null;
  const due = payment?.amountDueMinor ?? 0;
  const percent = due > 0 && paid !== null ? Math.min(100, paid / due * 100) : 0;
  const marker = bank && due > 0 ? Math.min(100, bank.minimumDueMinor / due * 100) : 0;
  // D22: a plan check never hides Total owed; only an unread plan account does.
  const totalMinor = owed ? (owed.known ? owed.owedMinor : null) : balance?.debtMinor ?? null;
  const capacity = owed?.known ? owed.capacitySignedMinor : balance?.signedBalanceMinor;
  const creditUsed = capacity === undefined ? undefined : Math.max(0, -capacity);
  const facility = balance && creditUsed !== undefined ? cardFacility(cardModel({ ...card, creditLimitMinor: limitMinor }, today, creditUsed), capacity!) : null;
  const used = creditUsed !== undefined && limitMinor ? Math.round(creditUsed / limitMinor * 100) : null;
  // PL-11: principal of card-billed plans is not in Actual; shown on its own line, never in the headline.
  const outsideActual = sumMinor(plans.map((plan) => planTermsRemaining(plan, card, today) ?? 0));
  const minimumText = !bank ? null : bank.minimumDueMinor === 0 ? "no minimum"
    : payment?.minimumLeftMinor === 0 ? `minimum ${money(bank.minimumDueMinor)} met` : `minimum left ${money(payment?.minimumLeftMinor)}`;

  return <div className="min-h-0 flex-1 overflow-auto">
    <div className="space-y-4 p-4">
      {attention.length > 0 && <section aria-label="Needs your attention" className="rounded-lg border border-amber-500/40 bg-background">
        <h2 className="rounded-t-lg border-b border-amber-500/30 bg-amber-50 px-4 py-2.5 text-sm font-semibold dark:bg-amber-950/30">
          Needs your attention ({attention.length})
        </h2>
        <ul className="divide-y px-4">{attention.slice(0, 5).map((item) => {
          const Icon = ICONS[item.icon];
          return <li key={item.key} className="flex items-center gap-3 py-2 text-sm">
            <Icon className={ICON_TONES[item.icon]} aria-hidden />
            <span className="min-w-0 flex-1">{item.text}</span>
            <Button size="xs" variant="outline" onClick={item.run}>{item.action}</Button>
          </li>;
        })}</ul>
      </section>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel
          label="Next payment"
          title={bank ? `Next payment · statement ${shortDate(bank.closingDate, today)}` : "Next payment"}
          action={row && <StatusBadge label={row.status.label} tone={row.status.tone} />}
        >
          {bank ? <div className="space-y-2">
            <p>
              <span className="text-2xl font-semibold tabular-nums">{money(payment?.leftToPayMinor)}</span>
              <span className="text-muted-foreground"> left to pay</span>
            </p>
            <div
              role="progressbar"
              aria-label="Amount due paid"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
              aria-valuetext={`${money(paid)} paid of ${money(due)}${minimumText ? `; ${minimumText}` : ""}`}
              className="relative h-2 rounded-full bg-muted"
            >
              <div className="h-2 rounded-full bg-foreground/70" style={{ width: `${percent}%` }} />
              {marker > 0 && <span aria-hidden className="absolute -top-1 h-4 w-0.5 bg-foreground" style={{ left: `min(calc(100% - 2px), ${marker}%)` }} />}
            </div>
            <p className="text-xs text-muted-foreground">{money(paid)} paid of {money(due)} amount due{minimumText ? ` · ${minimumText}` : ""}</p>
            <p className="text-sm">Due {shortDate(bank.dueDate, today)}{payment?.pendingMinor ? ` · ${money(payment.pendingMinor)} pending` : ""}</p>
            <Button variant="link" size="xs" className="h-auto p-0" onClick={() => onStatement(bank.id)}>Open statement →</Button>
          </div> : <div className="space-y-2 text-sm text-muted-foreground">
            <p>Enter a bank statement to track what to pay.</p>
            <Button size="sm" onClick={onEnter}>Enter statement</Button>
          </div>}
        </Panel>

        <Panel label="Total owed" title="Total owed">
          <p className="mb-2 text-2xl font-semibold tabular-nums">{money(totalMinor)}</p>
          <dl>
            {owed?.hasPlanAccounts && <>
              <Line label="On card" value={money(owed.onCardMinor)} />
              <Line label="In plan accounts" value={owed.known ? money(owed.inPlanAccountsMinor) : "Not read"} />
            </>}
            {owed?.known && owed.inTransitMinor !== 0 && <Line label="In transit" value={money(owed.inTransitMinor)} />}
            {!owed?.hasPlanAccounts && <Line label="Statement balance" value={money(bank?.balanceMinor)} />}
            {bank && <Line label={`New since ${shortDate(bank.closingDate, today)}`} value={bridge ? signed(bridge.netMinor) : money(null)}>
              {bridge && <Button variant="link" size="xs" className="ml-2 h-auto p-0" onClick={onActivityCurrent}>
                {plural(bridge.rows.length, "transaction")} →
              </Button>}
            </Line>}
          </dl>
          {owed?.known && owed.unassignedMinor !== 0 && <p className="mt-2 text-xs text-muted-foreground">
            {money(owed.unassignedMinor)} in a plan account belongs to no plan yet.
          </p>}
          {owed && !owed.known && <p className="mt-2 text-xs text-muted-foreground">A plan account isn&apos;t read yet; Refresh to include it.</p>}
          {coverage && <p role="status" className="mt-2 text-xs text-muted-foreground">{coverage}</p>}
          {outsideActual > 0 && <p className="mt-2 text-xs text-muted-foreground">Not recorded in Actual ≈ {money(outsideActual)} (from plan terms)</p>}
        </Panel>

        <Panel label="Credit" title="Credit">
          <p className="mb-2"><span className="text-2xl font-semibold tabular-nums">{money(facility?.availableMinor)}</span>
            <span className="text-muted-foreground"> available</span></p>
          {used !== null && <div role="progressbar" aria-label="Credit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, used)}
            className="mb-2 h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-foreground/70" style={{ width: `${Math.min(100, used)}%` }} />
          </div>}
          <dl>
            <Line label="Credit used" value={used !== null ? `${money(creditUsed)} · ${used}%` : money(creditUsed)} />
            <Line label="Limit" value={money(limitMinor)} />
            {balance?.creditMinor ? <Line label="Card in credit" value={money(balance.creditMinor)} /> : null}
          </dl>
          {limitMinor == null && <p className="mt-2 text-xs text-muted-foreground">Set the credit limit in Settings to see available credit.</p>}
        </Panel>
      </div>

      {snapshot
        ? <BalanceHistory
          card={card}
          workspace={view.statementWorkspace}
          snapshot={snapshot}
          signedBalanceMinor={balance?.signedBalanceMinor}
          today={today}
          onStatement={onStatement}
          onPayment={onPayment}
        />
        : <div aria-label="Loading balance chart" className="h-[320px] animate-pulse rounded-lg border bg-muted/30" />}

      {plans.length > 0 && <Panel
        label="Instalment plans"
        title={`Instalment plans (${plans.length})`}
        action={<Button variant="link" size="xs" className="h-auto p-0" onClick={onPlans}>Manage instalment plans →</Button>}
      >
        <ul className="divide-y">{plans.map((plan) => {
          const progress = planProgress(plan, card, workspace, snapshot);
          const status = planStatus(plan, card, workspace, snapshot, today);
          const total = progress.tracked.length;
          const where = plan.recordedAs === "plan-account" ? "in plan account" : "on the card";
          return <li key={plan.id} className="grid grid-cols-[120px_120px_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">
            <span className="truncate font-medium">{plan.name}</span>
            {total ? <div role="progressbar" aria-label={`${plan.name} billed`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={progress.billedCount}
              className="h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-foreground/70" style={{ width: `${progress.billedCount / total * 100}%` }} />
            </div>
              : <span className="text-xs text-muted-foreground">Balance only</span>}
            <span className="truncate text-muted-foreground">
              {total ? `${progress.billedCount} of ${total} billed` : status.label}
              {progress.next ? ` · next ${money(progress.next.amountMinor)} on ${shortDate(progress.next.date, today)}` : ""}
              {status.check && total ? ` · ${status.label}` : ""}
            </span>
            <span className="text-right tabular-nums">{status.principalMinor !== null ? `${money(status.principalMinor)} ${where}` : ""}</span>
          </li>;
        })}</ul>
      </Panel>}
    </div>
  </div>;
}
