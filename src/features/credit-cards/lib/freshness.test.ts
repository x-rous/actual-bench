import { bankMatch } from "./derive/status";
import { transactionType } from "./derive/types";
import { statementReview } from "./statements";
import { facts, row, setup, snapshot, transfer } from "./fixtures/testKit";

const base = { id: "coffee", date: "2026-03-01", amount: -50000, payeeName: "Coffee", cleared: false };

function verified() {
  const context = setup({}, [
    facts("2026-02-10", 0, { periodStart: "2026-01-11", previousBalanceMinor: 0 }),
    facts("2026-03-10", 50000),
  ]);
  const bill = context.saved[1];
  const source = snapshot([row(base)]);
  context.store.getState().saveReview("budget", bill.id, 1, source, []);
  const statement = () => context.workspace().statements.find((entry) => entry.id === bill.id)!;
  return { ...context, statement };
}

it("keeps a verified statement verified after clearing, category and notes edits (D20, FR-1)", () => {
  const context = verified();
  expect(context.statement().reviewState).toBe("verified");
  for (const edit of [{ cleared: true }, { categoryId: "food", categoryName: "Food" }, { notes: "team lunch" }, { payeeName: "Cafe" }]) {
    const source = snapshot([row({ ...base, ...edit })]);
    expect(bankMatch(context.statement(), context.workspace(), source).key).toBe("matches");
  }
});

it("reopens a verified statement when an included row's date or amount changes", () => {
  const context = verified();
  for (const edit of [{ amount: -50200 }, { date: "2026-03-02" }]) {
    const source = snapshot([row({ ...base, ...edit })]);
    expect(bankMatch(context.statement(), context.workspace(), source).key).toBe("changed");
  }
});

it("keeps a type through a date or amount change, flagged as changed since you confirmed (D21, FR-2)", () => {
  const { store, workspace, card, cardId } = setup();
  const original = snapshot([row({ id: "atm", date: "2026-03-01", amount: -20000, cleared: false })]);
  store.getState().setTypes("budget", cardId, original, [{ transactionId: "atm", kind: "cash-advance" }]);
  for (const edit of [{ cleared: true }, { categoryId: "cash" }, { date: "2026-03-02" }, { amount: -20200 }]) {
    const source = snapshot([row({ id: "atm", date: "2026-03-01", amount: -20000, ...edit })]);
    const type = transactionType(source.rows[0], card(), workspace(), source);
    expect(type.kind).toBe("cash-advance");
    expect(type.changed).toBe("date" in edit || "amount" in edit);
  }
  // A change of sign or account is a different transaction for the type.
  const flipped = snapshot([row({ id: "atm", date: "2026-03-01", amount: 20000 })]);
  expect(transactionType(flipped.rows[0], card(), workspace(), flipped).source).not.toBe("user");
});

it("reopens a statement decision on a date or amount change, pre-filled with the previous answer", () => {
  const context = setup({}, [facts("2026-03-10", 50000, { previousBalanceMinor: 0 })]);
  const bill = context.saved[0];
  const near = { id: "late", date: "2026-03-10", amount: -50000 };
  context.store.getState().saveReview("budget", bill.id, 1, snapshot([row(near)]), [
    { transactionId: "late", decision: "included", bankPostingDate: null, note: null },
  ]);
  const statement = context.workspace().statements[0];
  const moved = snapshot([row({ ...near, date: "2026-03-11" })]);
  const review = statementReview(statement, context.workspace(), moved);
  expect(review.memberships[0]).toMatchObject({ decision: "review", previous: "included" });
});

it("needs a previous balance when the previous statement is missing, and is not attention (D3, CA-13)", () => {
  const context = setup({}, [facts("2026-01-10", 0, { periodStart: "2025-12-11" }), facts("2026-03-10", 50000)]);
  const later = context.saved[1];
  const source = snapshot([row(base)]);
  const statement = () => context.workspace().statements.find((entry) => entry.id === later.id)!;
  expect(bankMatch(statement(), context.workspace(), source)).toMatchObject({ key: "needs-previous-balance", attention: false });
  context.store.getState().correctStatement("budget", later.id, 1, facts("2026-03-10", 50000, { previousBalanceMinor: 0 }));
  expect(bankMatch(statement(), context.workspace(), source).key).toBe("matches");
});

it("always shows a difference, even for a statement with a stored scope acceptance (A4 retired)", () => {
  const context = setup({}, [facts("2026-02-10", 0, { periodStart: "2026-01-11", previousBalanceMinor: 0 }), facts("2026-03-10", 80000)]);
  const bill = context.saved[1];
  const accepted = { ...context.workspace().statements.find((entry) => entry.id === bill.id)!, scopeAcceptedDifferenceMinor: 30000 };
  expect(bankMatch(accepted, context.workspace(), snapshot([row(base)]))).toMatchObject({ key: "difference", attention: true });
});

it("adds plan-account principal to the calculated balance when the bank includes it (D15)", () => {
  const context = setup({ statementsIncludePlanBalances: true }, [
    facts("2026-02-10", 0, { periodStart: "2026-01-11", previousBalanceMinor: 0 }),
    facts("2026-03-10", 50000),
  ]);
  context.store.getState().setPlanAccounts("budget", ["plan-laptop"]);
  // The purchase is converted: principal moves to the plan account, the card is credited.
  const conversion = transfer("conversion", "2026-03-05", 50000, "plan-laptop");
  const rows = [row({ id: "laptop", date: "2026-03-01", amount: -50000 }), conversion.card];
  const source = snapshot(rows, { planAccounts: { "plan-laptop": { rows: [conversion.peer] } } });
  const statement = context.workspace().statements[1];
  const review = statementReview(statement, context.workspace(), source);
  expect(review).toMatchObject({ planChangeMinor: 50000, calculatedMinor: 50000, varianceMinor: 0 });
  // The same transfer is never counted as a payment.
  expect(transactionType(source.rows[1], context.card(), context.workspace(), source).kind).toBe("instalment");
});
