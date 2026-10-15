import { createCreditCardStore, openingPosition } from "./memory";
import { statementReview } from "./statements";
import { statementMovement } from "./history";
import type { ActivityRow, ActivitySnapshot } from "./activity";

const facts = { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 };
function setup(openingBalanceMinor?: number | null, rows: ActivityRow[] = []) {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = store.getState().recordOpeningStatement("budget", card.id, 1, { ...facts, openingBalanceMinor });
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-30", to: "2026-10-02", rows, counterparts: [], issues: [], fetchedAt: "now", signature: "source" };
  return { store, card, statement, snapshot, workspace: store.getState().workspaces.budget };
}
const row = (id: string, amountMinor: number): ActivityRow => ({ id, date: "2026-09-15", accountId: "card", amountMinor, label: id, notes: null, categoryId: null, categoryName: null, cleared: true, transferId: null, transferKnown: true, parentId: null, fingerprint: id });

it.each([undefined, null])("keeps an unknown opening amount unknown (%s)", (value) => {
  const { statement, snapshot, workspace } = setup(value, [row("purchase", -10000)]);
  expect(statementReview(statement, workspace, snapshot)).toMatchObject({ calculatedMinor: null, varianceMinor: null, canVerify: false });
});

it.each([[0, -10000], [5000, -5000], [-5000, -15000]])("reconciles explicit zero, debt and credit opening balances (%i)", (opening, purchase) => {
  const { store, card, statement, snapshot, workspace } = setup(opening, [row("purchase", purchase)]);
  const review = statementReview(statement, workspace, snapshot);
  expect(review).toMatchObject({ startingBalanceMinor: opening, calculatedMinor: 10000, varianceMinor: 0, continuity: false, canVerify: true });
  expect(statementMovement(card, statement, workspace, snapshot).openingMinor).toBe(opening);
  store.getState().saveReview("budget", statement.id, 1, snapshot, review.memberships, true);
  expect(store.getState().workspaces.budget.statements[0].verification).toBe("verified");
  // The existing closing balance remains the repayment anchor; brought-forward debt is never added again.
  expect(openingPosition(store.getState().workspaces.budget, card.id)?.balanceMinor).toBe(10000);
});

it("counts cycle payments/credits once and blocks nonzero variance or incomplete evidence", () => {
  const { statement, snapshot, workspace } = setup(10000, [row("purchase", -5000), row("credit", 5000)]);
  expect(statementReview(statement, workspace, snapshot).canVerify).toBe(true);
  expect(statementReview(statement, workspace, { ...snapshot, rows: [row("purchase", -5000)] })).toMatchObject({ calculatedMinor: 15000, varianceMinor: -5000, canVerify: false });
  expect(statementReview(statement, workspace, { ...snapshot, from: "2026-09-02" }).canVerify).toBe(false);
  expect(statementReview(statement, workspace, { ...snapshot, issues: ["missing split"] }).canVerify).toBe(false);
  expect(statementReview({ ...statement, openingAnchor: false }, workspace, snapshot).calculatedMinor).toBeNull();
});

it("retains opening bank facts through reset and invalidates old evidence when they change", () => {
  const { store, statement, snapshot, workspace } = setup(0, [row("purchase", -10000)]);
  const review = statementReview(statement, workspace, snapshot);
  const saved = { ...statement, reviewedSnapshot: review.signature };
  expect(statementReview({ ...saved, openingBalanceMinor: 1 }, workspace, snapshot).stale).toBe(true);
  store.getState().resetReview("budget", statement.id, 1);
  expect(store.getState().workspaces.budget.statements[0].openingBalanceMinor).toBe(0);
});
