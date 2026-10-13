import { createCreditCardStore } from "./memory";
import { cardInputSchema, type Workspace } from "./models";
import type { ActivityRow, ActivitySnapshot } from "./activity";
import { carriedDebtPoints, netActivitySinceStatement, statementPaymentTotals } from "./insights";
import { paymentDeadline, settlements } from "./repayments";
import { statementReview } from "./statements";

function setup() {
  const store = createCreditCardStore();
  const card = store.getState().register(cardInputSchema.parse({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: 2400, bankTimeZone: "UTC", status: "active", closingDay: 31, interestCategoryId: "interest", feeCategoryId: "fees" }));
  const first = store.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-20", officialBalanceMinor: 10000, minimumDueMinor: 2000 });
  return { store, card, first };
}
function row(id: string, date: string, amountMinor: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return { id, date, amountMinor, accountId: "card", label: id, notes: null, categoryId: null, categoryName: null, cleared: true, transferId: amountMinor > 0 ? `peer-${id}` : null, transferKnown: true, fingerprint: id, parentId: null, ...overrides };
}
function snapshot(rows: ActivityRow[]): ActivitySnapshot { return { accountId: "card", from: "2026-07-01", to: "2026-11-05", rows, counterparts: [], issues: [], fetchedAt: "now", signature: "rows" }; }

it("freezes actual carry at the due date, excludes upcoming periods and keeps later settlement separate", () => {
  const { store, card, first } = setup();
  const workspace = store.getState().workspaces.budget;
  const source = snapshot([row("minimum", "2026-09-20", 2000), row("late-full", "2026-09-23", 8000)]);
  expect(carriedDebtPoints(card, workspace, source, "2026-09-20")).toEqual([]);
  expect(carriedDebtPoints(card, workspace, source, "2026-09-21")[0]).toMatchObject({ date: first.dueDate, value: 8000 });
  expect(carriedDebtPoints(card, workspace, source, "2026-09-30")[0].value).toBe(8000);
  expect(settlements(card, workspace, source, "2026-09-30")[0]).toMatchObject({ fullRemainingMinor: 0, status: "Paid late", minimumByDue: true, fullByDue: false });
});
it("does not present pending or incomplete deadline evidence as actual carried debt", () => {
  const { store, card } = setup();
  const workspace = store.getState().workspaces.budget;
  expect(carriedDebtPoints(card, workspace, snapshot([row("pending", "2026-09-20", 10000, { cleared: false })]), "2026-09-30")).toEqual([expect.objectContaining({ value: null })]);
  expect(carriedDebtPoints(card, workspace, { ...snapshot([]), to: "2026-09-19" }, "2026-09-30")).toEqual([expect.objectContaining({ value: null })]);
  expect(carriedDebtPoints(card, { ...workspace, statements: workspace.statements.map((entry) => ({ ...entry, bankConfirmed: false })) }, snapshot([]), "2026-09-30")).toEqual([expect.objectContaining({ value: null })]);
});
it("labels calendar urgency without relying on a UTC clock", () => {
  expect(["2026-10-01", "2026-10-10", "2026-10-12", "2026-10-25"].map((due) => paymentDeadline(due, "2026-10-10"))).toEqual(["Overdue", "Due today", "Due soon", "Upcoming"]);
});
it("reconciles net post-close activity with payments, credits, fees and pending rows, not just purchases", () => {
  const { store, card, first } = setup();
  const source = snapshot([row("purchase", "2026-09-02", -5000), row("pay", "2026-09-03", 10000), row("refund", "2026-09-04", 500, { transferId: null }), row("fee", "2026-09-05", -100, { categoryId: "fees", cleared: false })]);
  const bridge = netActivitySinceStatement(card, first, store.getState().workspaces.budget, source, -4600, "2026-09-30");
  expect(bridge).toMatchObject({ differenceMinor: -5400, netMinor: -5400, unexplainedMinor: 0, pendingCount: 1 });
  expect(bridge.groups).toContainEqual({ label: "Payments", value: -10000 });
  expect(bridge.groups).toContainEqual({ label: "Fees", value: 100 });
  expect(netActivitySinceStatement(card, first, store.getState().workspaces.budget, source, -5000, "2026-09-30").unexplainedMinor).toBe(400);
  expect(netActivitySinceStatement(card, first, store.getState().workspaces.budget, { ...source, from: "2026-09-01" }, -4600, "2026-09-30").unexplainedMinor).toBeNull();
});
it("preserves account credit and excludes scheduled future activity from the bridge", () => {
  const { store, card, first } = setup();
  const source = { ...snapshot([row("pay", "2026-09-01", 12000)]), futureDeltaMinor: -3000 };
  expect(netActivitySinceStatement(card, first, store.getState().workspaces.budget, source, -1000, "2026-09-30")).toMatchObject({ currentOwedMinor: -2000, differenceMinor: -12000, unexplainedMinor: 0 });
});
it("counts only the latest confirmed billed obligation per card, retaining pending and missing coverage", () => {
  const { store, card } = setup();
  store.getState().recordStatement("budget", card.id, 2, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 5000, minimumDueMinor: 1000 }, true);
  const workspace = store.getState().workspaces.budget;
  const source = snapshot([row("pending", "2026-10-10", 3000, { cleared: false })]);
  expect(statementPaymentTotals([card], workspace, [source], ["2026-10-11"])).toMatchObject({ remainingMinor: 5000, minimumMinor: 1000, pendingMinor: 3000, coverage: 1 });
  expect(statementPaymentTotals([card], workspace, [undefined], ["2026-10-11"])).toMatchObject({ coverage: 0, total: 1 });
});
it("moves membership atomically and reopens destination verification; stale targets and incomplete history are rejected", () => {
  const { store, card, first } = setup();
  const second = store.getState().recordStatement("budget", card.id, 2, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 11000, minimumDueMinor: 1000 }, true);
  const source = snapshot([row("border", "2026-09-01", -1000)]);
  const membership = { statementId: first.id, cardId: card.id, transactionId: "border", fingerprint: "border", decision: "included" as const, provenance: "manual" as const, bankPostingDate: null, reason: "Confirmed bank cutoff" };
  store.getState().saveReview("budget", first.id, 1, source, [membership], false);
  const before = store.getState().workspaces.budget;
  expect(() => store.getState().saveReview("budget", first.id, 2, source, [membership], false, [{ transactionId: "border", targetStatementId: second.id, expectedTargetRevision: 99 }])).toThrow("changed");
  expect(store.getState().workspaces.budget).toBe(before);
  expect(() => store.getState().saveReview("budget", first.id, 2, { ...source, to: "2026-09-02" }, [membership], false, [{ transactionId: "border", targetStatementId: second.id, expectedTargetRevision: 1 }])).toThrow("complete transaction history");
  store.getState().saveReview("budget", first.id, 2, source, [membership], false, [{ transactionId: "border", targetStatementId: second.id, expectedTargetRevision: 1 }]);
  const workspace: Workspace = store.getState().workspaces.budget;
  expect(workspace.memberships.filter((entry) => entry.decision === "included")).toHaveLength(1);
  expect(workspace.memberships.find((entry) => entry.statementId === first.id)?.decision).toBe("excluded");
  expect(workspace.statements.find((entry) => entry.id === second.id)).toMatchObject({ revision: 2, verification: "needs-review", reviewedSnapshot: null });
  expect(statementReview(second, workspace, source).calculatedMinor).toBe(11000);
});
