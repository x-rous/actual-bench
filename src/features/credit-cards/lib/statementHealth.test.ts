import { createCreditCardStore } from "./memory";
import { statementHealth } from "./statementHealth";
import { statementReview } from "./statements";
import { statementMovement } from "./history";
import type { ActivitySnapshot } from "./activity";

function setup() {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = store.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, openingBalanceMinor: 10000 });
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-30", to: "2026-10-02", rows: [], counterparts: [], issues: [], fetchedAt: "now", signature: "empty" };
  return { card, statement, snapshot, workspace: store.getState().workspaces.budget };
}
it("separates estimates, missing starting balances, mismatches, ready and verified states", () => {
  const { statement, snapshot, workspace } = setup();
  expect(statementHealth({ ...statement, bankConfirmed: false }, workspace, snapshot, true)).toMatchObject({ key: "estimate", action: "Confirm", issue: false });
  expect(statementHealth({ ...statement, openingBalanceMinor: null }, workspace, snapshot, true).key).toBe("opening");
  expect(statementHealth({ ...statement, openingBalanceMinor: 9000, verification: "membership-reviewed" }, workspace, snapshot, true).label).toBe("Balance mismatch");
  expect(statementHealth(statement, workspace, snapshot, true)).toMatchObject({ key: "ready", action: "Verify" });
  expect(statementHealth({ ...statement, verification: "verified" }, workspace, snapshot, true)).toMatchObject({ key: "verified", action: "View", issue: false });
});
it("does not certify stale, absent or incomplete evidence", () => {
  const { statement, snapshot, workspace } = setup();
  const verified = { ...statement, verification: "verified" as const, reviewedSnapshot: statementReview(statement, workspace, snapshot).signature };
  expect(statementHealth(verified, workspace, snapshot, true).key).toBe("verified");
  expect(statementHealth({ ...verified, openingBalanceMinor: 10001 }, workspace, snapshot, true).key).toBe("changed");
  expect(statementHealth(verified, workspace, undefined, true).key).toBe("unavailable");
  expect(statementHealth(verified, workspace, snapshot, false).key).toBe("unavailable");
  expect(statementHealth(verified, workspace, { ...snapshot, from: "2026-09-02" }, true).key).toBe("unavailable");
});
it("preserves known credits and reconciliation when purchase classifications are incomplete", () => {
  const { card, statement, snapshot, workspace } = setup();
  const base = { accountId: "card", date: "2026-09-15", label: "Transaction", notes: null, categoryId: null, categoryName: null, cleared: true, transferKnown: true, parentId: null };
  const source: ActivitySnapshot = { ...snapshot, rows: [{ ...base, id: "charge", fingerprint: "charge", amountMinor: -500, transferId: null }, { ...base, id: "payment", fingerprint: "payment", amountMinor: 500, transferId: "peer" }] };
  expect(statementMovement(card, statement, workspace, source)).toMatchObject({ purchasesMinor: 500, unclassifiedMinor: 0, paymentsMinor: -500, calculatedMinor: 10000, varianceMinor: 0, unavailableReason: null });
});
