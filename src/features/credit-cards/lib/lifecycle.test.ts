import { createCreditCardStore } from "./memory";
import { cardInputSchema } from "./models";
import { cardActivityWindow } from "./cycles";
import { statementDrafts, effectiveMembership } from "./statements";
import type { ActivitySnapshot } from "./activity";

function setup() {
  const store = createCreditCardStore();
  const card = store.getState().register(cardInputSchema.parse({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", purchaseAprBps: null, creditLimitMinor: null, bankTimeZone: "UTC", status: "active", closingDay: 31 }));
  const first = store.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-05-01", closingDate: "2026-05-31", dueDate: "2026-06-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  const later = store.getState().recordStatement("budget", card.id, 2, { periodStart: "2026-06-01", closingDate: "2026-06-30", dueDate: "2026-07-20", officialBalanceMinor: 11000, minimumDueMinor: 1000 }, true);
  const workspace = store.getState().workspaces.budget;
  const membership = { statementId: first.id, cardId: card.id, transactionId: "row", decision: "included" as const, provenance: "manual" as const, reason: "Confirmed cutoff", fingerprint: "row", bankPostingDate: "2026-05-31" };
  const classification = { cardId: card.id, transactionId: "row", kind: "purchase" as const, fingerprint: "row", reason: "Purchase evidence" };
  store.setState({ workspaces: { budget: { ...workspace, statements: workspace.statements.map((entry) => ({ ...entry, verification: "verified", reviewedSnapshot: "review" })), memberships: [membership], classifications: [classification] } } });
  return { store, card: store.getState().workspaces.budget.cards[0], first, later, classification };
}

it("resets ownership and posting overrides, retains bank facts/classification and reopens dependents with Undo", () => {
  const { store, first, later, classification } = setup();
  store.getState().resetReview("budget", first.id, first.revision);
  const workspace = store.getState().workspaces.budget;
  expect(workspace.memberships).toEqual([]);
  expect(workspace.classifications).toEqual([classification]);
  expect(workspace.statements.find((entry) => entry.id === first.id)).toMatchObject({ officialBalanceMinor: 10000, minimumDueMinor: 1000, dueDate: "2026-06-20", openingAnchor: true, verification: "needs-review", reviewedSnapshot: null });
  expect(workspace.statements.find((entry) => entry.id === later.id)).toMatchObject({ verification: "needs-review", revision: 2 });
  expect(() => store.getState().resetReview("budget", first.id, 1)).toThrow("changed");
  store.getState().undo("budget");
  expect(store.getState().workspaces.budget.memberships[0]).toMatchObject({ decision: "included", bankPostingDate: "2026-05-31" });
  expect(store.getState().workspaces.budget.statements.find((entry) => entry.id === first.id)?.revision).toBeGreaterThan(2);
});

it("deletes saved facts and ownership without silently promoting a new opening anchor", () => {
  const { store, card, first, later, classification } = setup();
  store.getState().deleteStatement("budget", first.id, 1);
  const workspace = store.getState().workspaces.budget;
  expect(workspace.statements).toHaveLength(1);
  expect(workspace.statements[0]).toMatchObject({ id: later.id, openingAnchor: false, verification: "needs-review" });
  expect(workspace.memberships).toEqual([]);
  expect(workspace.classifications).toEqual([classification]);
  expect(workspace.cards[0].firstTrackedStatementDate).toBe("2026-05-31");
  expect(workspace.statements.find((entry) => entry.cardId === card.id && entry.openingAnchor)).toBeUndefined();
  expect(() => store.getState().deleteStatement("other-budget", later.id, 2)).toThrow("active budget");
  store.getState().undo("budget");
  expect(store.getState().workspaces.budget.statements.find((entry) => entry.cardId === card.id && entry.openingAnchor)?.id).toBe(first.id);
  expect(store.getState().workspaces.budget.memberships).toHaveLength(1);
});

it("bounds automatic history and saved statements by the independent per-card tracking date", () => {
  const { store, card } = setup();
  expect(card.firstTrackedStatementDate).toBe("2026-05-31");
  const source: ActivitySnapshot = { accountId: "card", from: "2025-01-01", to: "2026-10-11", rows: [], counterparts: [], issues: [], fetchedAt: "now", signature: "empty" };
  expect(statementDrafts(card, "2026-10-11", 24, source, -10000).every((entry) => entry.closingDate >= "2026-05-31")).toBe(true);
  expect(() => store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-04-01", closingDate: "2026-04-30", dueDate: "2026-05-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 }, true)).toThrow("first tracked");
  expect(() => store.getState().updateCard("budget", card.id, card.revision, { ...card, id: undefined, revision: undefined })).toThrow();
  const input = cardInputSchema.parse(Object.fromEntries(Object.entries(card).filter(([key]) => key !== "id" && key !== "revision")));
  expect(() => store.getState().updateCard("budget", card.id, card.revision, { ...input, firstTrackedStatementDate: "2026-06-30" })).toThrow("Delete earlier");
  expect(store.getState().workspaces.budget.cards[0].firstTrackedStatementDate).toBe("2026-05-31");
});

it("loads every tracked cycle automatically using bank period dates and each card's boundary", () => {
  const { card, store } = setup();
  const statements = store.getState().workspaces.budget.statements;
  expect(cardActivityWindow(card, "2027-01-11", statements)).toEqual({ from: "2026-04-29", to: "2027-01-11" });
  expect(cardActivityWindow({ ...card, firstTrackedStatementDate: "2026-11-30" }, "2027-01-11")).toEqual({ from: "2026-10-30", to: "2027-01-11" });
  expect(cardActivityWindow({ ...card, firstTrackedStatementDate: "2022-05-31" }, "2027-01-11")).toEqual({ from: "2022-04-29", to: "2027-01-11" });
  expect(cardActivityWindow({ ...card, firstTrackedStatementDate: null }, "2027-01-11", statements).from).toBe("2026-04-29");
});

it("prepares all tracked statements beyond nine months and the former 36-month limit", () => {
  const { card } = setup();
  const source: ActivitySnapshot = { accountId: "card", from: "2022-04-29", to: "2027-01-11", rows: [], counterparts: [], issues: [], fetchedAt: "now", signature: "empty" };
  const nineMonths = statementDrafts({ ...card, firstTrackedStatementDate: "2026-04-30" }, "2027-01-11", undefined, source, -10000);
  expect(nineMonths).toHaveLength(9);
  expect(nineMonths.at(-1)?.closingDate).toBe("2026-04-30");
  const longHistory = statementDrafts({ ...card, firstTrackedStatementDate: "2022-05-31" }, "2027-01-11", undefined, source, -10000);
  expect(longHistory).toHaveLength(56);
  expect(longHistory.at(-1)?.closingDate).toBe("2022-05-31");
});

it("recreates suggestions after reset instead of retaining a manual bank posting override", () => {
  const { store, first } = setup();
  store.getState().resetReview("budget", first.id, 1);
  const workspace = store.getState().workspaces.budget;
  const decision = effectiveMembership(workspace.statements[0], { id: "row", date: "2026-06-01", notes: "#2026-06", amountMinor: -1000, accountId: "card", label: "Purchase", categoryId: null, categoryName: null, cleared: true, transferId: null, transferKnown: true, fingerprint: "row", parentId: null }, workspace.memberships);
  expect(decision).toMatchObject({ decision: "excluded", provenance: "suggested", bankPostingDate: null });
});

it("reanchors only after an explicit tracking-start change, while guarding open drafts", () => {
  const { store, card, first, later } = setup();
  store.getState().deleteStatement("budget", first.id, 1);
  const current = store.getState().workspaces.budget.cards[0];
  const input = cardInputSchema.parse(Object.fromEntries(Object.entries(current).filter(([key]) => key !== "id" && key !== "revision")));
  store.getState().updateCard("budget", card.id, current.revision, { ...input, firstTrackedStatementDate: later.closingDate });
  expect(store.getState().workspaces.budget.statements.find((entry) => entry.cardId === card.id && entry.openingAnchor)?.id).toBe(later.id);
  expect(() => store.getState().saveReview("budget", later.id, 1, { accountId: "card", from: "2026-01-01", to: "2026-10-11", rows: [], counterparts: [], issues: [], fetchedAt: "now", signature: "empty" }, [], false)).toThrow("changed");
});

it("cannot bypass the tracking boundary by editing the opening statement past saved history", () => {
  const { store, first } = setup();
  const before = store.getState().workspaces.budget;
  expect(() => store.getState().correctStatement("budget", first.id, 1, { periodStart: "2026-07-01", closingDate: "2026-07-31", dueDate: "2026-08-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 })).toThrow("Delete earlier");
  expect(store.getState().workspaces.budget).toBe(before);
});
