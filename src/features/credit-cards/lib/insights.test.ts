import { createCreditCardStore } from "./memory";
import { cardInputSchema, type Membership, type Statement, type Workspace } from "./models";
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


function membership(statement: Statement, entry: ActivityRow, decision: "included" | "excluded", overrides: Partial<Membership> = {}): Membership {
  return { statementId: statement.id, cardId: statement.cardId, transactionId: entry.id, fingerprint: entry.fingerprint, decision, provenance: "manual", bankPostingDate: null, reason: "Reviewed statement cutoff", ...overrides };
}

it("includes reviewed closing-day exclusions in unbilled charges and pending counts", () => {
  const { store, card, first } = setup();
  const boundary = [500, 300, 200].map((amount, index) => row(`boundary-${index}`, first.closingDate, -amount, { cleared: false }));
  const after = Array.from({ length: 11 }, (_, index) => row(`after-${index}`, "2026-09-02", -100, { cleared: false }));
  const source = snapshot([...boundary, ...after]);
  const workspace = { ...store.getState().workspaces.budget, memberships: boundary.map((entry) => membership(first, entry, "excluded")) };
  expect(netActivitySinceStatement(card, first, workspace, source, -12100, "2026-09-30")).toMatchObject({ rows: source.rows, netMinor: 2100, unexplainedMinor: 0, pendingCount: 14 });
});

it("never counts reviewed current or earlier statement inclusions twice across the cutoff", () => {
  const { store, card, first } = setup();
  const prior = { ...first, id: "prior", periodStart: "2026-07-01", closingDate: "2026-07-31", dueDate: "2026-08-20", officialBalanceMinor: 0 };
  const earlier = row("earlier-owned", first.closingDate, -700);
  const includedAfter = row("included-after", "2026-09-01", -200);
  const unbilled = row("unbilled", "2026-09-02", -400);
  const workspace = { ...store.getState().workspaces.budget, statements: [prior, first], memberships: [membership(first, earlier, "excluded"), membership(prior, earlier, "included"), membership(first, includedAfter, "included")] };
  expect(netActivitySinceStatement(card, first, workspace, snapshot([earlier, includedAfter, unbilled]), -10400, "2026-09-30")).toMatchObject({ rows: [unbilled], netMinor: 400, unexplainedMinor: 0 });
});

it("does not explain differences with stale, other-card, outside-cycle or future cutoff decisions", () => {
  const { store, card, first } = setup();
  const stale = row("stale", first.closingDate, -100);
  const otherCard = row("other-card-decision", first.closingDate, -200);
  const old = row("outside-cycle", "2026-07-31", -500);
  const future = row("future", "2026-10-01", -600);
  const foreign = row("foreign-account", "2026-09-01", -700, { accountId: "another-account" });
  const workspace = { ...store.getState().workspaces.budget, memberships: [membership(first, stale, "excluded", { fingerprint: "old source" }), membership(first, otherCard, "excluded", { cardId: "another-card" }), membership(first, old, "excluded"), membership(first, future, "excluded", { bankPostingDate: first.closingDate })] };
  expect(netActivitySinceStatement(card, first, workspace, snapshot([stale, otherCard, old, future, foreign]), -10300, "2026-09-30")).toMatchObject({ rows: [stale, otherCard, old], netMinor: 800, unexplainedMinor: -500 });
});

it("preserves credit signs for refunds excluded at the closing cutoff", () => {
  const { store, card, first } = setup();
  const credit = row("refund", first.closingDate, 700, { transferId: null });
  const workspace = { ...store.getState().workspaces.budget, memberships: [membership(first, credit, "excluded")] };
  expect(netActivitySinceStatement(card, first, workspace, snapshot([credit]), -9300, "2026-09-30")).toMatchObject({ rows: [credit], netMinor: -700, unexplainedMinor: 0, groups: [{ label: "Refunds / credits", value: -700 }] });
});

it("does not suppress activity owned by a statement later than the balance anchor", () => {
  const { store, card, first } = setup();
  const later = { ...first, id: "later", periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20" };
  const charge = row("later-owned", "2026-09-02", -500);
  const workspace = { ...store.getState().workspaces.budget, statements: [first, later], memberships: [membership(later, charge, "included")] };
  expect(netActivitySinceStatement(card, first, workspace, snapshot([charge]), -10500, "2026-09-15")).toMatchObject({ rows: [charge], netMinor: 500, unexplainedMinor: 0 });
});
