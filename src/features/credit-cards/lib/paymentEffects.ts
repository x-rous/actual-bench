import { paymentTarget } from "./paymentTargets";
import { activityKind, paymentEvidence } from "./activity";
import type { ActivityRow, ActivitySnapshot } from "./activity";
import type { Card, Workspace } from "./models";
import { matchedPaymentStatement, effectiveActivityDate, type Settlement } from "./repayments";
import { sumMinor } from "./statements";
import { formatAmount } from "@/features/assets-debt/lib/money";

export type PaymentEffect = {
  label: string;
  detail: string;
  minimum?: string;
  /** Confirmed monthly target left through this date, in integer minor units; same-day entries are grouped. */
  remainingMinor?: number;
};

/** Read-only effects within the existing statement windows; amounts remain integer minor units. */
export function paymentEffects(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, windows: Settlement[], today: string) {
  const statements = workspace.statements.filter((entry) => entry.cardId === card.id);
  const events = snapshot.rows.map((row) => row.transferId ? row : { ...row, date: effectiveActivityDate(row, card.id, workspace) }).filter((row) => row.amountMinor > 0 && activityKind(row, card, workspace, snapshot) === "payment");
  const assigned = new Map(events.map((row) => [row.id, matchedPaymentStatement(row.date, statements, windows)]));
  const effects = new Map<string, PaymentEffect>();
  const total = (rows: ActivityRow[]) => sumMinor(rows.map((row) => row.amountMinor));
  for (const row of events) {
    const statement = assigned.get(row.id);
    let effect: PaymentEffect;
    if (row.date > today) effect = { label: "Future dated", detail: "Future-dated transfers do not establish a confirmed payment effect today." };
    else if (!statement) effect = { label: "Unmatched", detail: "No tracked statement obligation is matched to this transfer." };
    else if (!statement.bankConfirmed) effect = { label: "Not confirmed", detail: "Confirm the matched statement’s bank values before assessing the transfer." };
    else if (snapshot.from > statement.closingDate || snapshot.to < row.date || snapshot.issues.length) effect = { label: "Effect unavailable", detail: "Complete transaction evidence from the statement close through this payment is required." };
    else {
      const window = events.filter((entry) => assigned.get(entry.id)?.id === statement.id && paymentEvidence(entry, snapshot, workspace) === "confirmed" && entry.date <= row.date);
      const prior = window.filter((entry) => entry.date < row.date);
      const sameDay = window.filter((entry) => entry.date === row.date);
      const priorPaid = total(prior);
      const dayPayments = sameDay, dayPaid = total(dayPayments);
      const balance = paymentTarget(statement);
      const remainingBefore = Math.max(0, balance - priorPaid);
      const minimumBefore = Math.max(0, statement.minimumDueMinor - priorPaid);
      const remainingAfter = Math.max(0, remainingBefore - dayPaid);
      const minimumAfter = Math.max(0, minimumBefore - dayPaid);
      const statementAfter = Math.max(0, statement.officialBalanceMinor - priorPaid - dayPaid);
      const minimum = statement.minimumDueMinor === 0 ? "No minimum required" : minimumAfter === 0 ? "Minimum covered" : `Minimum still short ${formatAmount(minimumAfter, 2)}`;
      const detail = `After confirmed activity through this date: monthly target remaining ${formatAmount(remainingAfter, 2)}; full statement payment target remaining ${formatAmount(statementAfter, 2)}; minimum remaining ${formatAmount(minimumAfter, 2)}. Credits reduce Total owed, not the issued payment target or minimum. This describes recorded effect, not payment intent. Excess over a statement obligation is not necessarily unused card credit.`;
      const complete = remainingAfter === 0 && minimumAfter === 0;
      const exactBill = row.amountMinor === statement.officialBalanceMinor;
      const exactTarget = row.amountMinor === balance;
      // Earlier payments can lower the remaining amount without changing the original bill.
      const exactCompletion = complete && (remainingBefore > 0 || minimumBefore > 0) && (exactBill || exactTarget);
      const completionLabel = statementAfter === 0 ? "Completes statement" : "Meets monthly target";
      const aboveRemaining = Math.max(0, dayPaid - Math.max(remainingBefore, minimumBefore));
      const label = dayPayments.length > 1 ? "Same-day payments" : exactCompletion ? completionLabel : row.amountMinor > Math.max(remainingBefore, minimumBefore) ? "Excess payment" : complete ? completionLabel : row.amountMinor === statement.minimumDueMinor && row.amountMinor === minimumBefore && minimumBefore > 0 ? "Minimum payment" : "Partial payment";
      effect = { label, minimum, remainingMinor: remainingAfter, detail: `${dayPayments.length > 1 ? "Same-day entries are assessed together because their within-day sequence is unknown. " : ""}${detail}${aboveRemaining > 0 ? ` Payments exceed the remaining monthly target/minimum by ${formatAmount(aboveRemaining, 2)}; the card may have other debt.` : ""}` };
    }
    if (row.date <= today && paymentEvidence(row, snapshot, workspace) !== "confirmed") {
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
