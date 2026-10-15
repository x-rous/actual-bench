import { activityKind, type ActivityRow, type ActivitySnapshot } from "./activity";
import { createCreditCardStore } from "./memory";
import { repaymentLedger, settlements } from "./repayments";
import { statementHistory, statementMovement } from "./history";
import { statementPaymentSummary } from "./paymentSummary";
import { netActivitySinceStatement, statementPaymentTotals } from "./insights";

const row = (id: string, date: string, amountMinor: number, categoryId: string | null = "cashback", cleared = true): ActivityRow => ({ id, accountId: "card", date, amountMinor, categoryId, categoryName: categoryId, cleared, transferId: null, transferKnown: true, fingerprint: id, parentId: null, label: id, notes: null });
function setup(rows: ActivityRow[]) {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", closingDay: 31, cashbackCategoryId: "cashback", interestCategoryId: "interest", feeCategoryId: "fees" });
  const statement = store.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-20", officialBalanceMinor: 10000, minimumDueMinor: 2000, openingBalanceMinor: 10000 });
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-01", to: "2026-10-10", rows, counterparts: [], issues: [], fetchedAt: "2026-10-10", signature: "test" };
  return { store, card, statement, snapshot, workspace: store.getState().workspaces.budget };
}
it("separates mapped cashback from refunds and leaves real transfers as payments", () => {
  const { card, workspace, snapshot } = setup([]);
  expect(activityKind(row("credit", "2026-09-01", 500), card, workspace, snapshot)).toBe("cashback");
  expect(activityKind(row("refund", "2026-09-01", 500, "shopping"), card, workspace, snapshot)).toBe("refund");
  expect(activityKind(row("outflow", "2026-09-01", -500), card, workspace, snapshot)).not.toBe("cashback");
  expect(activityKind({ ...row("transfer", "2026-09-01", 500), transferId: "peer" }, card, workspace, snapshot)).toBe("payment");
});
it("reduces debt, carried balance and portfolio remaining without counting cashback as repayment or minimum satisfaction", () => {
  const { card, workspace, snapshot, statement } = setup([row("credit", "2026-09-01", 3000)]);
  const payment = settlements(card, workspace, snapshot, "2026-10-10")[0];
  expect(payment).toMatchObject({ paidMinor: 0, confirmedPaidMinor: 0, confirmedCashbackMinor: 3000, fullRemainingMinor: 7000, minimumRemainingMinor: 2000, minimumByDue: false, carriedAtDueMinor: 7000 });
  expect(repaymentLedger(card, workspace, snapshot)).toMatchObject({ confirmedMinor: 0, creditMinor: 0, origins: [expect.objectContaining({ remainingMinor: 7000 })] });
  expect(statementPaymentTotals([card], workspace, [snapshot], ["2026-10-10"])).toMatchObject({ remainingMinor: 7000, minimumMinor: 2000 });
  const summary = statementPaymentSummary(statement, payment, "2026-10-10", true);
  expect(summary.progress.map((entry) => entry.text)).toEqual(["Paid: 0.00 · cashback 30.00", "Remaining: 70.00", "Minimum due: 20.00"]);
  expect(netActivitySinceStatement(card, statement, workspace, snapshot, -7000, "2026-10-10")).toMatchObject({ unexplainedMinor: 0, groups: [{ label: "Cashback", value: -3000 }] });
});
it("settles the full balance with payments and cashback without inflating paid or excess amounts", () => {
  const { card, workspace, snapshot, statement } = setup([{ ...row("payment", "2026-09-01", 8000, null), transferId: "peer" }, row("credit", "2026-09-04", 2500)]);
  const payment = settlements(card, workspace, snapshot, "2026-10-10")[0];
  expect(payment).toMatchObject({ paidMinor: 8000, fullRemainingMinor: 0, confirmedPaidDate: "2026-09-04", minimumPaidDate: "2026-09-01", status: "Settled · includes credits", fullByDue: true });
  expect(statementPaymentSummary(statement, payment, "2026-10-10", true).progress.map((entry) => entry.text)).toEqual(["Paid: 80.00", "Cashback: 25.00", "Settled"]);
  expect(repaymentLedger(card, workspace, snapshot)).toMatchObject({ confirmedMinor: 8000, creditMinor: 500 });
});
it("keeps pending cashback provisional and does not erase due-date carry or claim confirmed settlement", () => {
  const { card, workspace, snapshot, statement } = setup([row("credit", "2026-09-01", 10000, "cashback", false)]);
  const payment = settlements(card, workspace, snapshot, "2026-10-10")[0];
  expect(payment).toMatchObject({ confirmedCashbackMinor: 0, provisionalCashbackMinor: 10000, confirmedPaidDate: null, carriedAtDueMinor: null, minimumPaidDate: null });
  const summary = statementPaymentSummary(statement, payment, "2026-10-10", true);
  expect(summary.progress.map((entry) => entry.text)).toContain("Remaining: 100.00");
  expect(summary.timing.map((entry) => entry.text)).toEqual(["Awaiting clearance"]);
});
it("shows cashback separately in billing history and never counts it twice in the statement bridge", () => {
  const { card, workspace, snapshot, statement } = setup([row("credit", "2026-08-15", 500)]);
  const adjusted = { ...statement, officialBalanceMinor: 9500 };
  const adjustedWorkspace = { ...workspace, statements: [adjusted] };
  expect(statementMovement(card, adjusted, adjustedWorkspace, snapshot)).toMatchObject({ cashbackMinor: -500, refundsMinor: 0, paymentsMinor: 0, calculatedMinor: 9500, varianceMinor: 0 });
  expect(statementHistory(card, adjustedWorkspace, snapshot, "2026-10-10")[0]).toMatchObject({ cashbackMinor: 500, refundsMinor: 0 });
});
it("supports individual cashback classification with direction validation and manual precedence", () => {
  const source = row("credit", "2026-09-01", 500, "unmapped");
  const { store, card, snapshot } = setup([source, row("negative", "2026-09-02", -500)]);
  const current = store.getState().workspaces.budget.cards[0];
  expect(() => store.getState().classify("budget", card.id, current.revision, snapshot, { cardId: card.id, transactionId: "negative", fingerprint: "negative", kind: "cashback", reason: "Invalid direction" })).toThrow("direction");
  store.getState().classify("budget", card.id, current.revision, snapshot, { cardId: card.id, transactionId: source.id, fingerprint: source.fingerprint, kind: "cashback", reason: "Reward credit" });
  expect(activityKind(source, card, store.getState().workspaces.budget, snapshot)).toBe("cashback");
});
it("keeps the bank minimum outstanding when credits cover the full balance", () => {
  const { card, workspace, snapshot, statement } = setup([row("credit", "2026-09-01", 10000)]);
  const payment = settlements(card, workspace, snapshot, "2026-10-10")[0];
  expect(payment.fullRemainingMinor).toBe(0);
  expect(payment.minimumRemainingMinor).toBe(statement.minimumDueMinor);
  expect(payment.confirmedMinimumPaidDate).toBeNull();
  expect(payment.minimumByDue).toBe(false);
  const summary = statementPaymentSummary(statement, payment, "2026-10-10", true);
  expect(summary.progress.at(-1)?.text).toContain("Minimum due:");
  expect(summary.timing[0].text).toBe("Minimum overdue");
});

it("keeps minimum satisfaction certain when only non-payment credit clearing is pending", () => {
  const { card, workspace, snapshot } = setup([row("credit", "2026-09-01", 500, "cashback", false)]);
  const [status] = settlements(card, workspace, snapshot, "2026-10-10");
  expect(status.minimumByDue).toBe(false);
  expect(status.confirmedPaidMinor).toBe(0);
  expect(status.provisionalCashbackMinor).toBe(500);
});
