import { createCreditCardStore } from "./store/store";
import { CreditCardUnavailableError, httpPersistence, memoryPersistence } from "./store/persistence";
import { CreditCardConflictError } from "@/lib/credit-cards/changes";
import { projectCardMinimums } from "./financialAdapter";
import { NEW_CARD_DEFAULTS, cardSchema, statementFactsSchema } from "./models";
import { parsePercentBps, formatPercentBps } from "./percent";
import { statementReview } from "./statements";
import { addStatement, addCard, BUDGET, CARD_INPUT, facts, row, setup, snapshot } from "./fixtures/testKit";

it("rejects an amount due above the balance or on a credit balance, and a minimum above the balance (CA-9)", () => {
  const parse = (balanceMinor: number, rest: object) => statementFactsSchema.safeParse({ ...facts("2026-03-10", balanceMinor), ...rest });
  expect(parse(1000, { amountDueMinor: 999999 }).success).toBe(false);
  expect(parse(-5000, { amountDueMinor: 10000 }).success).toBe(false);
  expect(parse(1000, { minimumDueMinor: 1001 }).success).toBe(false);
  expect(parse(1000, { amountDueMinor: 500, minimumDueMinor: 600 }).success).toBe(false);
  expect(parse(1000, { amountDueMinor: 1000, minimumDueMinor: 0 }).success).toBe(true);
});

it("reads percentages 0–100 with two decimals and never as money (CA-17)", () => {
  expect(parsePercentBps("24.99")).toBe(2499);
  expect(parsePercentBps("5%")).toBe(500);
  expect(parsePercentBps("")).toBeNull();
  expect(() => parsePercentBps("1,000")).toThrow();
  expect(() => parsePercentBps("100.01")).toThrow();
  expect(() => parsePercentBps("24.999")).toThrow();
  expect(formatPercentBps(2490)).toBe("24.9");
});

it("starts new cards on the 10th / 3rd and lets the first bank statement replace only default days (D18)", () => {
  const store = createCreditCardStore();
  const card = addCard(store, { ...CARD_INPUT, ...NEW_CARD_DEFAULTS });
  expect(card).toMatchObject({ closingDay: 10, dueRule: { kind: "day-of-month", value: 3 }, billingDaysSource: "default" });
  addStatement(store, BUDGET, card.id, { periodStart: "2026-02-01", closingDate: "2026-02-28", dueDate: "2026-03-20", balanceMinor: 0, minimumDueMinor: 0 });
  const updated = store.getState().workspaces[BUDGET].cards[0];
  expect(updated).toMatchObject({ closingDay: 31, dueRule: { kind: "day-of-month", value: 20 }, billingDaysSource: "statement" });
  expect(store.getState().notices[BUDGET]).toContain("billing days updated");
  // Days you set yourself are never replaced.
  const other = createCreditCardStore();
  const mine = addCard(other, { ...CARD_INPUT, closingDay: 15, billingDaysSource: "user" });
  addStatement(other, BUDGET, mine.id, facts("2026-02-10", 0));
  expect(other.getState().workspaces[BUDGET].cards[0].closingDay).toBe(15);
});

it("derives days-after-close when a day-of-month rule cannot reproduce the due date", () => {
  const store = createCreditCardStore();
  const card = addCard(store, { ...CARD_INPUT, ...NEW_CARD_DEFAULTS });
  addStatement(store, BUDGET, card.id, { periodStart: "2026-01-16", closingDate: "2026-02-15", dueDate: "2026-02-15", balanceMinor: 0, minimumDueMinor: 0 });
  expect(store.getState().workspaces[BUDGET].cards[0].dueRule).toEqual({ kind: "days-after-close", value: 0 });
});

