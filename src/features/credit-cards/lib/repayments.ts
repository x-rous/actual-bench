import { addMonths, dateInMonth, daysBetween, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import type { ActivitySnapshot } from "./activity";
import { activityKind, isSettlementCredit, paymentEvidence } from "./activity";
import type { Card, PaymentAllocation, Statement, Workspace } from "./models";
import { currentPlanLink } from "./plans";
import { sumMinor } from "./statements";
import { paymentTarget } from "./paymentTargets";

export type DebtOrigin = { id: string; date: string; label: string; originalMinor: number; remainingMinor: number };
export type Settlement = {
  statementId: string; dueDate: string; fullRemainingMinor: number | null; minimumRemainingMinor: number | null;
  fullByDue: boolean | null; minimumByDue: boolean | null; paidMinor: number;
  /** Internal settlement diagnostic; UI labels and tones come from statementOutcome. */
  status: string;
  paymentWindowEnd: string; paidDate: string | null; minimumPaidDate: string | null; delayDays: number | null; provisionalMinor: number;
  /** Integer minor units from cleared card-side transfers, within paidMinor. */
  confirmedPaidMinor: number;
  /** Integer minor units of cashback credits; never included in paidMinor. */
  cashbackMinor?: number; confirmedCashbackMinor?: number; provisionalCashbackMinor?: number;
  /** All classified statement credits, including cashback; integer minor units, never payments. */
  creditMinor?: number; confirmedCreditMinor?: number; provisionalCreditMinor?: number;
  /** Confirmed carry frozen at the due-date cutoff; null before due or with incomplete/pending evidence. */
  carriedAtDueMinor?: number | null;
  confirmedPaidByDueMinor?: number;
  /** Cleared cashback posted by the due date, in integer minor units. */
  confirmedCashbackByDueMinor?: number; confirmedCreditByDueMinor?: number;
  /** Full-settlement dates include cashback; minimum-threshold dates use payments only. Recorded dates include pending evidence. */
  confirmedPaidDate: string | null; confirmedMinimumPaidDate: string | null;
  /** Monthly target evidence, separate from full-statement settlement; integer minor units. */
  targetRemainingMinor?: number | null; targetCarriedAtDueMinor?: number | null;
  targetByDue?: boolean | null; targetPaidDate?: string | null; confirmedTargetPaidDate?: string | null;
};
export type RepaymentLedger = {
  origins: DebtOrigin[]; allocations: PaymentAllocation[]; creditMinor: number;
  confirmedMinor: number; provisionalMinor: number; issues: string[]; anchorDate: string | null;
};

/** User-recorded bank posting date overrides Actual's date for card settlement timing. */
export function effectiveActivityDate(row: import("./activity").ActivityRow, cardId: string, workspace: Workspace) {
  if (row.amountMinor > 0 && row.transferId) return row.date;
  const dates = [...new Set(workspace.memberships.filter((entry) => entry.cardId === cardId && entry.transactionId === row.id && entry.fingerprint === row.fingerprint && entry.bankPostingDate).map((entry) => entry.bankPostingDate!))];
  return dates.length === 1 ? dates[0] : row.date;
}

/** Attribution ledger only: rolling bank snapshots never create extra principal. */
export function repaymentLedger(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, until = snapshot.to): RepaymentLedger {
  const anchor = workspace.statements.find((entry) => entry.cardId === card.id && entry.openingAnchor && entry.bankConfirmed);
  const result: RepaymentLedger = { origins: [], allocations: [], creditMinor: 0, confirmedMinor: 0, provisionalMinor: 0, issues: [], anchorDate: anchor?.closingDate ?? null };
  if (!anchor || anchor.closingDate > until || snapshot.from > anchor.closingDate) { result.issues.push("Record an opening bank statement within the loaded window to track settlement"); return result; }
  result.creditMinor = Math.max(0, -anchor.officialBalanceMinor);
  if (anchor.officialBalanceMinor > 0) result.origins.push({ id: anchor.id, date: anchor.closingDate, label: "Opening statement", originalMinor: anchor.officialBalanceMinor, remainingMinor: anchor.officialBalanceMinor });
  const reduce = (amount: number) => {
    let left = amount;
    for (const origin of result.origins) {
      const part = Math.min(left, origin.remainingMinor);
      origin.remainingMinor -= part; left -= part;
    }
    result.creditMinor = sumMinor([result.creditMinor, left]);
  };
  const datedRows = snapshot.rows.map((row) => {
    if (row.amountMinor > 0 && row.transferId) return row;
    const postingDates = [...new Set(workspace.memberships.filter((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.fingerprint === row.fingerprint && entry.bankPostingDate).map((entry) => entry.bankPostingDate!))];
    if (postingDates.length > 1) result.issues.push(`Conflicting bank posting dates: ${row.id}`);
    return postingDates.length === 1 ? { ...row, date: postingDates[0] } : row;
  }).sort((a, b) => a.date.localeCompare(b.date) || Number(a.amountMinor > 0) - Number(b.amountMinor > 0) || a.id.localeCompare(b.id));
  for (const row of datedRows.filter((entry) => entry.date > anchor.closingDate && entry.date <= until)) {
    const kind = activityKind(row, card, workspace, snapshot);
    if (row.cleared !== true) {
      if (kind === "payment") result.provisionalMinor = sumMinor([result.provisionalMinor, row.amountMinor]);
      // Cleared evidence is required for settlement; unposted spending is also provisional.
      if (row.amountMinor !== 0) result.issues.push(`Unconfirmed activity: ${row.id}`);
      continue;
    }
    if (row.amountMinor < 0) {
      if (row.transferId && !currentPlanLink(workspace, row) && !["cash-advance", "money-transfer", "balance-transfer"].includes(kind)) result.issues.push(`Outgoing borrowing transfer needs classification: ${row.id}`);
      const originalMinor = -row.amountMinor;
      const credit = Math.min(result.creditMinor, originalMinor);
      result.creditMinor -= credit;
      result.origins.push({ id: row.id, date: row.date, label: row.label, originalMinor, remainingMinor: originalMinor - credit });
      continue;
    }
    if (kind === "payment") {
      if (paymentEvidence(row, snapshot, workspace) !== "confirmed") { result.provisionalMinor = sumMinor([result.provisionalMinor, row.amountMinor]); result.issues.push(`Transfer counterpart needs review: ${row.id}`); continue; }
      const manual = workspace.allocations.filter((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.provenance === "manual");
      if (manual.length) {
        const total = sumMinor(manual.map((entry) => entry.amountMinor));
        const valid = total === Math.min(row.amountMinor, sumMinor(result.origins.map((origin) => origin.remainingMinor))) && new Set(manual.map((entry) => entry.originId)).size === manual.length && manual.every((entry) => entry.fingerprint === row.fingerprint && result.origins.some((origin) => origin.id === entry.originId && origin.remainingMinor >= entry.amountMinor));
        if (!valid) { result.issues.push(`Saved allocation changed or exceeds available debt: ${row.id}`); continue; }
        for (const entry of manual) {
          result.origins.find((origin) => origin.id === entry.originId)!.remainingMinor -= entry.amountMinor;
          result.allocations.push(entry);
        }
        // Unallocated money stays explicit card credit; never invent allocation to an origin.
        result.creditMinor = sumMinor([result.creditMinor, row.amountMinor - total]);
      } else {
        let left = row.amountMinor;
        for (const origin of result.origins) {
          const part = Math.min(left, origin.remainingMinor);
          if (part > 0) result.allocations.push({ cardId: card.id, transactionId: row.id, originId: origin.id, amountMinor: part, provenance: "automatic", fingerprint: row.fingerprint, reason: "Oldest outstanding origin first" });
          origin.remainingMinor -= part; left -= part;
        }
        result.creditMinor = sumMinor([result.creditMinor, left]);
      }
      result.confirmedMinor = sumMinor([result.confirmedMinor, row.amountMinor]);
    } else if (currentPlanLink(workspace, row)?.role === "conversion-credit") {
      const link = currentPlanLink(workspace, row)!;
      const plan = workspace.plans?.find((entry) => entry.id === link.planId);
      const origin = result.origins.find((entry) => entry.id === plan?.transactionId);
      if (origin) {
        const offset = Math.min(origin.remainingMinor, row.amountMinor);
        origin.remainingMinor -= offset;
        result.creditMinor = sumMinor([result.creditMinor, row.amountMinor - offset]);
      } else result.issues.push(`Conversion credit needs its original purchase evidence: ${row.id}`);
    } else if (isSettlementCredit(row, card, workspace, snapshot)) reduce(row.amountMinor);
    else if (row.amountMinor > 0) result.issues.push(`Positive activity needs classification: ${row.id}`);
  }
  return result;
}

/** Assign once. A bank-confirmed statement's explicit due date takes priority in overlapping windows. */
export function matchedPaymentStatement(date: string, statements: Statement[], windows: Pick<Settlement, "statementId" | "paymentWindowEnd">[]) {
  return statements.filter((statement) => date > statement.closingDate && windows.some((window) => window.statementId === statement.id && date <= window.paymentWindowEnd))
    .sort((a, b) => Number(b.bankConfirmed && b.dueDate === date) - Number(a.bankConfirmed && a.dueDate === date) || Number(b.bankConfirmed) - Number(a.bankConfirmed) || a.dueDate.localeCompare(b.dueDate) || a.closingDate.localeCompare(b.closingDate))[0];
}

/** One payment window per cycle: after closing, through the next closing date inclusive.
 * Notes, membership decisions and spending evidence never choose a repayment's statement.
 */
export function settlements(card: Card, workspace: Workspace, snapshot: ActivitySnapshot, today: string): Settlement[] {
  const statements = workspace.statements.filter((entry) => entry.cardId === card.id).sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  const payments = snapshot.rows.map((row) => row.amountMinor > 0 && !row.transferId ? { ...row, date: effectiveActivityDate(row, card.id, workspace) } : row).filter((row) => row.date <= today && (paymentEvidence(row, snapshot, workspace) !== "not-payment" || isSettlementCredit(row, card, workspace, snapshot))).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const windows = statements.map((statement) => {
    const closing = parseIsoDate(statement.closingDate);
    const day = card.closingDay ?? closing.day;
    const nominalClose = dateInMonth(closing.year, closing.month, day);
    // Small early-close exceptions belong to this cycle; a delayed month-end close
    // in the following month must still end its repayment window this month.
    const regularClose = nominalClose <= statement.closingDate || daysBetween(statement.closingDate, nominalClose) <= 7 ? addMonths(nominalClose, 1, day) : nominalClose;
    const exception = statements.find((entry) => entry.closingDate > statement.closingDate && entry.periodStart <= regularClose && entry.closingDate >= regularClose);
    const predictedClose = exception?.closingDate ?? regularClose;
    const next = statements.find((entry) => entry.closingDate > statement.closingDate);
    const cycleEnd = next && next.closingDate < predictedClose ? next.closingDate : predictedClose;
    return { statementId: statement.id, paymentWindowEnd: statement.bankConfirmed && statement.dueDate > cycleEnd ? statement.dueDate : cycleEnd };
  });
  const assignments = new Map(payments.map((row) => [row.id, matchedPaymentStatement(row.date, statements, windows)?.id]));
  return statements.map((statement) => {
    const paymentWindowEnd = windows.find((window) => window.statementId === statement.id)!.paymentWindowEnd;
    const windowActivity = payments.filter((row) => assignments.get(row.id) === statement.id);
    const credits = windowActivity.filter((row) => isSettlementCredit(row, card, workspace, snapshot));
    const creditMinor = sumMinor(credits.map((row) => row.amountMinor));
    const confirmedCreditMinor = sumMinor(credits.filter((row) => row.cleared === true).map((row) => row.amountMinor));
    const provisionalCreditMinor = creditMinor - confirmedCreditMinor;
    const cashback = windowActivity.filter((row) => activityKind(row, card, workspace, snapshot) === "cashback");
    const cashbackMinor = sumMinor(cashback.map((row) => row.amountMinor));
    const confirmedCashbackMinor = sumMinor(cashback.filter((row) => row.cleared === true).map((row) => row.amountMinor));
    const provisionalCashbackMinor = cashbackMinor - confirmedCashbackMinor;
    const windowPayments = windowActivity.filter((row) => activityKind(row, card, workspace, snapshot) === "payment");
    const confirmed = windowPayments.filter((row) => paymentEvidence(row, snapshot, workspace) === "confirmed");
    const confirmedPaidMinor = sumMinor(confirmed.map((row) => row.amountMinor));
    const paidMinor = sumMinor(windowPayments.map((row) => row.amountMinor));
    const provisionalMinor = sumMinor(windowPayments.filter((row) => paymentEvidence(row, snapshot, workspace) === "provisional").map((row) => row.amountMinor));
    const balance = Math.max(0, statement.officialBalanceMinor);
    const target = paymentTarget(statement);
    let targetPaidDate: string | null = null, confirmedTargetPaidDate: string | null = null;
    let running = 0, paidDate: string | null = null, minimumPaidDate: string | null = null;
    let runningPaid = 0;
    for (const payment of windowActivity) {
      if (activityKind(payment, card, workspace, snapshot) === "payment") runningPaid = sumMinor([runningPaid, payment.amountMinor]);
      running = sumMinor([running, payment.amountMinor]);
      if (target > 0 && running >= target && targetPaidDate === null) targetPaidDate = payment.date;
      if (balance > 0 && running >= balance && paidDate === null) paidDate = payment.date;
      if (statement.minimumDueMinor > 0 && runningPaid >= statement.minimumDueMinor && minimumPaidDate === null) minimumPaidDate = payment.date;
    }
    let confirmedRunning = 0, confirmedPaidDate: string | null = null, confirmedMinimumPaidDate: string | null = null;
    let confirmedRunningPaid = 0;
    for (const payment of windowActivity.filter((row) => row.cleared === true)) {
      if (activityKind(payment, card, workspace, snapshot) === "payment") confirmedRunningPaid = sumMinor([confirmedRunningPaid, payment.amountMinor]);
      confirmedRunning = sumMinor([confirmedRunning, payment.amountMinor]);
      if (target > 0 && confirmedRunning >= target && confirmedTargetPaidDate === null) confirmedTargetPaidDate = payment.date;
      if (balance > 0 && confirmedRunning >= balance && confirmedPaidDate === null) confirmedPaidDate = payment.date;
      if (statement.minimumDueMinor > 0 && confirmedRunningPaid >= statement.minimumDueMinor && confirmedMinimumPaidDate === null) confirmedMinimumPaidDate = payment.date;
    }
    const covered = snapshot.from <= statement.closingDate && snapshot.to >= (today < paymentWindowEnd ? today : paymentWindowEnd) && !snapshot.issues.length;
    const known = statement.bankConfirmed && covered;
    const fullRemainingMinor = known ? Math.max(0, balance - paidMinor - creditMinor) : null;
    const targetRemainingMinor = known ? Math.max(0, target - paidMinor - creditMinor) : null;
    const minimumRemainingMinor = known ? Math.max(0, statement.minimumDueMinor - paidMinor) : null;
    const paidByDue = sumMinor(windowPayments.filter((row) => row.date <= statement.dueDate).map((row) => row.amountMinor));
    const confirmedPaidByDueMinor = sumMinor(confirmed.filter((row) => row.date <= statement.dueDate).map((row) => row.amountMinor));
    const dueCovered = statement.bankConfirmed && statement.dueDate < today && snapshot.from <= statement.closingDate && snapshot.to >= statement.dueDate && !snapshot.issues.length;
    const creditsByDue = sumMinor(credits.filter((row) => row.date <= statement.dueDate).map((row) => row.amountMinor));
    const confirmedCreditsByDue = sumMinor(credits.filter((row) => row.date <= statement.dueDate && row.cleared === true).map((row) => row.amountMinor));
    const pendingByDue = paidByDue - confirmedPaidByDueMinor + creditsByDue - confirmedCreditsByDue;
    const carriedAtDueMinor = dueCovered && pendingByDue === 0 ? Math.max(0, balance - confirmedPaidByDueMinor - confirmedCreditsByDue) : null;
    const fullByDue = dueCovered && (pendingByDue === 0 || confirmedPaidByDueMinor + confirmedCreditsByDue >= balance) ? confirmedPaidByDueMinor + confirmedCreditsByDue >= balance : null;
    const targetByDue = dueCovered && (pendingByDue === 0 || confirmedPaidByDueMinor + confirmedCreditsByDue >= target) ? confirmedPaidByDueMinor + confirmedCreditsByDue >= target : null;
    const targetCarriedAtDueMinor = dueCovered && pendingByDue === 0 ? Math.max(0, target - confirmedPaidByDueMinor - confirmedCreditsByDue) : null;
    const minimumByDue = dueCovered && (paidByDue === confirmedPaidByDueMinor || confirmedPaidByDueMinor >= statement.minimumDueMinor) ? confirmedPaidByDueMinor >= statement.minimumDueMinor : null;
    const delayDays = known && paidDate ? Math.max(0, daysBetween(statement.dueDate, paidDate)) : null;
    return { statementId: statement.id, dueDate: statement.dueDate, paymentWindowEnd, paidMinor, provisionalMinor, confirmedPaidMinor, cashbackMinor, confirmedCashbackMinor, provisionalCashbackMinor, creditMinor, confirmedCreditMinor, provisionalCreditMinor,
      targetRemainingMinor, targetCarriedAtDueMinor, targetByDue, targetPaidDate: known ? targetPaidDate : null, confirmedTargetPaidDate: known ? confirmedTargetPaidDate : null,
      carriedAtDueMinor, confirmedPaidByDueMinor, confirmedCashbackByDueMinor: sumMinor(cashback.filter((row) => row.date <= statement.dueDate && row.cleared === true).map((row) => row.amountMinor)), confirmedCreditByDueMinor: confirmedCreditsByDue,
      confirmedPaidDate: known ? confirmedPaidDate : null, confirmedMinimumPaidDate: known ? confirmedMinimumPaidDate : null,
      paidDate: known ? paidDate : null, minimumPaidDate: known ? minimumPaidDate : null, delayDays,
      fullRemainingMinor, minimumRemainingMinor, fullByDue, minimumByDue,
      status: !statement.bankConfirmed ? "Estimate · confirm bank facts" : !covered ? "Coverage unknown" : balance === 0 ? "No payment required" : fullRemainingMinor === 0 ? confirmedPaidMinor + confirmedCreditMinor >= balance ? minimumRemainingMinor! > 0 ? "Balance covered by credits · minimum unpaid" : confirmedPaidDate && confirmedPaidDate > statement.dueDate ? confirmedCreditMinor ? "Settled late · includes credits" : "Paid late" : confirmedCreditMinor ? "Settled · includes credits" : "Settled" : creditMinor ? "Credits recorded · clearing pending" : "Payment recorded · clearing pending" : minimumRemainingMinor === 0 ? confirmedPaidMinor >= statement.minimumDueMinor ? confirmedMinimumPaidDate && confirmedMinimumPaidDate > statement.dueDate ? "Minimum paid late · balance carried" : "Minimum met · full balance remains" : "Minimum recorded · clearing pending" : statement.dueDate < today ? "Minimum overdue" : paymentDeadline(statement.dueDate, today),
    };
  });
}

export function latestStatement(statements: Statement[], cardId: string) {
  return statements.filter((entry) => entry.cardId === cardId).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
}


/** Bank-local calendar labels; payment outcomes are reported independently. */
export function paymentDeadline(dueDate: string, today: string) {
  const days = daysBetween(today, dueDate);
  return days < 0 ? "Overdue" : days === 0 ? "Due today" : days <= 7 ? "Due soon" : "Upcoming";
}
