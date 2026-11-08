import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import { LATEST_SCHEMA_VERSION, runMigrations } from "./migrations";
import { applyAccountFlagChanges, listAccountFlags } from "./accountFlagRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  return getAppDb(join(mkdtempSync(join(tmpdir(), "actual-bench-account-flags-db-")), "metadata.sqlite"));
}

describe("account flag repository", () => {
  afterEach(() => resetAppDbForTests());

  it("turns a flag on and off, per account and per group", () => {
    const db = tempDb();
    applyAccountFlagChanges(db, { budgetSyncId: "b1", changes: [
      { scope: "account", id: "a1", flag: "excluded", on: true },
      { scope: "account", id: "a1", flag: "accessible", on: true },
      { scope: "group", id: "g1", flag: "excluded", on: true },
    ] });
    expect(listAccountFlags(db, "b1").map((r) => [r.scope, r.targetId, r.flag])).toEqual([["account", "a1", "accessible"], ["account", "a1", "excluded"], ["group", "g1", "excluded"]]);

    // Turning it on twice keeps one row; turning it off removes it.
    applyAccountFlagChanges(db, { budgetSyncId: "b1", changes: [{ scope: "account", id: "a1", flag: "accessible", on: true }, { scope: "account", id: "a1", flag: "excluded", on: false }] });
    expect(listAccountFlags(db, "b1").map((r) => [r.scope, r.targetId, r.flag])).toEqual([["account", "a1", "accessible"], ["group", "g1", "excluded"]]);
  });

  it("keeps budgets apart", () => {
    const db = tempDb();
    applyAccountFlagChanges(db, { budgetSyncId: "b1", changes: [{ scope: "account", id: "a1", flag: "offbudget-income", on: true }] });
    expect(listAccountFlags(db, "b2")).toEqual([]);
  });

  it("rejects an unknown flag, a group-only violation, bad shapes and duplicates, and applies nothing", () => {
    const db = tempDb();
    const apply = (changes: unknown[]) => () => applyAccountFlagChanges(db, { budgetSyncId: "b1", changes });
    expect(apply([{ scope: "account", id: "a1", flag: "nope", on: true }])).toThrow(AppDbValidationError);
    expect(apply([{ scope: "group", id: "g1", flag: "accessible", on: true }])).toThrow(/only be set on an account/);
    expect(apply([{ scope: "group", id: "g1", flag: "offbudget-income", on: true }])).toThrow(AppDbValidationError);
    expect(apply([{ scope: "other", id: "a1", flag: "excluded", on: true }])).toThrow(AppDbValidationError);
    expect(apply([{ scope: "account", id: "", flag: "excluded", on: true }])).toThrow(AppDbValidationError);
    expect(apply([{ scope: "account", id: "x".repeat(201), flag: "excluded", on: true }])).toThrow(AppDbValidationError);
    expect(apply([{ scope: "account", id: "a1", flag: "excluded", on: "yes" }])).toThrow(AppDbValidationError);
    expect(apply([{ scope: "account", id: "a1", flag: "excluded", on: true }, { scope: "account", id: "a1", flag: "excluded", on: false }])).toThrow(/Duplicate/);
    expect(apply([])).toThrow(AppDbValidationError);
    // One bad change fails the whole batch.
    expect(apply([{ scope: "account", id: "a1", flag: "excluded", on: true }, { scope: "account", id: "a2", flag: "bogus", on: true }])).toThrow(AppDbValidationError);
    expect(listAccountFlags(db, "b1")).toEqual([]);
  });

  it("limits a batch to 500 changes", () => {
    const db = tempDb();
    const many = Array.from({ length: 501 }, (_, i) => ({ scope: "account", id: `a${i}`, flag: "excluded", on: true }));
    expect(() => applyAccountFlagChanges(db, { budgetSyncId: "b1", changes: many })).toThrow(/500/);
    expect(() => applyAccountFlagChanges(db, { budgetSyncId: "b1", changes: many.slice(0, 500) })).not.toThrow();
  });

  it("reads tolerantly: rows with an unknown flag or scope are skipped", () => {
    const db = tempDb();
    db.prepare("INSERT INTO account_flags (budget_sync_id, scope, target_id, flag, updated_at) VALUES ('b1','account','a1','future-flag','t')").run();
    db.prepare("INSERT INTO account_flags (budget_sync_id, scope, target_id, flag, updated_at) VALUES ('b1','account','a2','excluded','t')").run();
    expect(listAccountFlags(db, "b1").map((r) => r.targetId)).toEqual(["a2"]);
  });

  it("exists on a new database at the latest version", () => {
    const db = tempDb();
    expect(runMigrations(db).schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBe(65);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_flags'").all()).toHaveLength(1);
  });
});
