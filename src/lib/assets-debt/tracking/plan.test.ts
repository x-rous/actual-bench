import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { SIMULATOR_DEFAULT_PROFILE } from "@/features/assets-debt/lib/simulatorModel";
import { planTracking, type TrackingInput } from "./plan";
import { lineNotes } from "./proposals";

/** LS Full Mortgage: 500,000 at 5.4% over 20 years from 15 Jan 2024, repaid on the 15th. */
function model(overrides: Partial<{ principal: number; rate: string; opening: string; first: string; months: number }> = {}): LoanModelSnapshot {
  const o = { principal: 500_000_00, rate: "0.054", opening: "2024-01-15", first: "2024-02-15", months: 240, ...overrides };
  return {
    debtId: "d1", revision: 1, currency: { code: "USD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
    terms: { openingDate: o.opening, openingPrincipalMinor: o.principal, maturityDate: "2044-01-15", contractualTermMonths: o.months, amortizationTermMonths: o.months, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: o.first, firstInterestChargeDate: o.first },
    profile: SIMULATOR_DEFAULT_PROFILE, rates: [{ accrualEffectiveFrom: o.opening, annualRateDecimal: o.rate }],
    phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
  } as unknown as LoanModelSnapshot;
}

let seq = 0;
function tx(t: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "accountId" | "date" | "amount">): SyncSourceTransaction {
  return { id: `t${++seq}`, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...t };
}

/** A whole transfer from checking into the loan account: both legs. */
function transfer(date: string, amount: number, from = "checking"): { bank: SyncSourceTransaction; loan: SyncSourceTransaction } {
  const bank = tx({ accountId: from, date, amount: -amount, payeeId: "p-loan", payeeName: "LS Mortgage" });
  const loan = tx({ accountId: "loan", date, amount, payeeId: `p-${from}`, payeeName: from, transferId: bank.id });
  bank.transferId = loan.id;
  return { bank, loan };
}

const accounts = [
  { id: "loan", name: "LS Mortgage", offBudget: true, closed: false },
  { id: "checking", name: "LS Checking", offBudget: false, closed: false },
  { id: "savings", name: "LS Savings", offBudget: false, closed: false },
];

function input(rows: { loan: SyncSourceTransaction[]; bank: SyncSourceTransaction[] }, over: Partial<TrackingInput> & { start?: string } = {}): TrackingInput {
  return {
    debt: {
      id: "d1", budgetSyncId: "b1", liabilityAccountId: "loan", trackingStartDueDate: over.start ?? "2024-02-15", representation: "split",
      loanPaymentCategoryId: "cat-loan", interestCategoryId: "cat-interest", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "#interest", toleranceMinor: 100, missingGraceDays: 5,
    },
    model: model(), today: "2024-05-20", accounts, transferPayeeByAccount: { loan: "p-loan", checking: "p-checking", savings: "p-savings" },
    loanRows: rows.loan, bankRows: rows.bank, entries: [], rules: [],
    ...over,
  };
}

const received = () => { const t = transfer("2024-01-15", -500_000_00); return { loan: t.loan, bank: t.bank }; };

describe("planTracking", () => {
  it("B1: whole transfers become Unrecorded splits whose lines add up to the payment; the loan received is classified", () => {
    const r = received();
    const pays = ["2024-02-15", "2024-03-15", "2024-04-15", "2024-05-15"].map((d) => transfer(d, 3_411_26));
    const result = planTracking(input({ loan: [r.loan, ...pays.map((p) => p.loan)], bank: [r.bank, ...pays.map((p) => p.bank)] }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments.slice(0, 4).map((i) => i.status)).toEqual(["unrecorded", "unrecorded", "unrecorded", "unrecorded"]);
    const first = result.installments[0];
    expect(first.principalMinor + first.interestMinor).toBe(3_411_26);
    expect(first.proposal?.kind).toBe("split");
    const out = first.proposal!.output;
    if (out.kind !== "restructure") throw new Error("expected a split");
    expect(out.operations.map((c) => [c.economicKind, c.transferAccountId, c.categoryId])).toEqual([["principal", "loan", "cat-loan"], ["interest", null, "cat-interest"]]);
    expect(out.operations.reduce((s, c) => s + c.amountMinor, 0)).toBe(-3_411_26);
    expect(out.replacesCounterpart?.id).toBe(pays[0].loan.id);
    expect(result.ledger[0]).toMatchObject({ type: "loan-received", suggested: true });
    expect(result.ledger[1]).toMatchObject({ type: "principal-repayment", installment: 1, includesInterestMinor: first.interestMinor });
    // Owed in Actual is lower than the calculation by the interest still inside the transfers.
    const interest = result.installments.slice(0, 4).reduce((s, i) => s + i.interestMinor, 0);
    expect(result.figures.differenceMinor).toBe(-interest);
    expect(result.figures.counts).toMatchObject({ unrecorded: 4, upcoming: 3 });
    expect(result.openingAdjustment).toBeNull();
  });

  it("C1: an extra transfer is Extra principal at once and lowers the next installment's interest", () => {
    const r = received();
    const pays = ["2024-02-15", "2024-03-15"].map((d) => transfer(d, 3_411_26));
    const extra = transfer("2024-02-20", 20_000_00);
    const without = planTracking(input({ loan: [r.loan, ...pays.map((p) => p.loan)], bank: [r.bank, ...pays.map((p) => p.bank)] }, { today: "2024-03-20" }));
    const withExtra = planTracking(input({ loan: [r.loan, extra.loan, ...pays.map((p) => p.loan)], bank: [r.bank, extra.bank, ...pays.map((p) => p.bank)] }, { today: "2024-03-20" }));
    if (!without.ok || !withExtra.ok) throw new Error("not ok");
    expect(withExtra.ledger.find((l) => l.row.id === extra.loan.id)).toMatchObject({ type: "extra-principal", suggested: true, installment: null });
    expect(withExtra.events).toEqual([expect.objectContaining({ kind: "extra-principal", amountMinor: 20_000_00 })]);
    expect(withExtra.installments[1].interestMinor).toBeLessThan(without.installments[1].interestMinor);
    expect(withExtra.installments[0].status).toBe("unrecorded");
  });

  it("B2: a payment already split in Actual is Recorded with no write; a few units of interest difference are not a task", () => {
    const r = received();
    const plain = planTracking(input({ loan: [r.loan, transfer("2024-02-15", 3_411_26).loan], bank: [r.bank] }, { today: "2024-02-20" }));
    if (!plain.ok) throw new Error(plain.message);
    const calcInterest = plain.installments[0].interestMinor;
    const actualInterest = calcInterest + 37; // the user's own figure, 0.37 off
    const parent = tx({ accountId: "checking", date: "2024-02-15", amount: -3_411_26, isParent: true });
    const loanSide = tx({ accountId: "loan", date: "2024-02-15", amount: 3_411_26 - actualInterest, transferId: "line-p" });
    parent.splitLines = [
      { id: "line-p", amount: -(3_411_26 - actualInterest), payeeId: "p-loan", payeeName: null, categoryId: "cat-loan", categoryName: null, notes: null, transferId: loanSide.id },
      { id: "line-i", amount: -actualInterest, payeeId: null, payeeName: null, categoryId: "cat-interest", categoryName: null, notes: null, transferId: null },
    ];
    const result = planTracking(input({ loan: [r.loan, loanSide], bank: [r.bank, parent] }, { today: "2024-02-20" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments[0]).toMatchObject({ status: "recorded", interestMinor: actualInterest, calculatedInterestMinor: calcInterest, proposal: null });
    expect(result.figures.counts.check).toBe(0);
  });

  it("A4: tracking part-way assumes earlier installments paid, offers one opening adjustment, and never reports them missing", () => {
    const opening = tx({ accountId: "loan", date: "2026-01-01", amount: -400_000_00, payeeName: "Starting Balance" });
    const result = planTracking(input({ loan: [opening], bank: [] }, { start: "2026-01-15", today: "2026-01-10" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.before.count).toBe(23);
    expect(result.installments.every((i) => i.status === "upcoming")).toBe(true);
    expect(result.ledger[0]).toMatchObject({ type: "opening-balance" });
    const calculated = result.opening.principalMinor;
    expect(result.opening).toMatchObject({ source: "calculated", actualMinor: 400_000_00, differenceMinor: 400_000_00 - calculated });
    const adjustment = result.openingAdjustment!.output;
    if (adjustment.kind !== "create") throw new Error("expected a create");
    expect(adjustment.operations[0]).toMatchObject({ accountId: "loan", date: "2026-01-14", amountMinor: 400_000_00 - calculated, categoryId: null, notes: "Opening adjustment" });
    // Applied, the adjustment is recognised by its marker and not offered again.
    const applied = tx({ accountId: "loan", date: "2026-01-14", amount: 400_000_00 - calculated, importedId: adjustment.operations[0].importedId });
    const again = planTracking(input({ loan: [opening, applied], bank: [] }, { start: "2026-01-15", today: "2026-01-10" }));
    if (!again.ok) throw new Error(again.message);
    expect(again.openingAdjustment).toBeNull();
    expect(again.ledger.find((l) => l.row.id === applied.id)).toMatchObject({ type: "adjustment", benchMade: true });
  });

  it("A4 with a statement: the lender's balance is the opening position", () => {
    const opening = tx({ accountId: "loan", date: "2026-01-01", amount: -456_789_00, payeeName: "Starting Balance" });
    const result = planTracking(input({ loan: [opening], bank: [] }, { start: "2026-01-15", today: "2026-01-10", openingStatement: { date: "2026-01-01", principalMinor: 456_789_00 } }));
    if (!result.ok) throw new Error(result.message);
    expect(result.opening).toMatchObject({ source: "statement", principalMinor: 456_789_00, differenceMinor: 0 });
    expect(result.openingAdjustment).toBeNull();
  });

  it("B3: a payment a rule finds is split too, creating the principal transfer the loan account never had", () => {
    const pay = tx({ accountId: "checking", date: "2024-02-15", amount: -3_411_26, payeeId: "bank", payeeName: "LS Mortgage Bank", categoryId: "cat-mortgage", notes: "Feb" });
    const other = tx({ accountId: "checking", date: "2024-02-16", amount: -3_411_26, payeeId: "grocer" });
    const result = planTracking(input({ loan: [], bank: [pay, other] }, { today: "2024-02-20", rules: [{ match: "all", conditions: [{ field: "account", operator: "equals", value: "checking" }, { field: "payee", operator: "equals", value: "bank" }] }] }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments[0]).toMatchObject({ status: "unrecorded", payment: { id: pay.id, kind: "rule" } });
    const out = result.installments[0].proposal!.output;
    if (out.kind !== "restructure") throw new Error("expected a split");
    expect(out.replacesCounterpart).toBeUndefined();
    expect(out.operations.map((c) => c.notes)).toEqual(["Feb", "Feb #interest"]);
  });

  it("Missing: no payment after the grace days; still waiting within them", () => {
    const r = received();
    const result = planTracking(input({ loan: [r.loan], bank: [r.bank] }, { today: "2024-03-18" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments[0].status).toBe("missing");
    expect(result.installments[1]).toMatchObject({ status: "upcoming", note: "Due; waiting for the payment." });
  });

  it("D4: an interest-free loan's transfers are already right; a payment found by a rule becomes a transfer", () => {
    const zero = model({ rate: "0", principal: 12_000_00, months: 12 });
    const t = transfer("2024-02-15", 1_000_00);
    const ruleFound = tx({ accountId: "checking", date: "2024-03-15", amount: -1_000_00, payeeId: "family" });
    const result = planTracking(input({ loan: [t.loan], bank: [t.bank, ruleFound] }, { model: zero, today: "2024-03-20", rules: [{ match: "all", conditions: [{ field: "payee", operator: "equals", value: "family" }] }] }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments[0]).toMatchObject({ status: "recorded", interestMinor: 0 });
    expect(result.installments[1]).toMatchObject({ status: "unrecorded", proposal: { kind: "convert" } });
  });

  it("Check: a reconciled payment or an edited loan-side row is never rewritten", () => {
    const r = received();
    const reconciled = transfer("2024-02-15", 3_411_26); reconciled.bank.reconciled = true;
    const edited = transfer("2024-03-15", 3_411_26); edited.loan.notes = "changed";
    const result = planTracking(input({ loan: [r.loan, reconciled.loan, edited.loan], bank: [r.bank, reconciled.bank, edited.bank] }, { today: "2024-03-20" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments[0]).toMatchObject({ status: "check", checkKind: "reconciled", proposal: null });
    expect(result.installments[1]).toMatchObject({ status: "check", checkKind: "loan-side-changed", proposal: null });
  });

  it("the user's decisions win: a row marked not a repayment is ignored, and a chosen payment pays its installment", () => {
    const r = received();
    const a = transfer("2024-02-14", 3_411_26);
    const b = transfer("2024-02-16", 3_411_26);
    const base = input({ loan: [r.loan, a.loan, b.loan], bank: [r.bank, a.bank, b.bank] }, { today: "2024-02-25" });
    const competing = planTracking(base);
    if (!competing.ok) throw new Error(competing.message);
    expect(competing.installments[0]).toMatchObject({ status: "check", checkKind: "competing" });
    const chosen = planTracking({ ...base, entries: [{ actualTransactionId: b.loan.id, actualAccountId: "loan", entryType: "principal-repayment", installmentDueDate: "2024-02-15", revision: 1, updatedAt: "t" }, { actualTransactionId: a.bank.id, actualAccountId: "checking", entryType: "not-repayment", installmentDueDate: null, revision: 1, updatedAt: "t" }] });
    if (!chosen.ok) throw new Error(chosen.message);
    expect(chosen.installments[0]).toMatchObject({ status: "unrecorded", payment: { id: b.bank.id } });
  });

  it("lineNotes adds the loan's text once", () => {
    expect(lineNotes("Mortgage October", "#interest")).toBe("Mortgage October #interest");
    expect(lineNotes("Mortgage #interest", "#interest")).toBe("Mortgage #interest");
    expect(lineNotes(null, "#interest")).toBe("#interest");
    expect(lineNotes("Mortgage", "")).toBe("Mortgage");
  });
});
