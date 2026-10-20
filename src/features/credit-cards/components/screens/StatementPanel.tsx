"use client";
import type { KeyboardEvent } from "react";
import { ChevronRight, Landmark, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StatementBreakdown } from "../../lib/derive/breakdown";
import type { StatementRow } from "../../lib/derive/cardView";
import { formatCardDate, formatStatementPeriod } from "../../lib/displayDates";
import type { CardEntry } from "../cardEntry";
import { PanelRow, PanelSection, SidePanel } from "../primitives/SidePanel";
import { StatusBadge } from "../primitives/StatusBadge";
import { money, shortDate } from "../primitives/format";
import type { StatementAction } from "./StatementsScreen";

type Props = {
  row: StatementRow & { breakdown: StatementBreakdown | null };
  entry: CardEntry;
  eligible: boolean;
  onClose: () => void;
  returnFocus?: () => void;
  headerHeight?: number;
  /** Move to the next (+1) or previous (−1) statement in the table. */
  onStep: (offset: number) => void;
  onReview: () => void;
  onEnter: () => void;
  onEdit: () => void;
  onAction: (kind: StatementAction) => void;
  onPayment: (id: string) => void;
};

const MARKS = { "on-time": "●", late: "◆", pending: "○", reversal: "✕" } as const;

/** The statement panel (§9.4): the bank's figures, this bill and the payments toward it. */
export function StatementPanel({ row, entry, eligible, onClose, returnFocus, headerHeight, onStep, onReview, onEnter, onEdit, onAction, onPayment }: Props) {
  const { statement, payment, status, match, breakdown } = row;
  const { snapshot, today } = entry;
  const met = payment?.minimumLeftMinor === 0 && statement.minimumDueMinor > 0;
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea, [role=menu]")) return false;
    if (event.key === "ArrowDown") onStep(1);
    else if (event.key === "ArrowUp") onStep(-1);
    else return false;
    return true;
  };
  const title = `${statement.estimate ? "Estimated statement" : "Statement"} ${shortDate(statement.closingDate, today)}`;
  return <SidePanel
    title={title}
    description={formatStatementPeriod(statement.periodStart, statement.closingDate)}
    headerHeight={headerHeight}
    hint="↑/↓ other statements"
    onClose={onClose}
    onKeys={keys}
    returnFocus={returnFocus}
    footer={statement.estimate ? undefined : <>
      <Button size="sm" variant="outline" onClick={onEdit}><Landmark className="size-3.5" aria-hidden />Edit figures</Button>
      <Button size="sm" variant="outline" onClick={() => onAction("reset")}><RotateCcw className="size-3.5" aria-hidden />Reset review</Button>
      <Button size="sm" variant="outline" className="text-destructive" aria-label="Delete statement" onClick={() => onAction("delete")}>
        <Trash2 className="size-3.5" aria-hidden />Delete
      </Button>
    </>}
  >
    <PanelSection
      title="On the bank statement"
      action={statement.estimate ? <StatusBadge label="Estimate" tone="muted" /> : <button
        type="button"
        disabled={!snapshot}
        onClick={onReview}
        aria-label={`${match.label}${match.line ? `, ${match.line}` : ""}. Review transactions`}
        title="Review transactions"
        className="inline-flex items-center gap-0.5 rounded-full hover:opacity-80 disabled:opacity-60"
      ><StatusBadge label={match.label} tone={match.tone} line={match.line} /><ChevronRight className="size-3.5 text-muted-foreground" aria-hidden /></button>}
    >
      {statement.estimate
        ? <>
          <p className="text-[13px] text-muted-foreground">Estimated from Actual: {money(statement.balanceMinor)}. Enter the bank figures to track this bill.</p>
          <div className="mt-2 flex justify-end"><Button size="sm" disabled={!eligible} onClick={onEnter}>Verify</Button></div>
        </>
        : <>
          <dl>
            <PanelRow label="Previous balance" value={money(breakdown?.openingMinor)} />
            <PanelRow label="− Payments & credits" value={money(breakdown?.paymentsAndCreditsMinor)} />
            <PanelRow label="+ Charges" value={money(breakdown?.chargesMinor)} />
            <PanelRow label="+ Interest & fees" value={money(breakdown?.interestAndFeesMinor)} />
            <PanelRow label="Calculated" value={money(breakdown?.calculatedMinor)} />
            <PanelRow strong label="Statement balance" value={money(statement.balanceMinor)} />
          </dl>
        </>}
    </PanelSection>
    {!statement.estimate && <PanelSection title="This bill" action={<StatusBadge label={status.label} tone={status.tone} line={status.line} />}>
      <dl>
        <PanelRow label="Due date" value={formatCardDate(statement.dueDate)} />
        <PanelRow label="Amount due" value={money(payment?.amountDueMinor)} />
        <PanelRow label="Minimum due" value={`${money(statement.minimumDueMinor)}${met ? " · met" : ""}`} />
        <PanelRow label="Paid" value={money(payment?.known ? payment.paidMinor : null)} />
        {payment?.pendingMinor ? <PanelRow label="Pending" value={money(payment.pendingMinor)} /> : null}
        {payment?.known && payment.convertedMinor ? <PanelRow label="Moved to plans" value={money(payment.convertedMinor)} /> : null}
        <PanelRow strong label="Left to pay" value={money(payment?.leftToPayMinor)} />
      </dl>
    </PanelSection>}
    {!statement.estimate && <PanelSection title="Payments toward this bill">
      {payment?.rows.length ? <ul className="space-y-0.5 text-[13px]">{payment.rows.map(({ row: item, date }) => {
        const shape = item.amountMinor < 0 ? "reversal" : item.cleared !== true ? "pending" : date > statement.dueDate ? "late" : "on-time";
        return <li key={item.id}>
          <button
            type="button"
            className="flex w-full items-baseline justify-between gap-3 rounded px-1 py-0.5 text-left hover:bg-muted"
            onClick={() => onPayment(item.id)}
          >
            <span><span aria-hidden>{MARKS[shape]} </span>{shortDate(date, today)} · {item.label}
              <span className="sr-only"> · {shape === "on-time" ? "on time" : shape}</span></span>
            <span className="tabular-nums">{money(item.amountMinor)}</span>
          </button>
        </li>;
      })}</ul> : <p className="text-[13px] text-muted-foreground">{snapshot ? "No payments toward this bill yet." : "Refresh Actual to read payments."}</p>}
    </PanelSection>}
  </SidePanel>;
}
