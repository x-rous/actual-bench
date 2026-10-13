import { createCreditCardStore, openingPosition } from "./memory";
import { allocationSchema, cardInputSchema, statementFactsSchema } from "./models";

const card = { budgetSyncId: "budget-a", accountId: "account", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "Asia/Dubai", status: "active" };
const facts = { periodStart: "2026-09-05", closingDate: "2026-10-04", dueDate: "2026-10-29", officialBalanceMinor: 285000, minimumDueMinor: 15000 };

it("scopes identical account IDs by budget, rejects duplicates and rolls no bank snapshots into debt", () => {
  const store = createCreditCardStore();
  const first = store.getState().register(card);
  store.getState().register({ ...card, budgetSyncId: "budget-b" });
  expect(() => store.getState().register(card)).toThrow("already registered");
  store.getState().recordOpeningStatement("budget-a", first.id, 1, facts);
  const state = store.getState();
  expect(state.workspaces["budget-b"].statements).toEqual([]);
  expect(openingPosition(state.workspaces["budget-a"], first.id)).toMatchObject({ balanceMinor: 285000, date: "2026-10-04" });
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

it("corrections retain prior bank facts and one anchor, with a required reason and revision", () => {
  const store = createCreditCardStore();
  const registered = store.getState().register(card);
  const statement = store.getState().recordOpeningStatement("budget-a", registered.id, 1, facts);
  const current = { ...facts, officialBalanceMinor: 290000 };
  expect(() => store.getState().correctStatement("budget-a", statement.id, 1, current, "")).toThrow("reason");
  store.getState().correctStatement("budget-a", statement.id, 1, current, "Bank correction");
  const workspace = store.getState().workspaces["budget-a"];
  expect(workspace.statements).toHaveLength(1);
  expect(workspace.statements[0]).toMatchObject({ officialBalanceMinor: 290000, revision: 2, verification: "needs-review", openingAnchor: true });
  expect(workspace.corrections[0]).toMatchObject({ before: { officialBalanceMinor: 285000 }, after: { officialBalanceMinor: 290000 }, reason: "Bank correction" });
  expect(openingPosition(workspace, registered.id)?.balanceMinor).toBe(290000);
  expect(() => store.getState().correctStatement("budget-a", statement.id, 1, facts, "stale")).toThrow("changed");
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
