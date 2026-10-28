import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { createObservedRepaymentAllocator, type AllocatedRepayment, type ObservedRepaymentAllocator } from "@/lib/financial-models/loan/statementAllocation";
import { alignPayments, type AlignPin } from "@/lib/financial-models/matching";
import { ruleMatches, type ConditionSet } from "@/lib/transactions/conditions";
import type { DebtLedgerEntry } from "@/lib/app-db/debtTrackingRepository";
import { isPostingMarker } from "../markers";
import { untouchedCounterpartProblems } from "@/lib/actual/transactionStructure";
import { calculatePeriod } from "../services/snapshot";
import { adjustmentMarker, adjustmentProposal, convertProposal, splitProposal, type Proposal, type ProposalContext } from "./proposals";

/**
 * Tracking a loan in Actual (loan simplifications, design spec 06 §5). Pure: it reads the loan account, the payments
 * found around it, the user's decisions and the loan's contract, and returns the Loan Ledger, one row per installment
 * with its status, and the writes that would record each one. It never reads or writes anything itself.
 *
 * In short:
 * 1. The contract schedule numbers the installments and gives each one's scheduled payment.
 * 2. Installments before the tracking start are assumed paid as contracted; the opening position is the calculated
 *    principal just before it (or a lender statement).
 * 3. Payments are transfers into the loan account (seen from the paying side), splits already in Actual, and rows a
 *    payment rule finds. They are lined up against the installments by date and amount (`alignPayments`).
 * 4. Interest is allocated from what really happened: each payment on its own date, extra principal on its date.
 * 5. An installment is Recorded when Actual already holds its principal in the loan account and its interest outside it;
 *    Unrecorded when one write records it; Check when a decision is needed; Missing when nothing was paid.
 */

export type EntryType = Exclude<DebtLedgerEntry["entryType"], "not-repayment"> | "unclassified";

export type TrackingDebt = {
  id: string;
  budgetSyncId: string;
  liabilityAccountId: string;
  trackingStartDueDate: string;
  representation: "split" | "lender-charged";
  loanPaymentCategoryId: string | null;
  interestCategoryId: string | null;
  feeCategoryId: string | null;
  principalNoteSuffix: string;
  interestNoteSuffix: string;
  toleranceMinor: number;
  missingGraceDays: number;
};

export type TrackingInput = {
  debt: TrackingDebt;
  /** The contract: terms, rates and events dated before the tracking start (what-ifs never reach here). */
  model: LoanModelSnapshot;
  today: string;
  /** A lender statement used instead of the calculated opening position. */
  openingStatement?: { date: string; principalMinor: number } | null;
  /** "Actual is right from here": the calculation continues from Actual's balance on these dates. */
  anchors?: readonly { date: string; principalMinor: number }[];
  accounts: ProposalContext["accounts"];
  transferPayeeByAccount: ProposalContext["transferPayeeByAccount"];
  /** Every row of the loan account. */
  loanRows: readonly SyncSourceTransaction[];
  /** Rows of other accounts: the paying side of the loan account's transfers and the accounts payment rules name. */
  bankRows: readonly SyncSourceTransaction[];
  entries: readonly DebtLedgerEntry[];
  rules: readonly ConditionSet[];
};

export type PaymentKind = "transfer" | "split" | "rule";

export type Payment = {
  id: string;
  kind: PaymentKind;
  date: string;
  /** Positive: what was paid. */
  amountMinor: number;
  /** The payment as Actual holds it (the bank row, or the split parent); the loan-side row when the paying side wasn't read. */
  row: SyncSourceTransaction;
  /** The loan account's row(s) for this payment. */
  loanRows: SyncSourceTransaction[];
  /** For a split already in Actual: what it holds. */
  split?: { principalMinor: number; interestMinor: number; feesMinor: number; principalLineId: string; interestLineId: string | null };
  /** The paying side is not in what was read (only the loan-side row is known). */
  sideUnknown?: boolean;
};

export type InstallmentStatus = "recorded" | "unrecorded" | "check" | "missing" | "upcoming";

export type Installment = {
  no: number;
  dueDate: string;
  scheduledMinor: number;
  status: InstallmentStatus;
  payment: Payment | null;
  /** What Actual holds (Recorded) or what Bench would write (Unrecorded); the calculation otherwise. */
  principalMinor: number;
  interestMinor: number;
  feesMinor: number;
  /** Bench's own figure for this installment's interest, for comparison. */
  calculatedInterestMinor: number;
  balanceAfterMinor: number;
  /** One sentence: why it needs a decision, or something worth knowing. */
  note: string | null;
  checkKind?: "drift" | "competing" | "reconciled" | "short" | "interest-only" | "loan-side-changed" | "side-unknown" | "cannot-split";
  /** Other payments that could be this installment (competing). */
  alternatives?: Payment[];
  proposal: Proposal | null;
};

