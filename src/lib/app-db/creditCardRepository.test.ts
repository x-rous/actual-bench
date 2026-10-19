import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import { applyCreditCardChanges, readCreditCardWorkspace } from "./creditCardRepository";
import type { SqliteDatabase } from "./types";
import { diffWorkspaces, EMPTY_CHANGES, type ChangeSet } from "@/lib/credit-cards/changes";
import { cardSchema, EMPTY_WORKSPACE, NEW_CARD_DEFAULTS, statementSchema } from "@/lib/credit-cards/schema";
import type { CreditCardPersistence } from "@/features/credit-cards/lib/store/persistence";
import { createCreditCardStore } from "@/features/credit-cards/lib/store/store";
import { statementScenario } from "@/features/credit-cards/lib/statementScenarios.fixture";
import { BUDGET, laptopPlanScenario, setup, facts } from "@/features/credit-cards/lib/fixtures/testKit";

function tempDb(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-credit-card-db-"));
  return getAppDb(join(root, "metadata.sqlite"));
}

/** The repository as the store sees it; payloads go through JSON exactly as over HTTP. */
function direct(db: SqliteDatabase): CreditCardPersistence {
  return {
    read: (budget) => readCreditCardWorkspace(db, budget).workspace,
    commit: (budget, changes) => applyCreditCardChanges(db, JSON.parse(JSON.stringify({ budgetSyncId: budget, changes }))),
  };
}

