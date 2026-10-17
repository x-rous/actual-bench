import { createCreditCardStore } from "./memory";
import { allocationSchema, cardInputSchema, repaymentPlanSchema, statementFactsSchema } from "./models";

const card = { budgetSyncId: "budget-a", accountId: "account", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "Asia/Dubai", status: "active" };
const facts = { periodStart: "2026-09-05", closingDate: "2026-10-04", dueDate: "2026-10-29", officialBalanceMinor: 285000, minimumDueMinor: 15000 };

it("deletes one card and all its tracking data atomically, preserves other cards/budgets, and supports Undo", () => {
  const store = createCreditCardStore();
  const first = store.getState().register(card);
  const second = store.getState().register({ ...card, accountId: "second" });
  store.getState().register({ ...card, budgetSyncId: "budget-b" });
  const statements = [first, second].map((entry) => store.getState().recordOpeningStatement("budget-a", entry.id, entry.revision, facts));
  const workspace = store.getState().workspaces["budget-a"];
  const plans = [first, second].map((entry) => repaymentPlanSchema.parse({ id: `plan-${entry.id}`, cardId: entry.id, transactionId: `purchase-${entry.id}`, fingerprint: "source", revision: 1, arrangement: "fixed", amountMinor: 10000, startDate: "2026-09-01", firstDueDate: "2026-10-01", months: 2, monthlyMinor: 5000, aprBps: 0, upfrontFeeMinor: 0, monthlyFeeMinor: 0, includesCosts: true, minimumPercentBps: null, minimumFloorMinor: null, expiryDate: null, afterAprBps: null, conditions: "" }));
  store.setState({ workspaces: { ...store.getState().workspaces, "budget-a": {
    ...workspace, plans,
    memberships: statements.map((entry) => ({ statementId: entry.id, cardId: entry.cardId, transactionId: `purchase-${entry.cardId}`, decision: "included", provenance: "manual", bankPostingDate: null, fingerprint: "source", reason: "Bank statement" })),
    allocations: statements.map((entry) => ({ cardId: entry.cardId, transactionId: `payment-${entry.cardId}`, originId: entry.id, amountMinor: 10000, provenance: "manual", fingerprint: "source", reason: "Confirmed" })),
    classifications: [first, second].map((entry) => ({ cardId: entry.id, transactionId: `purchase-${entry.id}`, fingerprint: "source", kind: "purchase", reason: "Confirmed" })),
    planLinks: plans.map((entry) => ({ planId: entry.id, transactionId: `fee-${entry.cardId}`, fingerprint: "source", role: "plan-fee", instalment: null })),
  } } });
  const before = store.getState().workspaces;
  const revision = before["budget-a"].cards[0].revision;
  expect(() => store.getState().deleteCard("budget-b", first.id, revision)).toThrow("no longer available");
  expect(() => store.getState().deleteCard("budget-a", first.id, revision + 1)).toThrow("changed");
  expect(store.getState().workspaces).toBe(before);
  store.getState().deleteCard("budget-a", first.id, revision);
  const deleted = store.getState().workspaces["budget-a"];
  expect(deleted.cards).toEqual([before["budget-a"].cards[1]]);
  for (const key of ["statements", "memberships", "allocations", "classifications", "plans"] as const) {
    expect(deleted[key]).toEqual(before["budget-a"][key]!.filter((entry) => entry.cardId === second.id));
  }
  expect(deleted.planLinks).toEqual([before["budget-a"].planLinks![1]]);
  expect(store.getState().workspaces["budget-b"]).toBe(before["budget-b"]);
  store.getState().undo("budget-a");
  const restored = store.getState().workspaces["budget-a"];
  for (const key of ["memberships", "allocations", "classifications", "planLinks"] as const) expect(restored[key]).toEqual(before["budget-a"][key]);
  for (const key of ["cards", "statements", "plans"] as const) expect(restored[key]).toEqual(before["budget-a"][key]!.map((entry) => ({ ...entry, revision: entry.revision + 1 })));
  expect(() => store.getState().deleteCard("budget-a", first.id, revision)).toThrow("changed");
});

