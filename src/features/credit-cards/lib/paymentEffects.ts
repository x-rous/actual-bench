import { paymentTarget } from "./paymentTargets";
import { activityKind, isSettlementCredit } from "./activity";
import type { ActivityRow, ActivitySnapshot } from "./activity";
import type { Card, Workspace } from "./models";
import { matchedPaymentStatement, effectiveActivityDate, type Settlement } from "./repayments";
import { sumMinor } from "./statements";
import { formatAmount } from "@/features/assets-debt/lib/money";

export type PaymentEffect = {
  label: string;
  detail: string;
  minimum?: string;
  /** Confirmed balance left through this date, in integer minor units; same-day entries are grouped. */
  remainingMinor?: number;
};

/** Read-only effects within the existing statement windows; amounts remain integer minor units. */
export function paymentEffects(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, windows: Settlement[], today: string) {
  const statements = workspace.statements.filter((entry) => entry.cardId === card.id);
  const events = snapshot.rows.map((row) => row.transferId ? row : { ...row, date: effectiveActivityDate(row, card.id, workspace) }).filter((row) => row.amountMinor > 0 && (activityKind(row, card, workspace, snapshot) === "payment" || isSettlementCredit(row, card, workspace, snapshot)));
  const assigned = new Map(events.map((row) => [row.id, matchedPaymentStatement(row.date, statements, windows)]));
  const effects = new Map<string, PaymentEffect>();
  const total = (rows: ActivityRow[]) => sumMinor(rows.map((row) => row.amountMinor));
  for (const row of events.filter((entry) => activityKind(entry, card, workspace, snapshot) === "payment")) {
    const statement = assigned.get(row.id);
    let effect: PaymentEffect;
    if (row.date > today) effect = { label: "Future dated", detail: "Future-dated transfers do not establish a confirmed payment effect today." };
    else if (!statement) effect = { label: "Unmatched", detail: "No tracked statement obligation is matched to this transfer." };
    else if (!statement.bankConfirmed) effect = { label: "Not confirmed", detail: "Confirm the matched statement’s bank values before assessing the transfer." };
    else if (snapshot.from > statement.closingDate || snapshot.to < row.date || snapshot.issues.length) effect = { label: "Effect unavailable", detail: "Complete transaction evidence from the statement close through this payment is required." };
    else {
      const window = events.filter((entry) => assigned.get(entry.id)?.id === statement.id && entry.cleared === true && entry.date <= row.date);
      const prior = window.filter((entry) => entry.date < row.date);
      const sameDay = window.filter((entry) => entry.date === row.date);
      const isPayment = (entry: ActivityRow) => activityKind(entry, card, workspace, snapshot) === "payment";
      const priorPaid = total(prior.filter(isPayment)), priorCredits = total(prior.filter((entry) => !isPayment(entry)));
      const dayPayments = sameDay.filter(isPayment), dayPaid = total(dayPayments), dayCredits = total(sameDay.filter((entry) => !isPayment(entry)));
      const balance = paymentTarget(statement);
      const remainingBefore = Math.max(0, balance - priorPaid - priorCredits);
      const minimumBefore = Math.max(0, statement.minimumDueMinor - priorPaid);
      const remainingAfter = Math.max(0, remainingBefore - dayPaid - dayCredits);
      const minimumAfter = Math.max(0, minimumBefore - dayPaid);
      const minimum = statement.minimumDueMinor === 0 ? "No minimum required" : minimumAfter === 0 ? "Minimum covered" : `Minimum still short ${formatAmount(minimumAfter, 2)}`;
      const detail = `After confirmed activity through this date: full remaining ${formatAmount(remainingAfter, 2)}; minimum remaining ${formatAmount(minimumAfter, 2)}. Credits reduce full remaining, never the minimum. This describes recorded effect, not payment intent. Excess over a statement obligation is not necessarily unused card credit.`;
      const label = dayPayments.length > 1 ? "Same-day payments" : dayCredits > 0 ? "Payment + credits" : row.amountMinor > Math.max(remainingBefore, minimumBefore) ? "Excess payment" : remainingAfter === 0 && minimumAfter === 0 ? balance < statement.officialBalanceMinor ? "Meets monthly target" : "Completes statement" : row.amountMinor === statement.minimumDueMinor && row.amountMinor === minimumBefore && minimumBefore > 0 ? "Minimum payment" : "Partial payment";
      effect = { label, minimum, remainingMinor: remainingAfter, detail: `${dayPayments.length > 1 || dayCredits > 0 ? "Same-day entries are assessed together because their within-day sequence is unknown. " : ""}${detail}` };
    }
    if (row.date <= today && row.cleared !== true) {
      effect = {
        ...effect,
        label: row.cleared === false ? "Pending" : "Clearing unknown",
        detail: `This transfer does not establish confirmed minimum or full settlement until cleared.${effect.remainingMinor !== undefined ? ` Confirmed remaining through this date is ${formatAmount(effect.remainingMinor, 2)}, excluding this transfer and all other pending or unknown-clearing activity. Same-day cleared activity is assessed together.` : " Complete evidence for a confirmed bank statement is required to show the remaining balance."}`,
      };
    }
    effects.set(row.id, effect);
  }
  return effects;
}