const card = (id: string, extra: Record<string, unknown> = {}) => cardSchema.parse({
  ...NEW_CARD_DEFAULTS, budgetSyncId: BUDGET, accountId: `account-${id}`, bankTimeZone: "UTC", billingDaysSource: "user", id, revision: 1, ...extra,
});
const statement = (id: string, cardId: string, closingDate: string, extra: Record<string, unknown> = {}) => statementSchema.parse({
  ...facts(closingDate, 10000), id, cardId, revision: 1, reviewState: "not_reviewed", reviewHash: null, reviewedAt: null,
  amountDueMinor: null, previousBalanceMinor: null, scopeAcceptedDifferenceMinor: null, ...extra,
});
const changes = (patch: Partial<ChangeSet>): ChangeSet => ({ ...EMPTY_CHANGES, ...patch });
const count = (db: SqliteDatabase, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("credit-card repository", () => {
  afterEach(() => resetAppDbForTests());

  it("stores what the store commits: the SQLite read equals the store's cache for a year of reviewed statements", () => {
    const db = tempDb();
    const { store: stored } = statementScenario("carry", createCreditCardStore(direct(db)));
    expect(readCreditCardWorkspace(db, "scenarios")).toEqual({ workspace: stored.getState().workspaces.scenarios, unsupported: 0 });
    expect(stored.getState().workspaces.scenarios.statements.filter((entry) => entry.reviewState !== "not_reviewed")).toHaveLength(13);
  });

  it("round-trips plans, plan accounts, entries and types, keeping NULL apart from 0", () => {
    const db = tempDb();
    const scenario = laptopPlanScenario(direct(db));
    scenario.store.getState().setTypes(BUDGET, scenario.cardId, scenario.snapshot, [{ transactionId: "laptop", kind: "purchase", note: "work laptop" }]);
    const workspace = scenario.workspace();
    expect(workspace.planAccounts).toEqual(["plan-laptop"]);
    expect(workspace.typeCorrections).toHaveLength(1);
    expect(workspace.statements[0]).toMatchObject({ balanceMinor: 0, previousBalanceMinor: 0, amountDueMinor: null });
    expect(workspace.cards[0]).toMatchObject({ purchaseAprBps: null, minimumPercentBps: 500 });
    expect(readCreditCardWorkspace(db, BUDGET).workspace).toEqual(workspace);
  });

  it("writes the first statement's billing days with the statement, in one transaction (D18)", () => {
    const db = tempDb();
    const { store, card: current } = setup({ billingDaysSource: "default" }, [facts("2026-03-28", 0, { dueDate: "2026-04-22" })], direct(db));
    expect(current()).toMatchObject({ closingDay: 28, billingDaysSource: "statement" });
    expect(readCreditCardWorkspace(db, BUDGET).workspace.cards[0]).toEqual(store.getState().workspaces[BUDGET].cards[0]);
  });

  it("rejects a stale revision with a conflict and writes nothing from that change set", () => {
    const db = tempDb();
    applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes({ cards: { put: [card("a")], remove: [] } }) });
    const stale = changes({
      cards: { put: [card("a", { creditLimitMinor: 5, revision: 3 }), card("b")], remove: [] },
    });
    expect(() => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: stale })).toThrow(AppDbConflictError);
    expect(readCreditCardWorkspace(db, BUDGET).workspace.cards.map((entry) => entry.id)).toEqual(["a"]);
    expect(() => applyCreditCardChanges(db, {
      budgetSyncId: BUDGET, changes: changes({ cards: { put: [], remove: [{ id: "a", revision: 2 }] } }),
    })).toThrow(AppDbConflictError);
  });

  it("enforces the repository rules and rolls back the whole change set", () => {
    const db = tempDb();
    applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes({ cards: { put: [card("a")], remove: [] } }) });
    const duplicate = changes({
      cards: { put: [card("b")], remove: [] },
      statements: { put: [statement("s1", "a", "2026-03-10"), statement("s2", "a", "2026-03-10", { periodStart: "2026-03-01" })], remove: [] },
    });
    expect(() => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: duplicate })).toThrow(AppDbValidationError);
    const sameAccount = changes({ cards: { put: [card("c", { accountId: "account-a" })], remove: [] } });
    expect(() => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: sameAccount })).toThrow(AppDbValidationError);
    const otherBudget = changes({ cards: { put: [card("d", { budgetSyncId: "elsewhere" })], remove: [] } });
    expect(() => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: otherBudget })).toThrow(AppDbValidationError);
    expect(count(db, "credit_cards")).toBe(1);
    expect(count(db, "credit_card_statements")).toBe(0);
  });

  it("rejects malformed payloads before touching the database", () => {
    const db = tempDb();
    expect(() => applyCreditCardChanges(db, { budgetSyncId: "", changes: EMPTY_CHANGES })).toThrow(AppDbValidationError);
    expect(() => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: { ...EMPTY_CHANGES, extra: 1 } })).toThrow(AppDbValidationError);
    expect(() => applyCreditCardChanges(db, {
      budgetSyncId: BUDGET, changes: changes({ cards: { put: [{ ...card("a"), creditLimitMinor: 1.5 }], remove: [] } }),
    })).toThrow(AppDbValidationError);
    expect(count(db, "credit_cards")).toBe(0);
  });

  it("deletes a card with its statements, decisions, types, plans and entries, and keeps other budgets", () => {
    const db = tempDb();
    const scenario = laptopPlanScenario(direct(db));
    scenario.store.getState().setTypes(BUDGET, scenario.cardId, scenario.snapshot, [{ transactionId: "laptop", kind: "purchase" }]);
    applyCreditCardChanges(db, { budgetSyncId: "other", changes: changes({ cards: { put: [card("z", { budgetSyncId: "other" })], remove: [] } }) });
    const before = scenario.workspace();
    expect(before.plans).toHaveLength(1);
    scenario.store.getState().deleteCard(BUDGET, scenario.cardId, scenario.card().revision);
    for (const table of ["credit_card_statements", "credit_card_statement_decisions", "credit_card_transaction_types", "credit_card_plans", "credit_card_plan_entries"]) {
      expect([table, count(db, table)]).toEqual([table, 0]);
    }
    expect(readCreditCardWorkspace(db, "other").workspace.cards.map((entry) => entry.id)).toEqual(["z"]);
  });

  it("moves a transaction between statements atomically", () => {
    const db = tempDb();
    const commit = (patch: Partial<ChangeSet>) => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes(patch) });
    commit({
      cards: { put: [card("a")], remove: [] },
      statements: { put: [statement("s1", "a", "2026-03-10"), statement("s2", "a", "2026-04-10", { periodStart: "2026-03-11" })], remove: [] },
    });
    const decision = (statementId: string) => ({ statementId, cardId: "a", transactionId: "t1", decision: "included" as const, origin: "user" as const, bankPostingDate: null, sourceHash: "cc-v2-abcdef", note: null });
    const after = commit({ statements: { put: [statement("s1", "a", "2026-03-10", { revision: 2 })], remove: [] }, decisions: [{ statementId: "s1", rows: [decision("s1")] }] });
    const s1 = after.statements.find((entry) => entry.id === "s1")!;
    const s2 = after.statements.find((entry) => entry.id === "s2")!;
    // Including the row on both statements breaks "one bill per transaction"; nothing is written.
    expect(() => commit({ statements: { put: [{ ...s2, revision: 2 }], remove: [] }, decisions: [{ statementId: "s2", rows: [decision("s2")] }] }))
      .toThrow(AppDbValidationError);
    const moved = commit({
      statements: { put: [{ ...s1, revision: 3 }, { ...s2, revision: 2 }], remove: [] },
      decisions: [{ statementId: "s1", rows: [] }, { statementId: "s2", rows: [decision("s2")] }],
    });
    expect(moved.decisions).toEqual([decision("s2")]);
    // The reverse move while both statements hold decisions: s1 is written first and must not meet s2's old row.
    const other = { ...decision("s1"), transactionId: "t2" };
    const withOther = commit({
      statements: { put: [{ ...moved.statements.find((entry) => entry.id === "s1")!, revision: 4 }], remove: [] },
      decisions: [{ statementId: "s1", rows: [other] }],
    });
    const back = commit({
      statements: { put: withOther.statements.map((entry) => ({ ...entry, revision: entry.revision + 1 })), remove: [] },
      decisions: [{ statementId: "s1", rows: [other, decision("s1")] }, { statementId: "s2", rows: [] }],
    });
    expect(back.decisions).toEqual(expect.arrayContaining([other, decision("s1")]));
    expect(back.decisions).toHaveLength(2);
  });

  it("skips rows a newer build wrote instead of failing or rewriting them", () => {
    const db = tempDb();
    applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes({ cards: { put: [card("a")], remove: [] } }) });
    db.prepare(`INSERT INTO credit_cards (id, budget_sync_id, account_id, network, bank_time_zone, revision, created_at, updated_at)
      VALUES ('future', ?, 'account-future', 'future-network', 'UTC', 1, 'now', 'now')`).run(BUDGET);
    const read = readCreditCardWorkspace(db, BUDGET);
    expect(read.unsupported).toBe(1);
    expect(read.workspace.cards.map((entry) => entry.id)).toEqual(["a"]);
    applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes({ cards: { put: [card("a", { revision: 2, creditLimitMinor: 0 })], remove: [] } }) });
    expect((db.prepare("SELECT network FROM credit_cards WHERE id = 'future'").get() as { network: string }).network).toBe("future-network");
  });

  it("applies an empty diff as a no-op", () => {
    const db = tempDb();
    expect(applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: diffWorkspaces(EMPTY_WORKSPACE, EMPTY_WORKSPACE) })).toEqual(EMPTY_WORKSPACE);
  });
});