it("scopes identical account IDs by budget, rejects duplicates and rolls no bank snapshots into debt", () => {
  const store = createCreditCardStore();
  const first = store.getState().register(card);
  store.getState().register({ ...card, budgetSyncId: "budget-b" });
  expect(() => store.getState().register(card)).toThrow("already registered");
  store.getState().recordOpeningStatement("budget-a", first.id, 1, facts);
  const state = store.getState();
  expect(state.workspaces["budget-b"].statements).toEqual([]);
  expect(state.workspaces["budget-a"].statements.find((entry) => entry.openingAnchor)).toMatchObject({ officialBalanceMinor: 285000, closingDate: "2026-10-04" });
  expect(state.workspaces["budget-a"].statements[0]).toMatchObject({ coverage: "unknown", verification: "recorded" });
  expect(() => state.recordOpeningStatement("budget-a", first.id, 2, facts)).toThrow("already recorded");
});

it("invalid or conflicting edits are atomic and cannot move a card across budgets/accounts", () => {
  const store = createCreditCardStore();
  const registered = store.getState().register(card);
  const before = store.getState().workspaces;
  expect(() => store.getState().recordOpeningStatement("budget-b", registered.id, 1, facts)).toThrow("active budget");
  expect(() => store.getState().recordOpeningStatement("budget-a", registered.id, 1, { ...facts, minimumDueMinor: 999999 })).toThrow();
  expect(() => store.getState().updateCard("budget-a", registered.id, 1, { ...card, accountId: "other" })).toThrow("cannot move");
  expect(store.getState().workspaces).toBe(before);
  store.getState().updateCard("budget-a", registered.id, 1, { ...card, nickname: "New name" });
  expect(() => store.getState().updateCard("budget-a", registered.id, 1, card)).toThrow("draft has not been saved");
  expect(store.getState().workspaces["budget-a"].cards[0].nickname).toBe("New name");
});

it("statement edits update current facts without correction history and retain revision guards", () => {
  const store = createCreditCardStore();
  const registered = store.getState().register(card);
  const statement = store.getState().recordOpeningStatement("budget-a", registered.id, 1, facts);
  const current = { ...facts, officialBalanceMinor: 290000 };
  store.getState().correctStatement("budget-a", statement.id, 1, current);
  const workspace = store.getState().workspaces["budget-a"];
  expect(workspace.statements).toHaveLength(1);
  expect(workspace.statements[0]).toMatchObject({ officialBalanceMinor: 290000, revision: 2, verification: "needs-review", openingAnchor: true });
  expect(workspace).not.toHaveProperty("corrections");
  expect(workspace.statements.find((entry) => entry.openingAnchor)?.officialBalanceMinor).toBe(290000);
  expect(() => store.getState().correctStatement("budget-a", statement.id, 1, facts)).toThrow("changed");
  store.getState().undo("budget-a");
  expect(store.getState().workspaces["budget-a"].statements[0].officialBalanceMinor).toBe(285000);
  expect(() => store.getState().correctStatement("budget-a", statement.id, 2, current)).toThrow("changed");
  expect(createCreditCardStore().getState().workspaces).toEqual({});
});

it("validates calendar boundaries, safe money, timezone and card credit", () => {
  expect(statementFactsSchema.safeParse({ ...facts, closingDate: "2026-02-30" }).success).toBe(false);
  expect(statementFactsSchema.safeParse({ ...facts, dueDate: "2026-09-01" }).success).toBe(false);
  expect(statementFactsSchema.safeParse({ ...facts, officialBalanceMinor: -25000, minimumDueMinor: 0 }).success).toBe(true);
  expect(statementFactsSchema.safeParse({ ...facts, officialBalanceMinor: -25000 }).success).toBe(false);
  expect(cardInputSchema.safeParse({ ...card, creditLimitMinor: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  expect(cardInputSchema.safeParse({ ...card, bankTimeZone: "invalid" }).success).toBe(false);
  expect(allocationSchema.safeParse({ cardId: "c", transactionId: "t", originId: "o", amountMinor: -1, provenance: "manual", fingerprint: "f", reason: "" }).success).toBe(false);
});

it.each(["inactive", "frozen", "closed", "lost-stolen"])("normalizes non-active card status %s without losing saved history", (status) => {
  const store = createCreditCardStore();
  const entry = store.getState().register({ ...card, status });
  store.getState().recordOpeningStatement("budget-a", entry.id, 1, facts);
  expect(store.getState().workspaces["budget-a"].cards[0].status).toBe("inactive");
  expect(store.getState().workspaces["budget-a"].statements).toHaveLength(1);
});
