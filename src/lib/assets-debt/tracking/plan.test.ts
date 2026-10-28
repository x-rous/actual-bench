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
    expect(result.figures.counts).toMatchObject({ unrecorded: 4, upcoming: 1 });
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

  it("C1b: a transfer the user saved as Extra principal still counts as extra principal", () => {
    const r = received();
    const pays = ["2024-02-15", "2024-03-15"].map((d) => transfer(d, 3_411_26));
    const extra = transfer("2024-02-20", 20_000_00);
    const rows = { loan: [r.loan, extra.loan, ...pays.map((p) => p.loan)], bank: [r.bank, extra.bank, ...pays.map((p) => p.bank)] };
    const suggested = planTracking(input(rows, { today: "2024-03-20" }));
    const saved = planTracking(input(rows, { today: "2024-03-20", entries: [{ actualTransactionId: extra.loan.id, actualAccountId: "loan", entryType: "extra-principal", installmentDueDate: null, revision: 1, updatedAt: "t" }] }));
    if (!suggested.ok || !saved.ok) throw new Error("not ok");
    expect(saved.events).toEqual([expect.objectContaining({ kind: "extra-principal", amountMinor: 20_000_00 })]);
    expect(saved.installments[1].interestMinor).toBe(suggested.installments[1].interestMinor);
  });

  it("C1c: a positive transfer saved as Adjustment is an adjustment, not a repayment or extra principal", () => {
    const r = received();
    const pays = ["2024-02-15", "2024-03-15"].map((d) => transfer(d, 3_411_26));
    const adjust = transfer("2024-02-20", 20_000_00);
    const rows = { loan: [r.loan, adjust.loan, ...pays.map((p) => p.loan)], bank: [r.bank, adjust.bank, ...pays.map((p) => p.bank)] };
    const saved = planTracking(input(rows, { today: "2024-03-20", entries: [{ actualTransactionId: adjust.loan.id, actualAccountId: "loan", entryType: "adjustment", installmentDueDate: null, revision: 1, updatedAt: "t" }] }));
    if (!saved.ok) throw new Error("not ok");
    expect(saved.events.filter((e) => e.kind === "extra-principal")).toEqual([]);
    expect(saved.events).toEqual([expect.objectContaining({ kind: "adjustment", amountMinor: -20_000_00 })]);
    expect(saved.installments.slice(0, 2).map((i) => i.status)).toEqual(["unrecorded", "unrecorded"]);
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

describe("drift", () => {
  function split(date: string, payment: number, interest: number) {
    const parent = tx({ accountId: "checking", date, amount: -payment, isParent: true });
    const loanSide = tx({ accountId: "loan", date, amount: payment - interest, transferId: `${parent.id}-p` });
    parent.splitLines = [
      { id: `${parent.id}-p`, amount: -(payment - interest), payeeId: "p-loan", payeeName: null, categoryId: "cat-loan", categoryName: null, notes: null, transferId: loanSide.id },
      { id: `${parent.id}-i`, amount: -interest, payeeId: null, payeeName: null, categoryId: "cat-interest", categoryName: null, notes: null, transferId: null },
    ];
    return { parent, loanSide };
  }
  it("flags Check once, where Actual's balance first parts from the calculation beyond the tolerance", () => {
    const r = received();
    const base = planTracking(input({ loan: [r.loan], bank: [r.bank] }, { today: "2024-04-20" }));
    if (!base.ok) throw new Error(base.message);
    const a = split("2024-02-15", 3_411_26, base.installments[0].interestMinor);
    const b = split("2024-03-15", 3_411_26, 2_406_51); // 280 more interest than calculated
    const c = split("2024-04-15", 3_411_26, 2_100_00);
    const result = planTracking(input({ loan: [r.loan, a.loanSide, b.loanSide, c.loanSide], bank: [r.bank, a.parent, b.parent, c.parent] }, { today: "2024-04-20" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments.slice(0, 3).map((i) => i.status)).toEqual(["recorded", "check", "recorded"]);
    expect(result.installments[1]).toMatchObject({ checkKind: "drift" });
    // Accepting Actual's balance after the second installment clears it.
    const owedAfter = 500_000_00 - (3_411_26 - base.installments[0].interestMinor) - (3_411_26 - 2_406_51);
    const accepted = planTracking(input({ loan: [r.loan, a.loanSide, b.loanSide, c.loanSide], bank: [r.bank, a.parent, b.parent, c.parent] }, { today: "2024-04-20", anchors: [{ date: "2024-03-15", principalMinor: owedAfter }] }));
    if (!accepted.ok) throw new Error(accepted.message);
    expect(accepted.installments.slice(0, 2).map((i) => i.status)).toEqual(["recorded", "recorded"]);
    expect(accepted.installments[1].balanceAfterMinor).toBe(owedAfter);
  });
});

describe("drift ignores what is still to record", () => {
  it("a whole transfer before a recorded split doesn't make the split drift", () => {
    const r = received();
    const whole = transfer("2024-02-15", 3_411_26);
    const plain = planTracking(input({ loan: [r.loan, whole.loan], bank: [r.bank, whole.bank] }, { today: "2024-03-20" }));
    if (!plain.ok) throw new Error(plain.message);
    const interest = plain.installments[1].interestMinor;
    const parent = tx({ accountId: "checking", date: "2024-03-15", amount: -3_411_26, isParent: true });
    const loanSide = tx({ accountId: "loan", date: "2024-03-15", amount: 3_411_26 - interest, transferId: `${parent.id}-p` });
    parent.splitLines = [
      { id: `${parent.id}-p`, amount: -(3_411_26 - interest), payeeId: "p-loan", payeeName: null, categoryId: "cat-loan", categoryName: null, notes: null, transferId: loanSide.id },
      { id: `${parent.id}-i`, amount: -interest, payeeId: null, payeeName: null, categoryId: "cat-interest", categoryName: null, notes: null, transferId: null },
    ];
    const result = planTracking(input({ loan: [r.loan, whole.loan, loanSide], bank: [r.bank, whole.bank, parent] }, { today: "2024-03-20" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.installments.slice(0, 2).map((i) => i.status)).toEqual(["unrecorded", "recorded"]);
  });
});

it("a split's line returned as its own row still resolves to the split", () => {
  const r = received();
  const parent = tx({ accountId: "checking", date: "2024-02-15", amount: -3_411_26, isParent: true });
  const loanSide = tx({ accountId: "loan", date: "2024-02-15", amount: 1_200_00, transferId: `${parent.id}-p` });
  parent.splitLines = [
    { id: `${parent.id}-p`, amount: -1_200_00, payeeId: "p-loan", payeeName: null, categoryId: "cat-loan", categoryName: null, notes: null, transferId: loanSide.id },
    { id: `${parent.id}-i`, amount: -2_211_26, payeeId: null, payeeName: null, categoryId: "cat-interest", categoryName: null, notes: null, transferId: null },
  ];
  const childRow = tx({ id: `${parent.id}-p`, accountId: "checking", date: "2024-02-15", amount: -1_200_00, isChild: true, parentId: parent.id, transferId: loanSide.id });
  const result = planTracking(input({ loan: [r.loan, loanSide], bank: [r.bank, parent, childRow] }, { today: "2024-02-20" }));
  if (!result.ok) throw new Error(result.message);
  expect(result.installments[0].payment).toMatchObject({ kind: "split", id: parent.id });
});

it("B3: a rule's other matches are neither extra principal nor already-split payments", () => {
  const rule = { match: "all" as const, conditions: [{ field: "payee" as const, operator: "equals" as const, value: "bank" }] };
  const pay = tx({ accountId: "checking", date: "2024-02-15", amount: -3_411_26, payeeId: "bank" });
  const other = tx({ accountId: "checking", date: "2024-02-20", amount: -1_782_11, payeeId: "bank" });
  const splitElsewhere = tx({ accountId: "checking", date: "2024-02-05", amount: -1_782_11, payeeId: "bank", isParent: true, splitLines: [{ id: "x1", amount: -1_000_00, payeeId: "p-car", payeeName: null, categoryId: null, categoryName: null, notes: null, transferId: "car-row" }, { id: "x2", amount: -782_11, payeeId: null, payeeName: null, categoryId: "cat-int", categoryName: null, notes: null, transferId: null }] });
  const withOthers = planTracking(input({ loan: [], bank: [pay, other, splitElsewhere] }, { today: "2024-02-25", rules: [rule] }));
  const alone = planTracking(input({ loan: [], bank: [pay] }, { today: "2024-02-25", rules: [rule] }));
  if (!withOthers.ok || !alone.ok) throw new Error("not ok");
  expect(withOthers.events).toEqual([]);
  expect(withOthers.figures.calculatedMinor).toBe(alone.figures.calculatedMinor);
  expect(withOthers.installments[0]).toMatchObject({ status: "unrecorded", payment: { id: pay.id } });
});

describe("the opening position counts each row once", () => {
  it("a loan paid into the account days after its start date is the opening, not a second draw", () => {
    // The contract starts on 5 Jan; the money reaches the loan account on 15 Jan.
    const r = transfer("2024-01-15", -500_000_00);
    const pay = transfer("2024-02-15", 3_411_26);
    const result = planTracking(input({ loan: [r.loan, pay.loan], bank: [r.bank, pay.bank] }, { model: model({ opening: "2024-01-05" }), today: "2024-02-20" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.opening).toMatchObject({ principalMinor: 500_000_00, actualMinor: 500_000_00, differenceMinor: 0 });
    expect(result.openingAdjustment).toBeNull();
    expect(result.events).toEqual([]);
    expect(result.installments[0]).toMatchObject({ status: "unrecorded", payment: { id: pay.bank.id } });
    expect(result.installments[0].principalMinor).toBeGreaterThan(0);
    expect(result.figures.calculatedMinor).toBeLessThan(500_000_00);
  });

  it("an installment paid before its due date is that installment's payment, not part of the opening", () => {
    const r = received();
    const early = transfer("2024-02-08", 3_411_26); // installment 1 is due on 15 Feb
    const result = planTracking(input({ loan: [r.loan, early.loan], bank: [r.bank, early.bank] }, { today: "2024-02-20" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.opening).toMatchObject({ actualMinor: 500_000_00, differenceMinor: 0 });
    expect(result.openingAdjustment).toBeNull();
    expect(result.installments[0]).toMatchObject({ no: 1, status: "unrecorded", payment: { id: early.bank.id, date: "2024-02-08" } });
  });
});