it("clears the first tracked statement and falls back to the earliest saved statement (CA-16)", () => {
  const { store, cardId, card } = setup({}, [facts("2026-02-10", 0)]);
  expect(card().firstTrackedStatementDate).toBe("2026-02-10");
  const { id, revision, ...input } = card();
  store.getState().updateCard(BUDGET, id, revision, { ...input, firstTrackedStatementDate: null });
  expect(card().firstTrackedStatementDate).toBeNull();
  expect(() => store.getState().updateCard(BUDGET, cardId, card().revision, { ...input, firstTrackedStatementDate: "2026-03-10" }))
    .toThrow("Delete earlier saved statements");
});

it("keeps the session model to the durable shape: no removed card or statement fields", () => {
  const { card, saved } = setup({}, [facts("2026-02-10", 0)]);
  for (const field of ["nickname", "issuer", "last4", "rewards", "authorizedUsers", "cashAdvanceAprBps", "balanceTransferAprBps", "appearance", "customColor"]) {
    expect(card()).not.toHaveProperty(field);
  }
  for (const field of ["lifecycle", "coverage", "bankConfirmed", "verification", "reviewedSnapshot", "openingAnchor", "officialBalanceMinor"]) {
    expect(saved[0]).not.toHaveProperty(field);
  }
  expect(cardSchema.safeParse({ ...card(), status: "frozen" }).success).toBe(false);
});

it("rejects overlapping periods and duplicate closing dates atomically", () => {
  const { store, cardId, workspace } = setup({}, [facts("2026-02-10", 0)]);
  const before = workspace();
  expect(() => addStatement(store, BUDGET, cardId, facts("2026-02-10", 0))).toThrow("closing date");
  expect(() => addStatement(store, BUDGET, cardId, { ...facts("2026-03-10", 0), periodStart: "2026-02-01" })).toThrow("overlap");
  expect(workspace()).toBe(before);
});

it("moves a transaction between statements atomically and reopens the destination", () => {
  const { store, saved, workspace } = setup({}, [
    facts("2026-02-10", 0, { periodStart: "2026-01-11", previousBalanceMinor: 0 }),
    facts("2026-03-10", 50000),
  ]);
  const [first, second] = saved;
  const late = row({ id: "late", date: "2026-02-10", amount: -50000 });
  const source = snapshot([late]);
  store.getState().saveReview(BUDGET, first.id, 1, source, [{ transactionId: "late", decision: "excluded", bankPostingDate: null, note: null }], [
    { transactionId: "late", targetStatementId: second.id, expectedTargetRevision: 1 },
  ]);
  const after = workspace();
  expect(after.decisions.filter((entry) => entry.transactionId === "late").map((entry) => [entry.statementId, entry.decision]).sort())
    .toEqual([[first.id, "excluded"], [second.id, "included"]].sort());
  const target = after.statements.find((entry) => entry.id === second.id)!;
  expect(target).toMatchObject({ revision: 2, reviewState: "not_reviewed" });
  expect(statementReview(target, after, source).memberships[0].decision).toBe("included");
  // A stale destination revision is rejected without writing anything.
  expect(() => store.getState().saveReview(BUDGET, first.id, 2, source, [], [
    { transactionId: "late", targetStatementId: second.id, expectedTargetRevision: 1 },
  ])).toThrow("This record changed");
});

it("refuses Undo after another tab changed the records instead of discarding them", async () => {
  const shared = memoryPersistence();
  const tab = createCreditCardStore(shared);
  const other = createCreditCardStore(shared);
  const card = addCard(tab, CARD_INPUT);
  const statement = addStatement(tab, BUDGET, card.id, facts("2026-02-10", 0));
  await other.getState().load(BUDGET);
  await other.getState().deleteStatement(BUDGET, statement.id, statement.revision);
  await tab.getState().undo(BUDGET);
  expect(tab.getState().notices[BUDGET]).toContain("Can't undo");
  expect(tab.getState().workspaces[BUDGET].statements).toEqual([]);
  expect(shared.read(BUDGET)).toEqual(tab.getState().workspaces[BUDGET]);
});

