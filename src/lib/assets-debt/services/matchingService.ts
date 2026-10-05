import { canonicalJson } from "@/lib/app-db/canonicalJson";
import {
  deleteDebtMatchRule,
  getDebtMatchRule,
  insertDebtMatchRule,
  listDebtMatchRules,
  saveDebtMatchRuleBacktest,
  updateDebtMatchRule,
  type DebtMatchRuleInput,
} from "@/lib/app-db/debtMatchRuleRepository";
import { getDebt } from "@/lib/app-db/debtRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
import type { DebtMatchPurpose, DebtMatchRuleRecord, SqliteDatabase } from "@/lib/app-db/types";
import {
  parseMatchActionsV1,
  parseMatchConditionsV1,
  parseStoredMatchRule,
  type MatchActionsV1,
  type MatchConditionsV1,
} from "@/lib/financial-models/matching";
import { ruleCanBeEnabled, runDebtBacktest, type DebtBacktestRequest } from "./backtestService";

export type MatchRuleSave = {
  purpose: DebtMatchPurpose;
  conditions: unknown;
  actions: unknown;
  enabled: boolean;
};

export type MatchRuleView = {
  record: DebtMatchRuleRecord;
  conditions: MatchConditionsV1 | null;
  actions: MatchActionsV1 | null;
  blocked: string | null;
};

const definition = (input: MatchRuleSave): DebtMatchRuleInput => {
  const conditions = parseMatchConditionsV1(input.conditions);
  const actions = parseMatchActionsV1(input.actions);
  return {
    purpose: input.purpose,
    ruleFormatVersion: 1,
    conditionsJson: canonicalJson(conditions),
    actionsJson: canonicalJson(actions),
    enabled: input.enabled,
  };
};

function view(record: DebtMatchRuleRecord): MatchRuleView {
  try {
    const parsed = parseStoredMatchRule(record);
    return { record, ...parsed, blocked: null };
  } catch (error) {
    return { record, conditions: null, actions: null, blocked: error instanceof Error ? error.message : String(error) };
  }
}

function requireOwnedRule(db: SqliteDatabase, debtId: string, ruleId: string): DebtMatchRuleRecord {
  const rule = getDebtMatchRule(db, ruleId);
  if (!rule || rule.debtId !== debtId) throw new AppDbValidationError("Matching rule not found");
  return rule;
}

export function listMatchingRules(db: SqliteDatabase, debtId: string): MatchRuleView[] {
  if (!getDebt(db, debtId)) throw new AppDbValidationError("Debt not found");
  return listDebtMatchRules(db, debtId).map(view);
}

function verifyEnable(db: SqliteDatabase, debtId: string, rule: DebtMatchRuleInput, backtest: DebtBacktestRequest | undefined) {
  if (!rule.enabled) return null;
  if (!backtest) throw new AppDbValidationError("Enabling a rule requires a fresh backtest");
  const result = runDebtBacktest(db, debtId, rule, backtest);
  const gate = ruleCanBeEnabled(rule, result);
  if (!gate.ok) throw new AppDbValidationError(`This rule cannot be enabled: ${gate.reasons.join(" ")}`);
  return result;
}

export function createMatchingRule(db: SqliteDatabase, debtId: string, input: MatchRuleSave, backtest?: DebtBacktestRequest): MatchRuleView {
  if (!getDebt(db, debtId)) throw new AppDbValidationError("Debt not found");
  const rule = definition(input);
  const tested = verifyEnable(db, debtId, rule, backtest);
  return db.transaction(() => {
    let created = insertDebtMatchRule(db, debtId, rule);
    if (tested) created = saveDebtMatchRuleBacktest(db, created.id, canonicalJson(tested), tested.generatedAt);
    return view(created);
  })();
}

export function editMatchingRule(db: SqliteDatabase, debtId: string, ruleId: string, input: MatchRuleSave, backtest?: DebtBacktestRequest): MatchRuleView {
  requireOwnedRule(db, debtId, ruleId);
  const rule = definition(input);
  const tested = verifyEnable(db, debtId, rule, backtest);
  return db.transaction(() => {
    let updated = updateDebtMatchRule(db, ruleId, rule);
    if (tested) updated = saveDebtMatchRuleBacktest(db, updated.id, canonicalJson(tested), tested.generatedAt);
    return view(updated);
  })();
}

/**
 * Check a rule that is not saved yet against history (the matching editor's live check). Same
 * engine and result as a saved rule's backtest; nothing is stored and Actual is only read by the
 * browser that supplied the snapshots.
 */
export function backtestDraftMatchingRule(db: SqliteDatabase, debtId: string, input: Omit<MatchRuleSave, "enabled">, request: DebtBacktestRequest) {
  return runDebtBacktest(db, debtId, definition({ ...input, enabled: false }), request);
}

export function removeMatchingRule(db: SqliteDatabase, debtId: string, ruleId: string): void {
  requireOwnedRule(db, debtId, ruleId);
  deleteDebtMatchRule(db, ruleId);
}

export function backtestStoredMatchingRule(db: SqliteDatabase, debtId: string, ruleId: string, request: DebtBacktestRequest) {
  const rule = requireOwnedRule(db, debtId, ruleId);
  if (typeof rule.purpose !== "string") throw new AppDbValidationError("The matching rule purpose was configured by a newer version of Actual Bench");
  const result = runDebtBacktest(db, debtId, { ...rule, purpose: rule.purpose }, request);
  saveDebtMatchRuleBacktest(db, ruleId, canonicalJson(result), result.generatedAt);
  return result;
}
