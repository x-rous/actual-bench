import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { AppDbValidationError } from "./errors";
import {
  createReconciliationSession,
  deleteReconciliationProfile,
  deleteReconciliationSession,
  getReconciliationSession,
  listReconciliationItems,
  listReconciliationProfiles,
  listReconciliationSessions,
  listStatementRows,
  replaceReconciliationItems,
  replaceStatementRows,
  saveReconciliationProfile,
  updateReconciliationItem,
  updateReconciliationSession,
} from "./reconciliationRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-reconciliation-db-"));
  return getAppDb(join(root, "metadata.sqlite"));
}

function newSession(db: SqliteDatabase) {
  return createReconciliationSession(db, {
    budgetSyncId: "budget-1",
    accountId: "acct-1",
    accountName: "Global Money Credit Card",
    statementName: "GMCC_JUL_2026.csv",
  });
}

const ROW = {
  id: "srow-1",
  sourceRowNumber: 2,
  postedDate: "2026-07-01",
  amount: -34285,
  description: "CARREFOUR MARKET",
  fingerprint: "abc12345",
  raw: { Date: "2026-07-01", Amount: "-342.85" },
};

describe("reconciliation sessions", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates a session in draft and reads it back", () => {
    const db = tempDb();
    const session = newSession(db);

    expect(session.status).toBe("draft");
    expect(session.accountName).toBe("Global Money Credit Card");
    expect(getReconciliationSession(db, session.id)).toEqual(session);
  });

  it("lists sessions for a budget, most recently updated first", () => {
    const db = tempDb();
    const first = newSession(db);
    const second = newSession(db);
    updateReconciliationSession(db, first.id, { status: "parsed" });

    const listed = listReconciliationSessions(db, "budget-1");
    expect(listed.map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it("does not leak sessions across budgets", () => {
    const db = tempDb();
    newSession(db);
    createReconciliationSession(db, { budgetSyncId: "budget-2", accountId: "acct-9" });

    expect(listReconciliationSessions(db, "budget-1")).toHaveLength(1);
    expect(listReconciliationSessions(db, "budget-2")).toHaveLength(1);
  });

  it("updates only the supplied fields", () => {
    const db = tempDb();
    const session = newSession(db);

    const updated = updateReconciliationSession(db, session.id, {
      status: "needs_review",
      statementStart: "2026-07-01",
      statementEnd: "2026-07-31",
      totals: { debits: -47085, credits: 500000, net: 452915, rowCount: 3 },
    });

    expect(updated?.status).toBe("needs_review");
    expect(updated?.statementStart).toBe("2026-07-01");
    // Untouched fields survive.
    expect(updated?.accountName).toBe("Global Money Credit Card");
    expect(updated?.totals).toEqual({
      debits: -47085,
      credits: 500000,
      net: 452915,
      rowCount: 3,
    });
  });

  it("rejects an unknown status rather than persisting it", () => {
    const db = tempDb();
    const session = newSession(db);
    expect(() =>
      updateReconciliationSession(db, session.id, {
        status: "whatever" as never,
      })
    ).toThrow(AppDbValidationError);
  });

  it("supports the partial state so a half-applied session stays resumable", () => {
    const db = tempDb();
    const session = newSession(db);
    expect(updateReconciliationSession(db, session.id, { status: "partial" })?.status).toBe(
      "partial"
    );
  });

  it("returns null when updating a session that does not exist", () => {
    const db = tempDb();
    expect(updateReconciliationSession(db, "missing", { status: "ready" })).toBeNull();
  });
});

describe("statement rows", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("stores rows with the raw source intact", () => {
    const db = tempDb();
    const session = newSession(db);
    replaceStatementRows(db, session.id, [ROW]);

    const [stored] = listStatementRows(db, session.id);
    expect(stored.raw).toEqual({ Date: "2026-07-01", Amount: "-342.85" });
    expect(stored.amount).toBe(-34285);
    expect(stored.fingerprint).toBe("abc12345");
    expect(stored.reference).toBeNull();
  });

  it("replaces rather than appends, so a re-import leaves nothing behind", () => {
    const db = tempDb();
    const session = newSession(db);

    replaceStatementRows(db, session.id, [ROW, { ...ROW, id: "srow-2", sourceRowNumber: 3 }]);
    replaceStatementRows(db, session.id, [{ ...ROW, id: "srow-9", sourceRowNumber: 2 }]);

    const rows = listStatementRows(db, session.id);
    expect(rows.map((r) => r.id)).toEqual(["srow-9"]);
  });

  it("orders by source row number", () => {
    const db = tempDb();
    const session = newSession(db);
    replaceStatementRows(db, session.id, [
      { ...ROW, id: "b", sourceRowNumber: 9 },
      { ...ROW, id: "a", sourceRowNumber: 2 },
    ]);
    expect(listStatementRows(db, session.id).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("rejects a non-integer amount instead of persisting a float", () => {
    const db = tempDb();
    const session = newSession(db);
    expect(() =>
      replaceStatementRows(db, session.id, [{ ...ROW, amount: -342.85 }])
    ).toThrow(AppDbValidationError);
  });

  it("leaves the previous rows untouched when a batch fails mid-write", () => {
    const db = tempDb();
    const session = newSession(db);
    replaceStatementRows(db, session.id, [ROW]);

    expect(() =>
      replaceStatementRows(db, session.id, [
        { ...ROW, id: "good", sourceRowNumber: 5 },
        { ...ROW, id: "bad", sourceRowNumber: 6, amount: 1.5 },
      ])
    ).toThrow(AppDbValidationError);

    // The transaction rolled back: the original row is still there.
    expect(listStatementRows(db, session.id).map((r) => r.id)).toEqual(["srow-1"]);
  });

  it("cascades away when the session is deleted", () => {
    const db = tempDb();
    const session = newSession(db);
    replaceStatementRows(db, session.id, [ROW]);

    expect(deleteReconciliationSession(db, session.id)).toBe(true);
    expect(listStatementRows(db, session.id)).toEqual([]);
  });
});

describe("reconciliation items", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("round-trips the match, guards, snapshot, and staged changes", () => {
    const db = tempDb();
    const session = newSession(db);

    replaceReconciliationItems(db, session.id, [
      {
        id: "item-1",
        statementRowIds: ["srow-1"],
        actualTransactionIds: ["t1"],
        disposition: "matched",
        match: {
          type: "suggested",
          evidenceSource: "bench",
          confidence: 94,
          label: "high",
          reasons: [{ kind: "amount", verdict: "exact" }],
        },
        guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
        actualSnapshot: { id: "t1", notes: "Imported #One" },
        stagedChanges: {
          notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" },
        },
      },
    ]);

    const [item] = listReconciliationItems(db, session.id);
    expect(item.statementRowIds).toEqual(["srow-1"]);
    expect(item.actualTransactionIds).toEqual(["t1"]);
    expect(item.guards).toEqual({ protectedReconciled: false, splitParent: false, transfer: "no" });
    expect(item.stagedChanges).toEqual({
      notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" },
    });
  });

  it("stores id arrays so a grouped relationship needs no migration", () => {
    const db = tempDb();
    const session = newSession(db);

    replaceReconciliationItems(db, session.id, [
      {
        id: "grouped",
        statementRowIds: ["srow-1"],
        actualTransactionIds: ["t1", "t2"],
        disposition: "matched",
      },
    ]);

    expect(listReconciliationItems(db, session.id)[0].actualTransactionIds).toEqual(["t1", "t2"]);
  });

  it("defaults empty id arrays for an Actual-only item", () => {
    const db = tempDb();
    const session = newSession(db);
    replaceReconciliationItems(db, session.id, [
      { id: "actual-only", actualTransactionIds: ["t9"], disposition: "keep" },
    ]);

    const [item] = listReconciliationItems(db, session.id);
    expect(item.statementRowIds).toEqual([]);
    expect(item.actualTransactionIds).toEqual(["t9"]);
  });

  it("updates one item without disturbing the others", () => {
    const db = tempDb();
    const session = newSession(db);
    replaceReconciliationItems(db, session.id, [
      { id: "a", disposition: "unresolved" },
      { id: "b", disposition: "unresolved" },
    ]);

    const updated = updateReconciliationItem(db, "a", {
      disposition: "delete",
      reasonCode: "erroneous-automation",
    });

    expect(updated?.disposition).toBe("delete");
    expect(updated?.reasonCode).toBe("erroneous-automation");
    expect(listReconciliationItems(db, session.id).find((i) => i.id === "b")?.disposition).toBe(
      "unresolved"
    );
  });

  it("returns null when updating an item that does not exist", () => {
    const db = tempDb();
    expect(updateReconciliationItem(db, "missing", { disposition: "keep" })).toBeNull();
  });

  it("cascades away when the session is deleted", () => {
    const db = tempDb();
    const session = newSession(db);
    replaceReconciliationItems(db, session.id, [{ id: "a", disposition: "matched" }]);

    deleteReconciliationSession(db, session.id);
    expect(listReconciliationItems(db, session.id)).toEqual([]);
  });
});

describe("import profiles", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  const profile = {
    budgetSyncId: "budget-1",
    accountId: "acct-1",
    name: "Global Money Credit Card Statement",
    mapping: { date: 0, description: 1, amount: 2, dateFormat: "dmy" },
    matchConfig: { dateToleranceDays: 7, text: { combine: "best-of" } },
  };

  it("saves and lists a profile for an account", () => {
    const db = tempDb();
    const saved = saveReconciliationProfile(db, profile);

    expect(saved.name).toBe(profile.name);
    expect(saved.matchConfig).toEqual(profile.matchConfig);
    expect(listReconciliationProfiles(db, "budget-1", "acct-1")).toHaveLength(1);
  });

  it("upserts on re-save rather than failing the unique constraint", () => {
    const db = tempDb();
    const first = saveReconciliationProfile(db, profile);
    const second = saveReconciliationProfile(db, {
      ...profile,
      mapping: { date: 1, description: 2, amount: 3, dateFormat: "iso" },
    });

    expect(second.id).toBe(first.id);
    expect(second.mapping).toEqual({ date: 1, description: 2, amount: 3, dateFormat: "iso" });
    expect(listReconciliationProfiles(db, "budget-1", "acct-1")).toHaveLength(1);
  });

  it("keeps profiles for different accounts separate", () => {
    const db = tempDb();
    saveReconciliationProfile(db, profile);
    saveReconciliationProfile(db, { ...profile, accountId: "acct-2" });

    expect(listReconciliationProfiles(db, "budget-1", "acct-1")).toHaveLength(1);
    expect(listReconciliationProfiles(db, "budget-1")).toHaveLength(2);
  });

  it("requires a name", () => {
    const db = tempDb();
    expect(() => saveReconciliationProfile(db, { ...profile, name: "  " })).toThrow(
      AppDbValidationError
    );
  });

  it("deletes a profile without deleting sessions that referenced it", () => {
    const db = tempDb();
    const saved = saveReconciliationProfile(db, profile);
    const session = createReconciliationSession(db, {
      budgetSyncId: "budget-1",
      accountId: "acct-1",
      profileId: saved.id,
    });

    expect(deleteReconciliationProfile(db, saved.id)).toBe(true);
    // ON DELETE SET NULL: the session survives with no profile.
    expect(getReconciliationSession(db, session.id)?.profileId).toBeNull();
  });
});