describe("credit-limit changes", () => {
  afterEach(() => resetAppDbForTests());

  it("saves a card's limit history with the card, keeps it in date order, undoes it, and deletes it with the card", async () => {
    const db = tempDb();
    const { store, cardId, workspace } = setup({ creditLimitMinor: 1500000 }, [], direct(db));
    const current = () => workspace().cards[0];
    const { id, revision, ...input } = current();
    void id;
    await store.getState().updateCard(BUDGET, cardId, revision, input, [
      { effectiveDate: "2026-09-14", limitMinor: 4000000 },
      { effectiveDate: "2026-03-02", limitMinor: 2500000 },
    ]);
    expect(readCreditCardWorkspace(db, BUDGET).workspace.limitChanges).toEqual([
      { cardId, effectiveDate: "2026-03-02", limitMinor: 2500000 },
      { cardId, effectiveDate: "2026-09-14", limitMinor: 4000000 },
    ]);
    expect(readCreditCardWorkspace(db, BUDGET).workspace).toEqual(workspace());
    // Undo removes the history it added, with the card's settings.
    await store.getState().undo(BUDGET);
    expect(count(db, "credit_card_limit_changes")).toBe(0);
    // Settings saves without a list keep the history.
    const { id: again, revision: next, ...same } = current();
    void again;
    await store.getState().updateCard(BUDGET, cardId, next, same, [{ effectiveDate: "2026-03-02", limitMinor: 2500000 }]);
    const { id: third, revision: last, ...rest } = current();
    void third;
    await store.getState().updateCard(BUDGET, cardId, last, { ...rest, creditLimitMinor: 1600000 });
    expect(count(db, "credit_card_limit_changes")).toBe(1);
    await store.getState().deleteCard(BUDGET, cardId, current().revision);
    expect(count(db, "credit_card_limit_changes")).toBe(0);
  });

  it("rejects two changes on one date and changes sent without their card", () => {
    const db = tempDb();
    const saved = applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes({ cards: { put: [card("a")], remove: [] } }) });
    const next = { ...saved.cards[0], revision: 2 };
    const twice = [{ cardId: "a", effectiveDate: "2026-05-01", limitMinor: 100 }, { cardId: "a", effectiveDate: "2026-05-01", limitMinor: 200 }];
    expect(() => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes({
      cards: { put: [next], remove: [] }, limitChanges: [{ cardId: "a", rows: twice }],
    }) })).toThrow(AppDbValidationError);
    expect(() => applyCreditCardChanges(db, { budgetSyncId: BUDGET, changes: changes({
      limitChanges: [{ cardId: "a", rows: [twice[0]] }],
    }) })).toThrow(AppDbValidationError);
    expect(count(db, "credit_card_limit_changes")).toBe(0);
  });
});