export type LedgerRow = {
  row: SyncSourceTransaction;
  type: EntryType;
  /** Bench's suggestion, not saved; the calculation still uses it. */
  suggested: boolean;
  installment: number | null;
  /** Interest still inside a whole transfer until it is split. */
  includesInterestMinor: number | null;
  benchMade: boolean;
  /** The account's running balance after this row, as Actual shows it (signed). */
  runningMinor: number;
  entryRevision: number;
};

export type TrackingResult =
  | {
      ok: true;
      opening: { date: string; principalMinor: number; source: "calculated" | "statement"; actualMinor: number; differenceMinor: number };
      before: { count: number; firstDueDate: string | null; lastDueDate: string | null };
      openingAdjustment: Proposal | null;
      /** Where a projection of the rest of the loan starts: the last thing that really happened, and the payment then in force. */
      anchor: { date: string; principalMinor: number; scheduledPaymentMinor: number };
      installments: Installment[];
      ledger: LedgerRow[];
      /** Extra principal, draws, fees and adjustments from the tracking start on: the Loan Ledger's events for the calculation. */
      events: { date: string; kind: "extra-principal" | "draw" | "fee" | "interest-charged" | "adjustment"; amountMinor: number; rowId: string }[];
      figures: {
        owedInActualMinor: number;
        calculatedMinor: number;
        differenceMinor: number;
        nextPayment: { dueDate: string; no: number; amountMinor: number } | null;
        counts: Record<InstallmentStatus, number>;
        interestThisYearMinor: number;
      };
    }
  | { ok: false; message: string };

const DAY = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const UPCOMING_SHOWN = 3;

