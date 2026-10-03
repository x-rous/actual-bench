import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import { requireInteger, requireOneOf, requireText, rethrowConstraint } from "./debtValues";
import {
  DEBT_MATCH_PURPOSES,
  readStoredEnum,
  type DebtMatchPurpose,
  type DebtMatchRuleRecord,
  type SqliteDatabase,
} from "./types";

type RuleRow = {
  id: string;
  debt_id: string;
  purpose: string;
  rule_format_version: number;
  conditions_json: string;
  actions_json: string;
  enabled: number;
  last_backtest_json: string | null;
  last_backtest_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DebtMatchRuleInput = {
  id?: string;
  purpose: DebtMatchPurpose;
  ruleFormatVersion: number;
  conditionsJson: string;
  actionsJson: string;
  enabled?: boolean;
};

const rowToRecord = (row: RuleRow): DebtMatchRuleRecord => ({
  id: row.id,
  debtId: row.debt_id,
  purpose: readStoredEnum(DEBT_MATCH_PURPOSES, row.purpose),
  ruleFormatVersion: row.rule_format_version,
  conditionsJson: row.conditions_json,
  actionsJson: row.actions_json,
  enabled: row.enabled === 1,
  lastBacktestJson: row.last_backtest_json,
  lastBacktestAt: row.last_backtest_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function jsonText(value: unknown, field: string): string {
  const text = requireText(value, field);
  try {
    JSON.parse(text);
  } catch {
    throw new AppDbValidationError(`${field} must be valid JSON`);
  }
  return text;
}

export function getDebtMatchRule(db: SqliteDatabase, id: string): DebtMatchRuleRecord | null {
  const row = db.prepare("SELECT * FROM debt_match_rules WHERE id = ?").get<RuleRow>(id);
  return row ? rowToRecord(row) : null;
}

export function listDebtMatchRules(db: SqliteDatabase, debtId: string): DebtMatchRuleRecord[] {
  return db
    .prepare("SELECT * FROM debt_match_rules WHERE debt_id = ? ORDER BY created_at, id")
    .all<RuleRow>(debtId)
    .map(rowToRecord);
}

export function insertDebtMatchRule(
  db: SqliteDatabase,
  debtId: string,
  input: DebtMatchRuleInput,
  now = new Date().toISOString()
): DebtMatchRuleRecord {
  const id = input.id ?? generateId();
  try {
    db.prepare(
      `INSERT INTO debt_match_rules
       (id, debt_id, purpose, rule_format_version, conditions_json, actions_json, enabled,
        last_backtest_json, last_backtest_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(
      id,
      requireText(debtId, "debtId"),
      requireOneOf(DEBT_MATCH_PURPOSES, input.purpose, "purpose"),
      requireInteger(input.ruleFormatVersion, "ruleFormatVersion", 1),
      jsonText(input.conditionsJson, "conditionsJson"),
      jsonText(input.actionsJson, "actionsJson"),
      input.enabled === true ? 1 : 0,
      now,
      now
    );
  } catch (error) {
    rethrowConstraint(error, { FOREIGN: "The debt does not exist." });
  }
  return getDebtMatchRule(db, id)!;
}

export function updateDebtMatchRule(
  db: SqliteDatabase,
  id: string,
  input: DebtMatchRuleInput,
  now = new Date().toISOString()
): DebtMatchRuleRecord {
  const existing = getDebtMatchRule(db, id);
  if (!existing) throw new AppDbValidationError("Matching rule not found");
  const result = db.prepare(
    `UPDATE debt_match_rules SET purpose = ?, rule_format_version = ?, conditions_json = ?,
       actions_json = ?, enabled = ?, last_backtest_json = NULL, last_backtest_at = NULL,
       updated_at = ? WHERE id = ?`
  ).run(
    requireOneOf(DEBT_MATCH_PURPOSES, input.purpose, "purpose"),
    requireInteger(input.ruleFormatVersion, "ruleFormatVersion", 1),
    jsonText(input.conditionsJson, "conditionsJson"),
    jsonText(input.actionsJson, "actionsJson"),
    input.enabled === true ? 1 : 0,
    now,
    id
  );
  if (!result.changes) throw new AppDbValidationError("Matching rule not found");
  return getDebtMatchRule(db, id)!;
}

export function saveDebtMatchRuleBacktest(
  db: SqliteDatabase,
  id: string,
  backtestJson: string,
  at = new Date().toISOString()
): DebtMatchRuleRecord {
  const result = db.prepare(
    "UPDATE debt_match_rules SET last_backtest_json = ?, last_backtest_at = ?, updated_at = ? WHERE id = ?"
  ).run(jsonText(backtestJson, "backtestJson"), at, at, id);
  if (!result.changes) throw new AppDbValidationError("Matching rule not found");
  return getDebtMatchRule(db, id)!;
}

export function deleteDebtMatchRule(db: SqliteDatabase, id: string): boolean {
  return db.prepare("DELETE FROM debt_match_rules WHERE id = ?").run(id).changes > 0;
}
