import { activityKind, type ActivityRow, type ActivitySnapshot } from "./activity";
import { chargeChoices, creditChoices } from "./classifications";
import { createCreditCardStore } from "./memory";
function setup(amountMinor: number, transferId: string | null = null) {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Example card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const row: ActivityRow = { id: "source", accountId: "card", date: "2026-09-01", amountMinor, label: "Source transaction", notes: null, categoryId: null, categoryName: null, cleared: true, fingerprint: "fingerprint", parentId: null, transferId, transferKnown: true };
  const snapshot: ActivitySnapshot = { accountId: "card", rows: [row], counterparts: [], issues: [], from: row.date, to: "2026-10-14", fetchedAt: "2026-10-14", signature: "test" };
  return { store, card, row, snapshot };
}
it.each([...chargeChoices, ...creditChoices])("keeps %s distinct from unclassified and enforces its direction", (kind) => {
  const charge = (chargeChoices as readonly string[]).includes(kind);
  const { store, card, row, snapshot } = setup(charge ? -1000 : 1000);
  expect(activityKind(row, card, store.getState().workspaces.budget, snapshot)).toBe(charge ? "purchase" : "refund");
  store.getState().classify("budget", card.id, card.revision, snapshot, { cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind, reason: "Reviewed source", feeSubtype: kind === "fee" ? "vat" : null });
  expect(activityKind(row, card, store.getState().workspaces.budget, snapshot)).toBe(kind);
  const wrong = setup(charge ? 1000 : -1000);
  expect(() => wrong.store.getState().classify("budget", wrong.card.id, wrong.card.revision, wrong.snapshot, { cardId: wrong.card.id, transactionId: wrong.row.id, fingerprint: wrong.row.fingerprint, kind, reason: "Wrong direction" })).toThrow("direction");
});
it("locks incoming transfers as payments and never treats an outgoing transfer as a cancelled payment", () => {
  const incoming = setup(1000, "peer");
  expect(activityKind(incoming.row, incoming.card, incoming.store.getState().workspaces.budget, incoming.snapshot)).toBe("payment");
  expect(() => incoming.store.getState().classify("budget", incoming.card.id, incoming.card.revision, incoming.snapshot, { cardId: incoming.card.id, transactionId: incoming.row.id, fingerprint: incoming.row.fingerprint, kind: "refund", reason: "Cannot relabel payment" })).toThrow("transfer");
  const outgoing = setup(-1000, "peer");
  outgoing.store.getState().classify("budget", outgoing.card.id, outgoing.card.revision, outgoing.snapshot, { cardId: outgoing.card.id, transactionId: outgoing.row.id, fingerprint: outgoing.row.fingerprint, kind: "cash-advance", reason: "Borrowing transfer" });
  expect(activityKind(outgoing.row, outgoing.card, outgoing.store.getState().workspaces.budget, outgoing.snapshot)).toBe("cash-advance");
  expect(outgoing.store.getState().workspaces.budget.allocations).toEqual([]);
});

it("defaults ordinary activity by direction while preserving mappings, manual edits and transfer uncertainty", () => {
  const { store, card, row, snapshot } = setup(-1000);
  const workspace = store.getState().workspaces.budget;
  expect(activityKind(row, card, workspace, snapshot)).toBe("purchase");
  expect(activityKind({ ...row, transferKnown: false }, card, workspace, snapshot)).toBe("ambiguous");
  expect(activityKind({ ...row, transferId: "peer" }, card, workspace, snapshot)).toBe("unclassified");
  expect(activityKind({ ...row, categoryId: "interest" }, { ...card, interestCategoryId: "interest" }, workspace, snapshot)).toBe("interest");
  expect(activityKind({ ...row, categoryId: "fees" }, { ...card, feeCategoryId: "fees" }, workspace, snapshot)).toBe("fee");
  store.getState().classify("budget", card.id, card.revision, snapshot, { cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind: "other-charge", reason: "Reviewed exception" });
  expect(activityKind(row, card, store.getState().workspaces.budget, snapshot)).toBe("other-charge");
});

it("applies bulk classifications atomically with one undo and rejects stale or wrong-direction selections", () => {
  const { store, card, row, snapshot } = setup(-1000);
  const second = { ...row, id: "second", fingerprint: "second" };
  const source = { ...snapshot, rows: [row, second] };
  const inputs = source.rows.map((entry) => ({ cardId: card.id, transactionId: entry.id, fingerprint: entry.fingerprint, kind: "purchase", reason: "Reviewed selection" }));
  const original = store.getState().workspaces.budget;
  expect(() => store.getState().classifyMany("budget", card.id, card.revision, source, [inputs[0], { ...inputs[1], kind: "refund" }])).toThrow("direction");
  expect(store.getState().workspaces.budget).toBe(original);
  expect(() => store.getState().classifyMany("budget", card.id, card.revision, source, [inputs[0], { ...inputs[1], fingerprint: "old" }])).toThrow();
  store.getState().classifyMany("budget", card.id, card.revision, source, inputs);
  expect(store.getState().workspaces.budget.classifications).toHaveLength(2);
  expect(store.getState().workspaces.budget.cards[0].revision).toBe(card.revision + 1);
  expect(() => store.getState().classifyMany("budget", card.id, card.revision, source, inputs)).toThrow("changed");
  store.getState().undo("budget");
  expect(store.getState().workspaces.budget.classifications).toEqual([]);
  expect(source.rows).toEqual([row, second]);
});

it("rejects overlapping fee and interest mappings without registering a card", () => {
  const { store, card } = setup(-1000);
  const input = card;
  expect(() => store.getState().register({ ...input, accountId: "second", interestCategoryId: "same", feeCategoryId: "same" })).toThrow();
  expect(store.getState().workspaces.budget.cards).toHaveLength(1);
});