function fmt(minor: number, digits: number): string {
  return (minor / 10 ** digits).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A transport row as the shared conditions read it. */
function ruleRow(row: SyncSourceTransaction) {
  return { accountId: row.accountId, payeeId: row.payeeId, payeeName: row.payeeName, categoryId: row.categoryId, categoryName: row.categoryName, notes: row.notes, amountMinor: row.amount };
}

export type Due = { no: number; date: string; scheduledMinor: number; interestMinor: number; principalMinor: number; feesMinor: number; balanceBeforeMinor: number; balanceAfterMinor: number };

/** The contract schedule: every installment, numbered from 1. */
export function contractSchedule(model: LoanModelSnapshot, until: string): { ok: true; dues: Due[] } | { ok: false; message: string } {
  const terms = model.terms;
  const run = calculatePeriod({
    model,
    opening: { date: terms.openingDate, principalMinor: terms.openingPrincipalMinor, accruedInterestMinor: 0, carriedRemainder: null, source: { kind: "contract-opening" } },
    offsets: [],
    from: terms.openingDate,
    to: until,
  });
  if (!run.ok) return { ok: false, message: run.message };
  const dues = run.events
    .filter((e) => e.eventType === "repayment" || e.eventType === "final-payment")
    .map((e, i): Due => ({
      no: i + 1, date: e.date, scheduledMinor: Math.abs(e.cashMovementMinor), interestMinor: Math.abs(e.interestMinor), feesMinor: Math.abs(e.feesMinor),
      principalMinor: Math.abs(e.principalMovementMinor), balanceBeforeMinor: e.balanceBeforeMinor, balanceAfterMinor: e.balanceAfterMinor,
    }));
  return { ok: true, dues };
}

/**
 * Index every bank row and split line by id, keeping each line's parent. A read can return a split's lines both inside
 * the parent and as rows of their own; a line always resolves to its parent, whatever order they came in.
 */
function indexRows(rows: readonly SyncSourceTransaction[]) {
  const byId = new Map<string, { row: SyncSourceTransaction; parent: SyncSourceTransaction | null }>();
  const parents = new Map(rows.filter((r) => r.isParent).map((r) => [r.id, r]));
  for (const row of rows) {
    if (row.isChild) {
      const parent = row.parentId ? parents.get(row.parentId) ?? null : null;
      if (!byId.has(row.id) || parent) byId.set(row.id, { row, parent });
      continue;
    }
    byId.set(row.id, { row, parent: null });
    for (const line of row.splitLines) {
      if (!line.id) continue;
      byId.set(line.id, {
        row: { ...row, id: line.id, amount: line.amount, payeeId: line.payeeId, payeeName: line.payeeName, categoryId: line.categoryId, categoryName: line.categoryName ?? null, notes: line.notes, transferId: line.transferId ?? null, isParent: false, isChild: true, parentId: row.id, splitLines: [] },
        parent: row,
      });
    }
  }
  return byId;
}

/** A split of one payment into one transfer line to the loan account plus other lines. */
function readSplit(parent: SyncSourceTransaction, loanRowIds: ReadonlySet<string>): Payment["split"] | null {
  const transfers = parent.splitLines.filter((l) => l.transferId && loanRowIds.has(l.transferId));
  if (transfers.length !== 1 || !transfers[0].id) return null;
  const others = parent.splitLines.filter((l) => l !== transfers[0]);
  const interestLine = others.find((l) => !l.transferId) ?? null;
  const interest = interestLine ? Math.abs(interestLine.amount) : 0;
  const fees = others.filter((l) => l !== interestLine).reduce((sum, l) => sum + Math.abs(l.amount), 0);
  return { principalMinor: Math.abs(transfers[0].amount), interestMinor: interest, feesMinor: fees, principalLineId: transfers[0].id, interestLineId: interestLine?.id ?? null };
}

/** Every payment that may be the loan's, from the tracking window on. */
function findPayments(input: TrackingInput, from: string): Payment[] {
  const loanId = input.debt.liabilityAccountId;
  const loanIds = new Set(input.loanRows.map((r) => r.id));
  const bank = indexRows(input.bankRows);
  const excluded = new Set(input.entries.filter((e) => e.entryType === "not-repayment" || (e.entryType !== "principal-repayment" && loanIds.has(e.actualTransactionId))).map((e) => e.actualTransactionId));
  const payments = new Map<string, Payment>();
  for (const row of input.loanRows) {
    // A transfer into the loan account reduces the debt (the loan account is negative while it is owed).
    if (row.amount <= 0 || !row.transferId || row.date <= from || isPostingMarker(row.importedId) || excluded.has(row.id)) continue;
    const other = bank.get(row.transferId);
    const owner = other?.parent ?? other?.row ?? null;
    if (!owner) {
      payments.set(row.id, { id: row.id, kind: "transfer", date: row.date, amountMinor: row.amount, row, loanRows: [row], sideUnknown: true });
      continue;
    }
    if (excluded.has(owner.id)) continue;
    const existing = payments.get(owner.id);
    if (existing) { existing.loanRows.push(row); continue; }
    if (other?.parent) {
      const split = readSplit(other.parent, loanIds);
      payments.set(owner.id, { id: owner.id, kind: split ? "split" : "transfer", date: owner.date, amountMinor: Math.abs(owner.amount), row: owner, loanRows: [row], ...(split ? { split } : {}) });
    } else {
      payments.set(owner.id, { id: owner.id, kind: "transfer", date: owner.date, amountMinor: Math.abs(owner.amount), row: owner, loanRows: [row] });
    }
  }
  if (input.rules.length) {
    for (const row of input.bankRows) {
      // A payment already split in Actual belongs to whatever its lines say (another loan, say), never to a rule.
      if (row.accountId === loanId || row.amount >= 0 || row.transferId || row.isChild || row.isParent || row.date <= from || payments.has(row.id) || excluded.has(row.id) || isPostingMarker(row.importedId)) continue;
      if (input.rules.some((rule) => ruleMatches(rule, ruleRow(row)))) payments.set(row.id, { id: row.id, kind: "rule", date: row.date, amountMinor: Math.abs(row.amount), row, loanRows: [] });
    }
  }
  return [...payments.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

type Allocation = { interestMinor: number; principalMinor: number; balanceAfterMinor: number; unpaidInterestMinor: number };

/** Interest from what really happened. Falls back to the contract's figures for a loan without daily interest. */
class Allocator {
  private allocator: ObservedRepaymentAllocator | null;
  balanceMinor: number;
  constructor(private model: LoanModelSnapshot, opening: { date: string; principalMinor: number; accruedInterestMinor?: number }) {
    this.balanceMinor = opening.principalMinor;
    const created = createObservedRepaymentAllocator({ model, opening });
    this.allocator = created.ok ? created.allocator : null;
  }
  get daily() { return this.allocator !== null; }
  private take(row: AllocatedRepayment): Allocation {
    this.balanceMinor = row.balanceAfterMinor;
    return { interestMinor: row.interestMinor, principalMinor: row.principalMinor, balanceAfterMinor: row.balanceAfterMinor, unpaidInterestMinor: row.unpaidInterestMinor ?? 0 };
  }
  repayment(due: Due, paidDate: string, amountMinor: number, appliedInterestMinor?: number): Allocation | null {
    if (!this.allocator) {
      // Per-period interest: the schedule's interest, the rest is principal.
      const interest = appliedInterestMinor ?? due.interestMinor;
      const principal = Math.max(0, Math.min(this.balanceMinor, amountMinor - interest - due.feesMinor));
      this.balanceMinor -= principal;
      return { interestMinor: interest, principalMinor: principal, balanceAfterMinor: this.balanceMinor, unpaidInterestMinor: Math.max(0, interest - amountMinor) };
    }
    const pushed = this.allocator.push({ dueDate: due.date, paidDate, amountMinor, feesMinor: due.feesMinor <= amountMinor ? due.feesMinor : 0, ...(appliedInterestMinor !== undefined ? { appliedInterestMinor } : {}) });
    if (!pushed.ok) return null;
    // A payment beyond what is owed pays the loan off: its principal stops at the balance and the rest is interest.
    if (pushed.row.balanceAfterMinor < 0) {
      const over = -pushed.row.balanceAfterMinor;
      return this.take({ ...pushed.row, principalMinor: pushed.row.principalMinor - over, interestMinor: pushed.row.interestMinor + over, balanceAfterMinor: 0 });
    }
    return this.take(pushed.row);
  }
  extra(date: string, amountMinor: number): void {
    if (!this.allocator) { this.balanceMinor = Math.max(0, this.balanceMinor - amountMinor); return; }
    const pushed = this.allocator.push({ dueDate: date, paidDate: date, amountMinor: Math.min(amountMinor, this.balanceMinor), extra: true });
    if (pushed.ok) this.balanceMinor = pushed.row.balanceAfterMinor;
  }
  /** Interest accrued since the last payment up to `date` (as a payment on that day would carry). */
  accruedTo(date: string): number {
    if (!this.allocator) return 0;
    const peek = this.allocator.preview({ dueDate: date, paidDate: date, amountMinor: Math.floor(Number.MAX_SAFE_INTEGER / 4) });
    return peek.ok ? peek.row.interestMinor : 0;
  }
  /** Something that changes the balance without being a repayment (a draw, a capitalized fee, a restart): carry on from there. */
  reset(date: string, principalMinor: number): Allocator {
    return new Allocator(this.model, { date, principalMinor, accruedInterestMinor: this.accruedTo(date) });
  }
}

const NOTE_OPENING = "Opening adjustment";

/** What building a write needs to know about the loan. */
export function proposalContext(debt: TrackingDebt, accounts: ProposalContext["accounts"], transferPayeeByAccount: ProposalContext["transferPayeeByAccount"]): ProposalContext {
  return {
    budgetSyncId: debt.budgetSyncId, debtId: debt.id, liabilityAccountId: debt.liabilityAccountId, accounts, transferPayeeByAccount,
    loanPaymentCategoryId: debt.loanPaymentCategoryId, interestCategoryId: debt.interestCategoryId, feeCategoryId: debt.feeCategoryId,
    principalNoteSuffix: debt.principalNoteSuffix, interestNoteSuffix: debt.interestNoteSuffix,
  };
}

export function planTracking(input: TrackingInput): TrackingResult {
  const { debt, model, today } = input;
  const digits = model.currency.minorDigits;
  const money = (minor: number) => fmt(minor, digits);
  const schedule = contractSchedule(model, addDays(today, 800));
  if (!schedule.ok) return { ok: false, message: `The loan cannot be calculated: ${schedule.message}` };
  const dues = schedule.dues;
  const start = dues.find((d) => d.date >= debt.trackingStartDueDate);
  if (!start) return { ok: false, message: "The tracking start is after the loan's last installment." };
  const previous = dues[start.no - 2] ?? null;
  const calculatedOpening = { date: previous?.date ?? model.terms.openingDate, principalMinor: previous ? previous.balanceAfterMinor : model.terms.openingPrincipalMinor };
  const statement = input.openingStatement && input.openingStatement.date <= start.date ? input.openingStatement : null;
  const opening = statement ? { date: statement.date, principalMinor: statement.principalMinor } : calculatedOpening;
  const windowFrom = calculatedOpening.date;

  // ── The loan account, classified ──
  const loanRows = [...input.loanRows].filter((r) => !r.isChild).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const entries = new Map(input.entries.map((e) => [e.actualTransactionId, e]));

  // What a row that adds to the debt is, when the user hasn't said: the loan arriving (a transfer near the loan's start),
  // an opening balance, or a later draw or charge. The Loan Ledger shows the same suggestions.
  const loanStart = model.terms.openingDate;
  const firstNonTransferDebt = loanRows.find((r) => r.amount < 0 && !r.transferId && !isPostingMarker(r.importedId));
  const isStartingBalance = (r: SyncSourceTransaction) => !r.transferId && (r.payeeName ?? "").trim().toLowerCase() === "starting balance";
  const suggestedDebtType = (r: SyncSourceTransaction): EntryType => r.transferId
    ? (Math.abs(daysBetween(loanStart, r.date)) <= 31 ? "loan-received" : "draw")
    : isStartingBalance(r) || (r === firstNonTransferDebt && r.date <= start.date) ? "opening-balance"
      : debt.representation === "lender-charged" ? "interest-charged" : "unclassified";
  // The row that brings the loan into the account, on or before the first tracked installment: part of the opening
  // position, never a draw in the tracked period (else the loan would be counted twice).
  const isOpeningRow = (r: SyncSourceTransaction) => {
    if (r.amount >= 0 || r.date > start.date || isPostingMarker(r.importedId)) return false;
    const type = entries.get(r.id)?.entryType ?? suggestedDebtType(r);
    return type === "loan-received" || type === "opening-balance";
  };

  // ── Payments, lined up against the installments ──
  const payments = findPayments(input, windowFrom);
  const byId = new Map(payments.map((p) => [p.id, p]));
  const paymentOfRow = new Map<string, string>();
  for (const p of payments) { paymentOfRow.set(p.id, p.id); for (const r of p.loanRows) paymentOfRow.set(r.id, p.id); }
  const tracked = dues.filter((d) => d.no >= start.no);
  const shownUpcoming = new Set(tracked.filter((d) => d.date > today).slice(0, UPCOMING_SHOWN).map((d) => d.date));
  const aligned = tracked.filter((d) => d.date <= today || shownUpcoming.has(d.date));
  const pins: AlignPin[] = input.entries.flatMap((e) => {
    const paymentId = e.installmentDueDate ? paymentOfRow.get(e.actualTransactionId) : undefined;
    return paymentId && aligned.some((d) => d.date === e.installmentDueDate) ? [{ key: e.installmentDueDate!, paymentId }] : [];
  });
  const alignment = alignPayments(
    { dues: aligned.map((d) => ({ key: d.date, date: d.date, expectedMinor: d.scheduledMinor, upcoming: d.date > today })), payments: payments.map((p) => ({ id: p.id, date: p.date, amountMinor: p.amountMinor })), pins },
    { toleranceMinor: debt.toleranceMinor, formatMinor: money },
  );
  const pairOf = new Map(alignment.dues.map((d) => [d.key, d]));
  const paidBy = new Map(alignment.dues.flatMap((d) => (d.payment ? [[d.payment.id, d.key] as const] : [])));
  // Only money that reached the loan account is extra principal; a payment a rule found but no installment took is
  // just something the rule matched (it never touched this loan).
  const extraPayments = alignment.extras.map((e) => byId.get(e.id)!).filter((p) => p && p.kind !== "rule");

  // Ledger events in the tracked window that change the balance without being an installment.
  const userType = (r: SyncSourceTransaction) => entries.get(r.id)?.entryType;
  const balanceEvents = loanRows.filter((r) => r.date > windowFrom && r.amount < 0 && r.date <= today && !isOpeningRow(r)).flatMap((r) => {
    const type = userType(r) ?? (r.transferId ? "draw" : debt.representation === "lender-charged" ? "interest-charged" : isPostingMarker(r.importedId) ? "adjustment" : null);
    return type === "draw" || type === "fee" || type === "interest-charged" || type === "adjustment" || type === "loan-received" ? [{ date: r.date, amountMinor: -r.amount, kind: type, row: r }] : [];
  });
  const positiveAdjustments = loanRows.filter((r) => r.date > windowFrom && r.amount > 0 && r.date <= today && !r.transferId && (isPostingMarker(r.importedId) || userType(r) === "adjustment") && !paymentOfRow.has(r.id));

  // Actual's balance before the first tracked installment. Each row counts once: in the opening position, or in the
  // tracked period walked below (a payment for a tracked installment made before its due date, a draw, a charge).
  const walked = new Set([...paymentOfRow.keys(), ...balanceEvents.map((b) => b.row.id), ...positiveAdjustments.map((a) => a.id)]);
  const actualAtStart = -loanRows.filter((r) => (r.date < start.date || isOpeningRow(r)) && !walked.has(r.id)).reduce((sum, r) => sum + r.amount, 0);

  // ── Walk the tracked window in date order ──
  const ctx = proposalContext(debt, input.accounts, input.transferPayeeByAccount);
  let calc = new Allocator(model, opening);
  // The calculated balance today: upcoming installments are planned after it, without changing it.
  let calculatedToday = opening.principalMinor;
  // Actual's own principal for recorded installments, to tell where Actual and the calculation part ways.
  let actualPrincipal = opening.principalMinor;
  let driftFlagged = false;
  type Step = { date: string; order: number; run: () => void };
  const steps: Step[] = [];
  const installments: Installment[] = [];
  const events: Extract<TrackingResult, { ok: true }>["events"] = [];
  for (const e of extraPayments) {
    if (e.date > today) continue;
    steps.push({ date: e.date, order: 1, run: () => { calc.extra(e.date, e.amountMinor); actualPrincipal -= e.amountMinor; events.push({ date: e.date, kind: "extra-principal", amountMinor: e.amountMinor, rowId: e.loanRows[0]?.id ?? e.id }); } });
  }
  for (const b of balanceEvents) {
    steps.push({ date: b.date, order: 0, run: () => {
      const increase = b.kind === "interest-charged" ? 0 : b.amountMinor; // charged interest is paid by the repayments, not principal
      calc = calc.reset(b.date, calc.balanceMinor + increase); actualPrincipal += increase;
      events.push({ date: b.date, kind: b.kind === "loan-received" ? "draw" : b.kind, amountMinor: b.amountMinor, rowId: b.row.id });
    } });
  }
  for (const a of positiveAdjustments) {
    steps.push({ date: a.date, order: 0, run: () => { calc = calc.reset(a.date, Math.max(0, calc.balanceMinor - a.amount)); actualPrincipal -= a.amount; events.push({ date: a.date, kind: "adjustment", amountMinor: -a.amount, rowId: a.id }); } });
  }
  // A restart on the day of a recorded installment settles that installment (Actual accepted from there).
  const anchorOn = new Map<string, number>();
  for (const anchor of input.anchors ?? []) {
    if (anchor.date <= windowFrom || anchor.date > today) continue;
    anchorOn.set(anchor.date, anchor.principalMinor);
    steps.push({ date: anchor.date, order: 3, run: () => { calc = calc.reset(anchor.date, anchor.principalMinor); actualPrincipal = anchor.principalMinor; driftFlagged = false; } });
  }
  for (const due of tracked) {
    if (due.date > today && !shownUpcoming.has(due.date)) break;
    const pair = pairOf.get(due.date);
    const payment = pair?.payment ? byId.get(pair.payment.id) ?? null : null;
    // Recorded and planned splits run in the order the money moved.
    steps.push({ date: payment?.date ?? due.date, order: 2, run: () => installments.push(planInstallment(due, payment, pair?.reasons.some((r) => r.code === "another-candidate") ?? false)) });
  }
  steps.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  function planInstallment(due: Due, payment: Payment | null, competing: boolean): Installment {
    const base = { no: due.no, dueDate: due.date, scheduledMinor: due.scheduledMinor, payment, feesMinor: 0, proposal: null, note: null } as const;
    if (!payment) {
      const upcoming = due.date > today;
      const missing = !upcoming && addDays(due.date, debt.missingGraceDays) < today;
      if (upcoming) {
        // Planned as paid on its due date for the scheduled amount, after everything that really happened.
        const planned = calc.repayment(due, due.date, due.scheduledMinor);
        return { ...base, status: "upcoming", principalMinor: planned?.principalMinor ?? due.principalMinor, interestMinor: planned?.interestMinor ?? due.interestMinor, calculatedInterestMinor: planned?.interestMinor ?? due.interestMinor, balanceAfterMinor: calc.balanceMinor, note: null };
      }
      const peek = calc.daily ? calc.accruedTo(due.date) : due.interestMinor;
      return { ...base, status: missing ? "missing" : "upcoming", principalMinor: due.principalMinor, interestMinor: peek, calculatedInterestMinor: peek, balanceAfterMinor: calc.balanceMinor, note: missing ? `No payment found by ${addDays(due.date, debt.missingGraceDays)}.` : "Due; waiting for the payment." };
    }
    // A split already in Actual: recorded as it is, unless Actual's balance has drifted from the calculation.
    if (payment.kind === "split" && payment.split) {
      const pure = calc.repayment(due, payment.date, payment.amountMinor);
      const calculatedInterest = pure?.interestMinor ?? due.interestMinor;
      actualPrincipal -= payment.split.principalMinor;
      const accepted = anchorOn.get(payment.date);
      if (accepted !== undefined) { calc = calc.reset(payment.date, accepted); actualPrincipal = accepted; driftFlagged = false; }
      const drift = actualPrincipal - calc.balanceMinor;
      const drifting = !driftFlagged && Math.abs(drift) > debt.toleranceMinor;
      if (drifting) driftFlagged = true;
      return {
        ...base, status: drifting ? "check" : "recorded", principalMinor: payment.split.principalMinor, interestMinor: payment.split.interestMinor, feesMinor: payment.split.feesMinor,
        calculatedInterestMinor: calculatedInterest, balanceAfterMinor: calc.balanceMinor,
        ...(drifting ? { checkKind: "drift" as const, note: `From here Actual's loan balance differs from the calculation by ${money(Math.abs(drift))}. If your lender works out interest another way (monthly rather than daily, say), set the calculation method in Terms & Schedule. Otherwise accept Actual's balance from here, or adjust this split to the calculation.` } : {}),
      };
    }
    const allocated = calc.repayment(due, payment.date, payment.amountMinor);
    if (!allocated) return { ...base, status: "check", checkKind: "cannot-split", principalMinor: 0, interestMinor: 0, calculatedInterestMinor: 0, balanceAfterMinor: calc.balanceMinor, note: "Bench could not work out this payment's interest. Check the loan's terms." };
    // For drift, an installment still to record counts as its planned principal: its own write will set Actual right,
    // so only splits already in Actual can part Actual from the calculation.
    actualPrincipal -= allocated.principalMinor;
    const figures = { principalMinor: allocated.principalMinor, interestMinor: allocated.interestMinor, calculatedInterestMinor: allocated.interestMinor, balanceAfterMinor: allocated.balanceAfterMinor };
    const check = (checkKind: NonNullable<Installment["checkKind"]>, note: string): Installment => ({ ...base, ...figures, status: "check", checkKind, note });
    if (competing && !pins.some((p) => p.key === due.date)) {
      const alternatives = extraPayments.filter((e) => Math.abs(daysBetween(e.date, due.date)) <= 20 && Math.abs(e.amountMinor - due.scheduledMinor) <= Math.max(debt.toleranceMinor, due.scheduledMinor / 20));
      if (alternatives.length) return { ...check("competing", `${alternatives.length + 1} payments could be this installment. Choose the one that pays it.`), alternatives };
    }
    if (payment.sideUnknown) return check("side-unknown", "Bench can't see where this transfer was paid from. Refresh, or check the transfer in Actual.");
    if (allocated.unpaidInterestMinor > 0) return check("short", `This payment doesn't cover the interest owed (${money(allocated.interestMinor + allocated.unpaidInterestMinor)}). In Actual, give it the interest category; the rest is carried to the next installment.`);
    // Interest-free (or nothing accrued): a whole transfer is already right.
    if (allocated.interestMinor === 0 && due.feesMinor === 0) {
      if (payment.kind === "transfer") return { ...base, ...figures, status: "recorded" };
      const converted = convertProposal(ctx, payment.row, due.date);
      return "ok" in converted ? check("cannot-split", converted.reason) : { ...base, ...figures, status: "unrecorded", proposal: converted };
    }
    if (allocated.principalMinor === 0) return check("interest-only", "This payment is interest only. In Actual, give it the interest category instead of a transfer to the loan.");
    if (payment.row.reconciled) return check("reconciled", "The payment is reconciled in Actual. Unlock it there to let Bench split it.");
    let loanSide: SyncSourceTransaction | null = null;
    if (payment.kind === "transfer") {
      loanSide = payment.loanRows[0] ?? null;
      const problems = loanSide ? untouchedCounterpartProblems({ id: payment.row.id, amount: payment.row.amount, date: payment.row.date, notes: payment.row.notes ?? null }, {
        id: loanSide.id, accountId: loanSide.accountId, date: loanSide.date, amount: loanSide.amount, payeeId: loanSide.payeeId, categoryId: loanSide.categoryId, notes: loanSide.notes ?? null,
        reconciled: loanSide.reconciled, transferId: loanSide.transferId ?? null, isParent: loanSide.isParent, isChild: loanSide.isChild, parentId: loanSide.parentId, childCount: loanSide.splitLines.length,
        cleared: loanSide.cleared, importedId: loanSide.importedId ?? null, importedPayee: loanSide.importedPayee ?? null,
      }, input.transferPayeeByAccount[payment.row.accountId] ?? "") : ["it is missing"];
      if (problems.length) return check("loan-side-changed", `The loan-side row of this transfer was changed in Actual (${problems.join("; ")}). Splitting would replace it; undo those edits in Actual first.`);
    }
    const proposal = splitProposal(ctx, payment.row, { interestMinor: allocated.interestMinor, feesMinor: due.feesMinor <= payment.amountMinor - allocated.interestMinor ? due.feesMinor : 0 }, { dueDate: due.date, loanSide });
    if ("ok" in proposal) return check("cannot-split", proposal.reason);
    return { ...base, ...figures, feesMinor: due.feesMinor, status: "unrecorded", proposal };
  }

  let anchorDate = opening.date;
  for (const step of steps) {
    step.run();
    if (step.date <= today) { calculatedToday = calc.balanceMinor; anchorDate = step.date; }
  }
  installments.sort((a, b) => a.no - b.no);

  // A missed installment paid together with the next one is covered.
  for (let i = 0; i < installments.length - 1; i++) {
    const current = installments[i];
    const next = installments[i + 1];
    if (current.status === "missing" && next.payment && pairOf.get(next.dueDate)?.reasons.some((r) => r.code === "covers-missed")) {
      installments[i] = { ...current, status: next.status === "recorded" ? "recorded" : next.status, note: `Paid with installment ${next.no}.` };
    }
  }

  // ── The opening adjustment ──
  const openingDifference = actualAtStart - opening.principalMinor;
  const adjustmentKey = start.date;
  const alreadyAdjusted = loanRows.some((r) => r.importedId === adjustmentMarker(ctx, adjustmentKey));
  const openingAdjustment = !alreadyAdjusted && Math.abs(openingDifference) > debt.toleranceMinor
    ? adjustmentProposal(ctx, { date: addDays(start.date, -1), ledgerAmountMinor: openingDifference, notes: NOTE_OPENING, key: adjustmentKey })
    : null;

  // ── The ledger ──
  const installmentOfPayment = new Map(installments.flatMap((i) => (i.payment ? [[i.payment.id, i] as const] : [])));
  let running = 0;
  const ledger: LedgerRow[] = loanRows.map((row) => {
    running += row.amount;
    const entry = entries.get(row.id);
    const paymentId = paymentOfRow.get(row.id);
    const installment = paymentId ? installmentOfPayment.get(paymentId) ?? null : null;
    const benchMade = isPostingMarker(row.importedId);
    let suggestion: EntryType;
    if (benchMade) suggestion = "adjustment";
    else if (row.amount < 0) suggestion = suggestedDebtType(row);
    else if (row.amount > 0) {
      if (row.transferId) suggestion = paymentId && paidBy.has(paymentId) ? "principal-repayment" : row.date > windowFrom ? "extra-principal" : "principal-repayment";
      else suggestion = "unclassified";
    } else suggestion = "unclassified";
    const type: EntryType = entry && entry.entryType !== "not-repayment" ? entry.entryType : suggestion;
    const whole = installment && installment.status === "unrecorded" && installment.payment?.kind === "transfer" ? installment.interestMinor : null;
    return { row, type, suggested: !entry && !benchMade && suggestion !== "unclassified", installment: installment?.no ?? null, includesInterestMinor: whole, benchMade, runningMinor: running, entryRevision: entry?.revision ?? 0 };
  });

  // ── Figures ──
  const owed = -loanRows.filter((r) => r.date <= today).reduce((sum, r) => sum + r.amount, 0);
  const counts: Record<InstallmentStatus, number> = { recorded: 0, unrecorded: 0, check: 0, missing: 0, upcoming: 0 };
  for (const i of installments) counts[i.status]++;
  const year = today.slice(0, 4);
  const next = tracked.find((d) => d.date > today) ?? null;
  return {
    ok: true,
    opening: { ...opening, source: statement ? "statement" : "calculated", actualMinor: actualAtStart, differenceMinor: openingDifference },
    before: { count: start.no - 1, firstDueDate: dues[0]?.date ?? null, lastDueDate: previous?.date ?? null },
    openingAdjustment,
    anchor: { date: anchorDate, principalMinor: calculatedToday, scheduledPaymentMinor: (tracked.find((d) => d.date > today) ?? tracked.at(-1) ?? start).scheduledMinor },
    installments,
    ledger,
    events,
    figures: {
      owedInActualMinor: owed,
      calculatedMinor: calculatedToday,
      differenceMinor: owed - calculatedToday,
      nextPayment: next ? { dueDate: next.date, no: next.no, amountMinor: next.scheduledMinor } : null,
      counts,
      interestThisYearMinor: installments.filter((i) => (i.status === "recorded" || i.status === "unrecorded") && (i.payment?.date ?? i.dueDate).startsWith(year)).reduce((sum, i) => sum + i.interestMinor, 0),
    },
  };
}
