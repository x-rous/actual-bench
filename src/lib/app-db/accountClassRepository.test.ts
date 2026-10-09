import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import { applyAccountClassChanges, listAccountClasses } from "./accountClassRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-account-class-db-"));
  return getAppDb(join(root, "metadata.sqlite"));
}

describe("account class repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("sets and lists account and group types", () => {
    const db = tempDb();
    const list = applyAccountClassChanges(db, {
      budgetSyncId: "b1",
      changes: [
        { scope: "account", id: "a1", accountClass: "bank" },
        { scope: "group", id: "g1", accountClass: "credit-card" },
      ],
    });
    expect(list.map((r) => [r.scope, r.accountId, r.accountClass])).toEqual([
      ["account", "a1", "bank"],
      ["group", "g1", "credit-card"],
    ]);
  });

  it("replaces an existing class and removes one with null", () => {
    const db = tempDb();
    applyAccountClassChanges(db, { budgetSyncId: "b1", changes: [{ scope: "account", id: "a1", accountClass: "bank" }] });
    applyAccountClassChanges(db, { budgetSyncId: "b1", changes: [{ scope: "account", id: "a1", accountClass: "cash" }] });
    expect(listAccountClasses(db, "b1").map((r) => r.accountClass)).toEqual(["cash"]);

    applyAccountClassChanges(db, { budgetSyncId: "b1", changes: [{ scope: "account", id: "a1", accountClass: null }] });
    expect(listAccountClasses(db, "b1")).toEqual([]);
  });

  it("scopes classes to one budget", () => {
    const db = tempDb();
    applyAccountClassChanges(db, { budgetSyncId: "b1", changes: [{ scope: "account", id: "a1", accountClass: "bank" }] });
    applyAccountClassChanges(db, { budgetSyncId: "b2", changes: [{ scope: "account", id: "a1", accountClass: "loan" }] });
    expect(listAccountClasses(db, "b1")[0].accountClass).toBe("bank");
    expect(listAccountClasses(db, "b2")[0].accountClass).toBe("loan");
  });

  it("keeps an account and a group with the same id separate", () => {
    const db = tempDb();
    applyAccountClassChanges(db, {
      budgetSyncId: "b1",
      changes: [
        { scope: "account", id: "x", accountClass: "bank" },
        { scope: "group", id: "x", accountClass: "loan" },
      ],
    });
    expect(listAccountClasses(db, "b1")).toHaveLength(2);
  });

  it("applies a batch atomically: nothing is written when one change is invalid", () => {
    const db = tempDb();
    expect(() =>
      applyAccountClassChanges(db, {
        budgetSyncId: "b1",
        changes: [
          { scope: "account", id: "a1", accountClass: "bank" },
          { scope: "account", id: "a2", accountClass: "offset" },
        ],
      })
    ).toThrow(AppDbValidationError);
    expect(listAccountClasses(db, "b1")).toEqual([]);
  });

  it.each([
    [null],
    [{ changes: [] }],
    [{ budgetSyncId: "b1", changes: [] }],
    [{ budgetSyncId: "b1", changes: [{ scope: "payee", id: "a", accountClass: "bank" }] }],
    [{ budgetSyncId: "b1", changes: [{ scope: "account", id: "", accountClass: "bank" }] }],
    [{ budgetSyncId: "b1", changes: [{ scope: "account", id: "a", accountClass: undefined }] }],
    [{ budgetSyncId: "b1", changes: [{ scope: "account", id: "a", accountClass: "bank" }, { scope: "account", id: "a", accountClass: "cash" }] }],
  ])("rejects an invalid payload %#", (payload) => {
    expect(() => applyAccountClassChanges(tempDb(), payload)).toThrow(AppDbValidationError);
  });

  it("skips stored rows with an unknown class instead of failing", () => {
    const db = tempDb();
    db.prepare(
      "INSERT INTO account_classes (budget_sync_id, scope, account_id, account_class, updated_at) VALUES ('b1','account','a1','from-a-newer-version','2026-01-01')"
    ).run();
    applyAccountClassChanges(db, { budgetSyncId: "b1", changes: [{ scope: "account", id: "a2", accountClass: "bank" }] });
    expect(listAccountClasses(db, "b1").map((r) => r.accountId)).toEqual(["a2"]);
  });
});
