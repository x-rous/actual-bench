import { apiRequest } from "@/lib/api/client";
import { createFakeActual } from "./fakeActual";
import { HARNESS_MODES, transportFor } from "./transportHarness";
import evidence from "./__fixtures__/p1.0-spike-evidence.json";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;

/**
 * T111 calibration (owner decision D6): the fake and the recorded P1.0 live
 * spike agree on the four live-calibrated behaviours, through Bench's real
 * Direct and HTTP transports.
 */

const ACCOUNTS = [
  { id: "checking", name: "Checking" },
  { id: "savings", name: "Savings" },
  { id: "mortgage", name: "Mortgage", offbudget: true },
  { id: "onLoan", name: "Car loan" },
];
const CATS = { loanPayment: "cat-loan", interest: "cat-int", fees: "cat-fee" };

function budget() {
  return createFakeActual({ accounts: ACCOUNTS, payees: [{ id: "p-lender", name: "Home Lender" }] });
}

describe.each(HARNESS_MODES)("fake Actual calibration against the live spike (%s)", (mode) => {
  const live = evidence[mode];

  it("behaviour 1 (T010): a transfer-payee split child inserts exactly one counterpart", async () => {
    const fake = budget();
    const t = transportFor(mode, fake, mockApiRequest);
    const bank = fake.seed({ account: "checking", date: "2026-01-05", amount: -830000, payee: "p-lender" });
    const before = fake.accountRows("mortgage").length;
    await t.restructureTransactionAsSplit!({
      accountId: "checking", transactionId: bank,
      expected: { id: bank, accountId: "checking", date: "2026-01-05", amount: -830000, payeeId: "p-lender", categoryId: null, notes: null, reconciled: false, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0 },
      children: [
        { amount: -695000, payeeId: fake.transferPayeeId("mortgage"), categoryId: CATS.loanPayment, notes: "principal" },
        { amount: -130000, payeeId: null, categoryId: CATS.interest, notes: "interest" },
        { amount: -5000, payeeId: null, categoryId: CATS.fees, notes: "fee" },
      ],
    });
    const parent = fake.accountRows("checking").find((r) => r.id === bank)!;
    const children = parent.subtransactions as Array<Record<string, unknown>>;
    const principal = children.find((c) => c.notes === "principal")!;
    const counterpart = fake.row(principal.transfer_id as string)!;
    expect({ isParent: parent.is_parent, childCount: children.length, childSum: children.reduce((s, c) => s + (c.amount as number), 0) })
      .toEqual({ isParent: live.t010.isParent, childCount: live.t010.childCount, childSum: live.t010.childSum });
    expect({ amount: counterpart.amount, category: counterpart.category }).toEqual({ amount: live.t010.counterpart.amount, category: live.t010.counterpart.category });
    expect(principal.category).not.toBeNull();
    expect(fake.accountRows("mortgage").length - before).toBe(live.t010.mortgageRowsAdded);
  });

  it("behaviours 2 and 3 (T011/T012): call 1 inserts nothing, call 2 completes; editing a half-linked counterpart inserts a stray", async () => {
    const fake = budget();
    const child = "child-1";
    fake.seed({ account: "checking", date: "2026-01-06", amount: -830000, payee: "p-lender", subtransactions: [
      { id: child, amount: -695000, category: CATS.loanPayment, notes: "principal" },
      { amount: -135000, category: CATS.interest, notes: "interest" },
    ] });
    const lender = fake.seed({ account: "mortgage", date: "2026-01-06", amount: 695000, payee: "p-lender", notes: "lender import", cleared: true, imported_id: "lender:1", imported_payee: "LENDER REPAYMENT RECEIVED" });
    const mortgageBefore = fake.accountRows("mortgage").length;
    // Call 1 exactly as transactionStructure sends it.
    fake.editInActual(child, { amount: -695000, category: CATS.loanPayment, payee: fake.transferPayeeId("mortgage"), notes: "lender import", transfer_id: lender });
    expect(fake.accountRows("mortgage").length - mortgageBefore).toBe(live.t011.mortgageRowsAddedByCall1);
    expect(fake.row(lender)!.transfer_id ?? null).toBe(live.t011.afterCall1.lenderTransferId);
    // Half-linked is detectable, and completing it inserts nothing.
    expect(fake.row(child)!.transfer_id === lender && !fake.row(lender)!.transfer_id).toBe(live.t012.halfLinkedDetectable);
    fake.editInActual(lender, { transfer_id: child });
    const final = fake.row(lender)!;
    expect(final).toMatchObject({ transfer_id: child, amount: live.t011.final.lenderAmount, category: live.t011.final.lenderCategory, notes: live.t011.final.lenderNotes, imported_id: "lender:1", imported_payee: live.t011.final.lenderImportedPayee, cleared: live.t011.final.lenderCleared });
    expect(fake.accountRows("mortgage").length - mortgageBefore).toBe(live.t011.mortgageRowsAddedTotal);

    // The hazard: edit the counterpart while half-linked.
    const fake2 = budget();
    const c2 = "child-2";
    fake2.seed({ account: "checking", date: "2026-01-07", amount: -695000, payee: "p-lender", subtransactions: [{ id: c2, amount: -695000, notes: "principal" }] });
    const l2 = fake2.seed({ account: "mortgage", date: "2026-01-07", amount: 695000, payee: "p-lender", notes: "lender import" });
    fake2.editInActual(c2, { amount: -695000, category: null, payee: fake2.transferPayeeId("mortgage"), notes: "lender import", transfer_id: l2 });
    const checkingBefore = fake2.rows().filter((r) => r.account === "checking").length;
    fake2.editInActual(l2, { notes: "edited while half-linked" });
    expect(fake2.rows().filter((r) => r.account === "checking").length - checkingBefore).toBe(live.t012.editWhileHalfLinkedInsertedRowsInChecking);
  });

  it("behaviour 3 (T011b): call 1 overwrites a mismatched counterpart amount (why Bench preflights exact equality)", () => {
    const fake = budget();
    const child = "child-3";
    fake.seed({ account: "checking", date: "2026-01-08", amount: -695000, payee: "p-lender", subtransactions: [{ id: child, amount: -695000, notes: "principal" }] });
    const lender = fake.seed({ account: "mortgage", date: "2026-01-08", amount: live.t011b.mismatchedLenderAmountBefore, payee: "p-lender" });
    fake.editInActual(child, { amount: -695000, category: null, payee: fake.transferPayeeId("mortgage"), notes: null, transfer_id: lender });
    expect(fake.row(lender)!.amount).toBe(live.t011b.mismatchedLenderAmountAfterCall1);
  });

  it("behaviour 4 (T014): off-budget rows lose their category; a boundary transfer keeps it on the on-budget side only", async () => {
    const fake = budget();
    const t = transportFor(mode, fake, mockApiRequest);
    const created = await t.createTransactionsForSync([
      { accountId: "mortgage", date: "2026-02-01", amount: -125000, categoryId: CATS.interest, importedId: "m-off" },
      { accountId: "onLoan", date: "2026-02-02", amount: -25000, categoryId: CATS.interest, importedId: "m-on" },
      { accountId: "checking", date: "2026-02-03", amount: -400000, payeeId: fake.transferPayeeId("mortgage"), categoryId: CATS.loanPayment, importedId: "m-boundary" },
      { accountId: "checking", date: "2026-02-04", amount: -300000, payeeId: fake.transferPayeeId("savings"), categoryId: CATS.loanPayment, importedId: "m-bothon" },
    ]);
    const id = (i: number) => created.created[i].transactionId!;
    const boundary = fake.row(id(2))!;
    const bothOn = fake.row(id(3))!;
    const result = {
      offBudgetChargeCategory: fake.row(id(0))!.category ?? null,
      onBudgetLiabilityChargeCategory: fake.row(id(1))!.category === CATS.interest ? "<kept>" : null,
      boundaryOnBudgetSideCategory: boundary.category === CATS.loanPayment ? "<kept>" : null,
      boundaryOffBudgetSideCategory: fake.row(boundary.transfer_id as string)!.category ?? null,
      bothOnBudgetSourceCategory: bothOn.category ?? null,
      bothOnBudgetCounterpartCategory: fake.row(bothOn.transfer_id as string)!.category ?? null,
    };
    expect(result).toEqual({
      offBudgetChargeCategory: live.t014.offBudgetChargeCategory,
      onBudgetLiabilityChargeCategory: live.t014.onBudgetLiabilityChargeCategory ? "<kept>" : null,
      boundaryOnBudgetSideCategory: live.t014.boundaryOnBudgetSideCategory ? "<kept>" : null,
      boundaryOffBudgetSideCategory: live.t014.boundaryOffBudgetSideCategory,
      bothOnBudgetSourceCategory: live.t014.bothOnBudgetSourceCategory,
      bothOnBudgetCounterpartCategory: live.t014.bothOnBudgetCounterpartCategory,
    });
  });
});
