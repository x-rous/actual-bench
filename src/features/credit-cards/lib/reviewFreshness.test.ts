import { createCreditCardStore } from "./memory";
import { statementReview } from "./statements";
import type { ActivitySnapshot } from "./activity";

function setup() {
  const store = createCreditCardStore();
  const state = store.getState();
  const card = state.register({ budgetSyncId: "test", accountId: "card", nickname: "Example", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const opening = state.recordOpeningStatement("test", card.id, 1, { periodStart: "2026-05-01", closingDate: "2026-05-31", dueDate: "2026-06-20", officialBalanceMinor: 10000, minimumDueMinor: 100 });
  const june = state.recordStatement("test", card.id, 2, { periodStart: "2026-06-01", closingDate: "2026-06-30", dueDate: "2026-07-20", officialBalanceMinor: 11000, minimumDueMinor: 100 }, true);
  const july = state.recordStatement("test", card.id, 3, { periodStart: "2026-07-01", closingDate: "2026-07-31", dueDate: "2026-08-20", officialBalanceMinor: 12000, minimumDueMinor: 100 }, true);
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-05-01", to: "2026-08-03", issues: [], counterparts: [], fetchedAt: "unchanged", signature: "unchanged", rows: ["2026-06-15", "2026-07-01"].map((date) => ({ id: date, fingerprint: date, accountId: "card", date, amountMinor: -1000, label: "Purchase", notes: `#${date.slice(0, 7)}`, cleared: true, categoryId: null, categoryName: null, transferId: null, transferKnown: true, parentId: null })) };
  state.saveReview("test", june.id, 1, snapshot, statementReview(june, store.getState().workspaces.test, snapshot).memberships, true);
  const savedJune = store.getState().workspaces.test.statements.find((entry) => entry.id === june.id)!;
  return { store, opening, savedJune, july, snapshot };
}

it("keeps a verified statement fresh when its already-excluded boundary row is claimed and released elsewhere", () => {
  const { store, savedJune, july, snapshot } = setup();
  const before = statementReview(savedJune, store.getState().workspaces.test, snapshot);
  store.getState().saveReview("test", july.id, 1, snapshot, statementReview(july, store.getState().workspaces.test, snapshot).memberships, true);
  const workspace = store.getState().workspaces.test;
  const after = statementReview(savedJune, workspace, snapshot);
  expect(after).toMatchObject({ stale: false, canVerify: true, varianceMinor: 0, calculatedMinor: before.calculatedMinor });
  expect(after.memberships.map((entry) => entry.decision)).toEqual(before.memberships.map((entry) => entry.decision));
  expect(after.memberships.find((entry) => entry.transactionId === "2026-07-01")?.reason).toBe("Included in statement 31 Jul 2026");
  const savedJuly = workspace.statements.find((entry) => entry.id === july.id)!;
  store.getState().saveReview("test", july.id, savedJuly.revision, snapshot, statementReview(savedJuly, workspace, snapshot).memberships.map((entry) => ({ ...entry, decision: "excluded", provenance: "manual", reason: "Release boundary ownership" })), false);
  expect(statementReview(savedJune, store.getState().workspaces.test, snapshot).stale).toBe(false);
});

it("still invalidates genuine source, anchor and coverage changes", () => {
  const { store, opening, savedJune, snapshot } = setup();
  const workspace = store.getState().workspaces.test;
  for (const id of ["2026-06-15", "2026-07-01"]) {
    const changed = { ...snapshot, rows: snapshot.rows.map((row) => row.id === id ? { ...row, fingerprint: `${row.fingerprint}-changed`, amountMinor: -1500 } : row) };
    expect(statementReview(savedJune, workspace, changed).stale).toBe(true);
  }
  expect(statementReview(savedJune, { ...workspace, statements: workspace.statements.map((entry) => entry.id === opening.id ? { ...entry, officialBalanceMinor: 9000 } : entry) }, snapshot).stale).toBe(true);
  expect(statementReview(savedJune, workspace, { ...snapshot, from: "2026-06-15" }).stale).toBe(true);
});

it("does not mask ownership conflicts for included transactions", () => {
  const { store, savedJune, july, snapshot } = setup();
  const workspace = store.getState().workspaces.test;
  const included = workspace.memberships.find((entry) => entry.transactionId === "2026-06-15")!;
  const conflicting = { ...workspace, memberships: [...workspace.memberships, { ...included, statementId: july.id }] };
  expect(statementReview(savedJune, conflicting, snapshot)).toMatchObject({ stale: true, duplicate: true, canVerify: false });
});

it("a genuine move reopens the affected statements without touching Actual source transactions", () => {
  const { store, savedJune, july, snapshot } = setup();
  const before = JSON.stringify(snapshot);
  const review = statementReview(savedJune, store.getState().workspaces.test, snapshot);
  store.getState().saveReview("test", savedJune.id, savedJune.revision, snapshot, review.memberships, false, [{ transactionId: "2026-06-15", targetStatementId: july.id, expectedTargetRevision: july.revision }]);
  const workspace = store.getState().workspaces.test;
  expect(workspace.statements.find((entry) => entry.id === savedJune.id)?.verification).not.toBe("verified");
  expect(workspace.statements.find((entry) => entry.id === july.id)?.verification).toBe("needs-review");
  expect(JSON.stringify(snapshot)).toBe(before);
});
