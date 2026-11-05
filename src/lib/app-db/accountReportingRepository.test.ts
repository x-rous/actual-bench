import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import { LATEST_SCHEMA_VERSION, runMigrations } from "./migrations";
import { applyAccountReportingChanges, listAccountReporting } from "./accountReportingRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  return getAppDb(join(mkdtempSync(join(tmpdir(), "actual-bench-account-reporting-db-")), "metadata.sqlite"));
}

describe("account reporting repository", () => {
  afterEach(() => resetAppDbForTests());

  it("sets, replaces and removes a choice", () => {
    const db = tempDb();
    applyAccountReportingChanges(db, { budgetSyncId: "b1", changes: [{ accountId: "a1", treatment: "current-investment" }] });
    applyAccountReportingChanges(db, { budgetSyncId: "b1", changes: [{ accountId: "a1", treatment: "non-current-investment" }] });
    expect(listAccountReporting(db, "b1").map((r) => [r.accountId, r.treatment])).toEqual([["a1", "non-current-investment"]]);

    applyAccountReportingChanges(db, { budgetSyncId: "b1", changes: [{ accountId: "a1", treatment: null }] });
    expect(listAccountReporting(db, "b1")).toEqual([]);
  });

  it("scopes choices to one budget", () => {
    const db = tempDb();
    applyAccountReportingChanges(db, { budgetSyncId: "b1", changes: [{ accountId: "a1", treatment: "non-current-asset" }] });
    applyAccountReportingChanges(db, { budgetSyncId: "b2", changes: [{ accountId: "a1", treatment: "current-asset" }] });
    expect(listAccountReporting(db, "b1")[0].treatment).toBe("non-current-asset");
    expect(listAccountReporting(db, "b2")[0].treatment).toBe("current-asset");
  });

  it("rejects bad input without writing anything", () => {
    const db = tempDb();
    expect(() => applyAccountReportingChanges(db, { budgetSyncId: "b1", changes: [
      { accountId: "a1", treatment: "current-asset" }, { accountId: "a2", treatment: "cash" },
    ] })).toThrow(AppDbValidationError);
    expect(listAccountReporting(db, "b1")).toEqual([]);
    expect(() => applyAccountReportingChanges(db, { budgetSyncId: "", changes: [] })).toThrow(AppDbValidationError);
    expect(() => applyAccountReportingChanges(db, { budgetSyncId: "b1", changes: [
      { accountId: "a1", treatment: null }, { accountId: "a1", treatment: null },
    ] })).toThrow(AppDbValidationError);
  });

  it("adds the table on upgrade from v60 without touching account classes", () => {
    const db = tempDb();
    db.prepare("INSERT INTO account_classes (budget_sync_id, scope, account_id, account_class, updated_at) VALUES ('b1','account','a1','bank','t')").run();
    db.exec("DROP TABLE account_reporting; UPDATE app_meta SET value='60' WHERE key='schema_version'");
    expect(runMigrations(db).schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(listAccountReporting(db, "b1")).toEqual([]);
    expect(db.prepare("SELECT account_class FROM account_classes").all()).toEqual([{ account_class: "bank" }]);
  });

  it("skips a treatment this build does not know, including the retired not-cash name", () => {
    const db = tempDb();
    db.prepare("INSERT INTO account_reporting (budget_sync_id, account_id, treatment, updated_at) VALUES ('b1','a1','future-value','x'), ('b1','a2','not-cash','x')").run();
    expect(listAccountReporting(db, "b1")).toEqual([]);
  });
});
