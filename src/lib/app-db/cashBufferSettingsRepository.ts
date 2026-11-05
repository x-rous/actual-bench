import { DEFAULT_BUFFER_SETTINGS, parseBufferSettings, type BufferSettings } from "@/lib/financial-insights/bufferScenario";
import { AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

/**
 * Persistence for the cash buffer settings of one budget: the months of cover the user aims for and how a typical month is worked
 * out. One row per budget; a budget with none uses the defaults.
 */

type SettingsRow = { budget_sync_id: string; goal_months: number | null; average_months: number; method: string };

/** The budget's settings, or the defaults when it has none (or a row this build cannot read, which a newer version may have written). */
export function readCashBufferSettings(db: SqliteDatabase, budgetSyncId: string): BufferSettings {
  const row = db.prepare("SELECT * FROM cash_buffer_settings WHERE budget_sync_id = ?").get(budgetSyncId) as SettingsRow | undefined;
  if (!row) return DEFAULT_BUFFER_SETTINGS;
  return parseBufferSettings({ goalMonths: row.goal_months, averageMonths: row.average_months, method: row.method }) ?? DEFAULT_BUFFER_SETTINGS;
}

/** Saves the budget's settings and returns them. */
export function saveCashBufferSettings(db: SqliteDatabase, input: unknown): BufferSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new AppDbValidationError("Settings payload must be an object");
  const body = input as Record<string, unknown>;
  const budgetSyncId = typeof body.budgetSyncId === "string" ? body.budgetSyncId.trim() : "";
  if (!budgetSyncId) throw new AppDbValidationError("budgetSyncId is required");
  const settings = parseBufferSettings(body.settings);
  if (!settings) throw new AppDbValidationError("The cash buffer settings are not valid");
  db.prepare(
    `INSERT INTO cash_buffer_settings (budget_sync_id, goal_months, average_months, method, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(budget_sync_id) DO UPDATE SET
       goal_months = excluded.goal_months,
       average_months = excluded.average_months,
       method = excluded.method,
       updated_at = excluded.updated_at`
  ).run(budgetSyncId, settings.goalMonths, settings.averageMonths, settings.method, new Date().toISOString());
  return readCashBufferSettings(db, budgetSyncId);
}