it("keeps the cache unchanged and rejects with a conflict when a save is stale", async () => {
  const shared = memoryPersistence();
  const tab = createCreditCardStore(shared);
  const other = createCreditCardStore(shared);
  const card = addCard(tab, CARD_INPUT);
  await other.getState().load(BUDGET);
  await other.getState().updateCard(BUDGET, card.id, card.revision, { ...CARD_INPUT, creditLimitMinor: 900_000 });
  await expect(tab.getState().updateCard(BUDGET, card.id, card.revision, { ...CARD_INPUT, creditLimitMinor: 100 }))
    .rejects.toBeInstanceOf(CreditCardConflictError);
  expect(tab.getState().workspaces[BUDGET].cards[0].creditLimitMinor).toBe(900_000);
});

it("shows storage as unavailable and recovers on retry", async () => {
  let fail = true;
  const memory = memoryPersistence();
  const store = createCreditCardStore({ read: (budget) => { if (fail) throw new Error("App database locked"); return memory.read(budget); }, commit: memory.commit });
  await store.getState().load(BUDGET);
  expect(store.getState().status[BUDGET]).toEqual({ state: "unavailable", error: "App database locked" });
  fail = false;
  await store.getState().load(BUDGET, true);
  expect(store.getState().status[BUDGET]).toEqual({ state: "ready" });
});

it("deletes one card with all its records and supports Undo", () => {
  const { store, card, workspace } = setup({}, [facts("2026-02-10", 0)]);
  store.getState().deleteCard(BUDGET, card().id, card().revision);
  expect(workspace()).toMatchObject({ cards: [], statements: [] });
  store.getState().undo(BUDGET);
  expect(workspace().cards).toHaveLength(1);
  expect(workspace().statements).toHaveLength(1);
});

it("stops the payoff illustration at the first cycle the minimum does not amortise (CA-14)", () => {
  const { card } = setup({ minimumPercentBps: 100, minimumFloorMinor: null });
  const started = performance.now();
  const result = projectCardMinimums(card(), "2026-03-15", 500000);
  expect(performance.now() - started).toBeLessThan(500);
  expect(result).toMatchObject({ ok: true, neverPaysOff: true, payoffDate: null });
});

it("keeps Undo available after a failure that changed nothing, so it can be retried", async () => {
  const memory = memoryPersistence();
  let fail = false;
  const store = createCreditCardStore({ read: memory.read, commit: (budget, changes) => {
    if (fail) throw new CreditCardUnavailableError();
    return memory.commit(budget, changes);
  } });
  const card = addCard(store, CARD_INPUT);
  addStatement(store, BUDGET, card.id, facts("2026-02-10", 0));
  fail = true;
  await store.getState().undo(BUDGET);
  expect(store.getState().notices[BUDGET]).toContain("Try again");
  expect(store.getState().workspaces[BUDGET].statements).toHaveLength(1);
  fail = false;
  await store.getState().undo(BUDGET);
  expect(store.getState().workspaces[BUDGET].statements).toEqual([]);
});

it("reports only HTTP 503 as storage unavailable and keeps other server messages", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch");
  try {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Request body too large" }), { status: 413 }));
    await expect(httpPersistence.read(BUDGET)).rejects.toThrow("Request body too large");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(httpPersistence.read(BUDGET)).rejects.toBeInstanceOf(CreditCardUnavailableError);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(httpPersistence.read(BUDGET)).rejects.toThrow("(500)");
  } finally {
    fetchMock.mockRestore();
  }
});

it("never accepts the card's own account, or an account missing from the budget, as a plan account", () => {
  const { store, card } = setup({});
  const plan = { id: "plan", cardId: card().id, revision: 1, name: "Laptop", recordedAs: "plan-account" as const, originalAmountMinor: 1000, startDate: "2026-02-01" };
  const accounts = snapshot([], { accounts: [{ id: "plan-off", name: "Plan", offBudget: true, closed: false }] });
  expect(() => store.getState().savePlan(BUDGET, null, accounts, { ...plan, planAccountId: card().accountId }, [])).toThrow("its own plan account");
  expect(() => store.getState().savePlan(BUDGET, null, accounts, { ...plan, planAccountId: "missing" }, [])).toThrow("not in your budget");
});
