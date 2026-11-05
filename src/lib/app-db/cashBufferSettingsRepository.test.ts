import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_BUFFER_SETTINGS } from "@/lib/financial-insights/bufferScenario";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import { LATEST_SCHEMA_VERSION, runMigrations } from "./migrations";
import { readCashBufferSettings, saveCashBufferSettings } from "./cashBufferSettingsRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  return getAppDb(join(mkdtempSync(join(tmpdir(), "actual-bench-buffer-settings-db-")), "metadata.sqlite"));
}

describe("cash buffer settings repository", () => {
  afterEach(() => resetAppDbForTests());

  it("uses the defaults until something is saved, then keeps what was saved", () => {
    const db = tempDb();
    expect(readCashBufferSettings(db, "b1")).toEqual(DEFAULT_BUFFER_SETTINGS);
    expect(saveCashBufferSettings(db, { budgetSyncId: "b1", settings: { goalMonths: 6, averageMonths: 3, method: "median" } })).toEqual({ goalMonths: 6, averageMonths: 3, method: "median" });
    expect(saveCashBufferSettings(db, { budgetSyncId: "b1", settings: { goalMonths: null, averageMonths: 6, method: "average" } })).toEqual({ goalMonths: null, averageMonths: 6, method: "average" });
    expect(readCashBufferSettings(db, "b1")).toEqual({ goalMonths: null, averageMonths: 6, method: "average" });
  });

  it("scopes the settings to one budget", () => {
    const db = tempDb();
    saveCashBufferSettings(db, { budgetSyncId: "b1", settings: { goalMonths: 6, averageMonths: 12, method: "average" } });
    expect(readCashBufferSettings(db, "b2")).toEqual(DEFAULT_BUFFER_SETTINGS);
  });

  it("rejects bad input without writing anything, and ignores a row it cannot read", () => {
    const db = tempDb();
    expect(() => saveCashBufferSettings(db, { budgetSyncId: "b1", settings: { goalMonths: 0, averageMonths: 12, method: "average" } })).toThrow(AppDbValidationError);
    expect(() => saveCashBufferSettings(db, { budgetSyncId: " ", settings: DEFAULT_BUFFER_SETTINGS })).toThrow(AppDbValidationError);
    expect(readCashBufferSettings(db, "b1")).toEqual(DEFAULT_BUFFER_SETTINGS);
    db.prepare("INSERT INTO cash_buffer_settings (budget_sync_id, goal_months, average_months, method, updated_at) VALUES ('b3', 6, 9, 'mode', '2026-01-01')").run();
    expect(readCashBufferSettings(db, "b3")).toEqual(DEFAULT_BUFFER_SETTINGS);
  });
});

describe("the cash buffer settings table", () => {
  afterEach(() => resetAppDbForTests());

  it("is added by an upgrade from a database that already holds the scenarios table", () => {
    const db = tempDb();
    db.exec("DROP TABLE cash_buffer_settings");
    db.prepare("UPDATE app_meta SET value='63' WHERE key='schema_version'").run();
    expect(runMigrations(db).schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(saveCashBufferSettings(db, { budgetSyncId: "b1", settings: { goalMonths: 6, averageMonths: 12, method: "average" } }).goalMonths).toBe(6);
  });
});
