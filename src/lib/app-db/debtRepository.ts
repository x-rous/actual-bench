import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import {
  optionalInteger,
  optionalIsoDate,
  optionalText,
  requireInteger,
  requireIsoDate,
  requireOneOf,
  requireText,
  rethrowConstraint,
} from "./debtValues";
import {
  BEHAVIOR_CLASSES,
  DEBT_STATUSES,
  DEBT_TYPES,
  EXECUTION_STRATEGIES,
  LENDER_PATTERNS,
  SIGN_CONVENTIONS,
  readStoredEnum,
  type BehaviorClass,
  type DebtRecord,
  type DebtStatus,
  type DebtType,
  type ExecutionStrategyId,
  type LenderPattern,
  type SignConvention,
  type SqliteDatabase,
} from "./types";

/**
 * Debts (RD-084 P1.3, v38): one row per loan, facility or receivable.
 *
 * Configuration only. There is no balance column and no automation state
 * (the automation engine owns enabled/paused; A-4). Every write here runs
 * inside the configuration service's transaction, which also writes the
 * model revision; nothing in this module decides whether a change is material.
 */

type DebtRow = {
  id: string;
  budget_sync_id: string;
  name: string;
  debt_type: string;
  behavior_class: string;
  currency: string;
  currency_minor_digits: number;
  liability_account_id: string | null;
  payment_account_id: string | null;
  sign_convention: string;
  lender_pattern: string | null;
  execution_strategy: string;
  drift_tolerance_minor: number;
  lender_charge_grace_days: number;
  onboarding_date: string | null;
  loan_payment_category_id: string | null;
  draw_category_id: string | null;
  expected_observation_interval_days: number | null;
  auto_apply_enabled: number;
  drift_accepted_revision: number | null;
  drift_accepted_fingerprint: string | null;
  current_revision: number;
  current_config_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** The writable fields of a debt. Revision, status transitions and timestamps have their own calls. */
export type DebtFields = {
  budgetSyncId: string;
  name: string;
  debtType: DebtType;
  behaviorClass: BehaviorClass;
  currency: string;
  currencyMinorDigits: number;
  liabilityAccountId: string | null;
  paymentAccountId: string | null;
  signConvention: SignConvention;
  lenderPattern: LenderPattern | null;
  executionStrategy: ExecutionStrategyId;
  /** Omitted or null: one major unit of the currency (G1 D-14). */
  driftToleranceMinor?: number | null;
  lenderChargeGraceDays: number;
  onboardingDate: string | null;
  loanPaymentCategoryId: string | null;
  drawCategoryId: string | null;
  expectedObservationIntervalDays: number | null;
  currentConfigJson: string;
};

/** One major unit in minor units: 100 for two-decimal currencies, 1 for zero-decimal ones (FR-094). */
export function defaultDriftToleranceMinor(currencyMinorDigits: number): number {
  return 10 ** requireInteger(currencyMinorDigits, "currencyMinorDigits", 0);
}

function rowToRecord(row: DebtRow): DebtRecord {
  const record: DebtRecord = {
    id: row.id,
    budgetSyncId: row.budget_sync_id,
    name: row.name,
    debtType: readStoredEnum(DEBT_TYPES, row.debt_type),
    behaviorClass: readStoredEnum(BEHAVIOR_CLASSES, row.behavior_class),
    currency: row.currency,
    currencyMinorDigits: row.currency_minor_digits,
    liabilityAccountId: row.liability_account_id,
    paymentAccountId: row.payment_account_id,
    signConvention: readStoredEnum(SIGN_CONVENTIONS, row.sign_convention),
    lenderPattern: row.lender_pattern === null ? null : readStoredEnum(LENDER_PATTERNS, row.lender_pattern),
    executionStrategy: readStoredEnum(EXECUTION_STRATEGIES, row.execution_strategy),
    driftToleranceMinor: row.drift_tolerance_minor,
    lenderChargeGraceDays: row.lender_charge_grace_days,
    onboardingDate: row.onboarding_date,
    loanPaymentCategoryId: row.loan_payment_category_id,
    drawCategoryId: row.draw_category_id,
    expectedObservationIntervalDays: row.expected_observation_interval_days,
    autoApplyEnabled: row.auto_apply_enabled === 1,
    driftAcceptedRevision: row.drift_accepted_revision,
    driftAcceptedFingerprint: row.drift_accepted_fingerprint,
    currentRevision: row.current_revision,
    currentConfigJson: row.current_config_json,
    status: readStoredEnum(DEBT_STATUSES, row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    unknownValues: [],
  };
  const enums: [string, unknown][] = [
    ["debt_type", record.debtType],
    ["behavior_class", record.behaviorClass],
    ["sign_convention", record.signConvention],
    ["lender_pattern", record.lenderPattern],
    ["execution_strategy", record.executionStrategy],
    ["status", record.status],
  ];
  record.unknownValues = enums.filter(([, v]) => typeof v === "object" && v !== null).map(([k, v]) => `${k}=${(v as { unknown: string }).unknown}`);
  return record;
}

function normalizeFields(input: DebtFields) {
  const digits = requireInteger(input.currencyMinorDigits, "currencyMinorDigits", 0);
  if (digits > 4) throw new AppDbValidationError("currencyMinorDigits must be 0 to 4");
  const currency = requireText(input.currency, "currency");
  if (!/^[A-Z]{3}$/.test(currency)) throw new AppDbValidationError("currency must be a three-letter ISO 4217 code");
  const drift = input.driftToleranceMinor ?? defaultDriftToleranceMinor(digits);
  return {
    budget_sync_id: requireText(input.budgetSyncId, "budgetSyncId"),
    name: requireText(input.name, "name").trim(),
    debt_type: requireOneOf(DEBT_TYPES, input.debtType, "debtType"),
    behavior_class: requireOneOf(BEHAVIOR_CLASSES, input.behaviorClass, "behaviorClass"),
    currency,
    currency_minor_digits: digits,
    liability_account_id: optionalText(input.liabilityAccountId, "liabilityAccountId"),
    payment_account_id: optionalText(input.paymentAccountId, "paymentAccountId"),
    sign_convention: requireOneOf(SIGN_CONVENTIONS, input.signConvention, "signConvention"),
    lender_pattern: input.lenderPattern === null ? null : requireOneOf(LENDER_PATTERNS, input.lenderPattern, "lenderPattern"),
    execution_strategy: requireOneOf(EXECUTION_STRATEGIES, input.executionStrategy, "executionStrategy"),
    drift_tolerance_minor: requireInteger(drift, "driftToleranceMinor", 0),
    lender_charge_grace_days: requireInteger(input.lenderChargeGraceDays, "lenderChargeGraceDays", 0),
    onboarding_date: optionalIsoDate(input.onboardingDate, "onboardingDate"),
    loan_payment_category_id: optionalText(input.loanPaymentCategoryId, "loanPaymentCategoryId"),
    draw_category_id: optionalText(input.drawCategoryId, "drawCategoryId"),
    expected_observation_interval_days: optionalInteger(input.expectedObservationIntervalDays, "expectedObservationIntervalDays", 1),
    current_config_json: requireText(input.currentConfigJson, "currentConfigJson"),
  };
}

const CONSTRAINTS = {
  idx_debts_live_liability_account: "Another debt in this budget already uses that liability account.",
  "debts.liability_account_id": "Another debt in this budget already uses that liability account.",
  "liability_account_id <> payment_account_id": "The payment account must differ from the liability account.",
};

export function getDebt(db: SqliteDatabase, id: string): DebtRecord | null {
  const row = db.prepare("SELECT * FROM debts WHERE id = ?").get<DebtRow>(id);
  return row ? rowToRecord(row) : null;
}

export function listDebts(db: SqliteDatabase, filter: { budgetSyncId: string; includeArchived?: boolean }): DebtRecord[] {
  const rows = filter.includeArchived
    ? db.prepare("SELECT * FROM debts WHERE budget_sync_id = ? ORDER BY name COLLATE NOCASE, id").all<DebtRow>(filter.budgetSyncId)
    : db
        .prepare("SELECT * FROM debts WHERE budget_sync_id = ? AND status <> 'archived' ORDER BY name COLLATE NOCASE, id")
        .all<DebtRow>(filter.budgetSyncId);
  return rows.map(rowToRecord);
}

/** Liability accounts of the budget's non-archived debts, optionally excluding one debt. */
export function listLiveLiabilityAccountIds(db: SqliteDatabase, budgetSyncId: string, exceptDebtId?: string): string[] {
  return db
    .prepare(
      "SELECT liability_account_id FROM debts WHERE budget_sync_id = ? AND status <> 'archived' AND liability_account_id IS NOT NULL AND id <> ?"
    )
    .all<{ liability_account_id: string }>(budgetSyncId, exceptDebtId ?? "")
    .map((r) => r.liability_account_id);
}

export function insertDebt(
  db: SqliteDatabase,
  input: DebtFields & { id?: string; status: Exclude<DebtStatus, "archived">; currentRevision: number },
  now = new Date().toISOString()
): DebtRecord {
  const f = normalizeFields(input);
  const id = input.id ?? generateId();
  const status = requireOneOf(["draft", "active"] as const, input.status, "status");
  const revision = requireInteger(input.currentRevision, "currentRevision", 1);
  try {
    db.prepare(
      `INSERT INTO debts (
        id, budget_sync_id, name, debt_type, behavior_class, currency, currency_minor_digits,
        liability_account_id, payment_account_id, sign_convention, lender_pattern, execution_strategy,
        drift_tolerance_minor, lender_charge_grace_days, onboarding_date, loan_payment_category_id,
        draw_category_id, expected_observation_interval_days, auto_apply_enabled, drift_accepted_revision, drift_accepted_fingerprint,
        current_revision, current_config_json, status, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, NULL)`
    ).run(
      id, f.budget_sync_id, f.name, f.debt_type, f.behavior_class, f.currency, f.currency_minor_digits,
      f.liability_account_id, f.payment_account_id, f.sign_convention, f.lender_pattern, f.execution_strategy,
      f.drift_tolerance_minor, f.lender_charge_grace_days, f.onboarding_date, f.loan_payment_category_id,
      f.draw_category_id, f.expected_observation_interval_days, revision, f.current_config_json, status, now, now
    );
  } catch (error) {
    rethrowConstraint(error, CONSTRAINTS);
  }
  return getDebt(db, id)!;
}

/** Replace every writable field of a non-archived debt. The budget never changes. */
export function updateDebt(
  db: SqliteDatabase,
  id: string,
  input: DebtFields & { status: Exclude<DebtStatus, "archived">; currentRevision: number },
  now = new Date().toISOString()
): DebtRecord {
  const existing = getDebt(db, id);
  if (!existing) throw new AppDbValidationError("Debt not found");
  if (existing.status === "archived") throw new AppDbValidationError("An archived debt cannot be edited");
  const f = normalizeFields(input);
  if (f.budget_sync_id !== existing.budgetSyncId) throw new AppDbValidationError("A debt cannot move to another budget");
  const status = requireOneOf(["draft", "active"] as const, input.status, "status");
  const revision = requireInteger(input.currentRevision, "currentRevision", existing.currentRevision);
  try {
    db.prepare(
      `UPDATE debts SET
        name = ?, debt_type = ?, behavior_class = ?, currency = ?, currency_minor_digits = ?,
        liability_account_id = ?, payment_account_id = ?, sign_convention = ?, lender_pattern = ?,
        execution_strategy = ?, drift_tolerance_minor = ?, lender_charge_grace_days = ?, onboarding_date = ?,
        loan_payment_category_id = ?, draw_category_id = ?, expected_observation_interval_days = ?,
        current_revision = ?, current_config_json = ?, status = ?, updated_at = ?
      WHERE id = ?`
    ).run(
      f.name, f.debt_type, f.behavior_class, f.currency, f.currency_minor_digits,
      f.liability_account_id, f.payment_account_id, f.sign_convention, f.lender_pattern,
      f.execution_strategy, f.drift_tolerance_minor, f.lender_charge_grace_days, f.onboarding_date,
      f.loan_payment_category_id, f.draw_category_id, f.expected_observation_interval_days,
      revision, f.current_config_json, status, now, id
    );
  } catch (error) {
    rethrowConstraint(error, CONSTRAINTS);
  }
  return getDebt(db, id)!;
}

/** Archive a debt: it keeps its history and frees its liability account for a new debt. */
export function archiveDebt(db: SqliteDatabase, id: string, currentRevision: number, now = new Date().toISOString()): DebtRecord {
  const existing = getDebt(db, id);
  if (!existing) throw new AppDbValidationError("Debt not found");
  if (existing.status === "archived") return existing;
  db.prepare("UPDATE debts SET status = 'archived', archived_at = ?, current_revision = ?, updated_at = ? WHERE id = ?").run(
    now,
    requireInteger(currentRevision, "currentRevision", existing.currentRevision),
    now,
    id
  );
  return getDebt(db, id)!;
}

/**
 * Physically delete a draft. Its rates, offsets and assumptions cascade, and
 * the `debts_delete_revisions` trigger removes its revisions. A debt that was
 * ever active is archived instead, never deleted.
 */
export function deleteDraftDebt(db: SqliteDatabase, id: string): boolean {
  const existing = getDebt(db, id);
  if (!existing) return false;
  if (existing.status !== "draft") throw new AppDbValidationError("Only a draft debt can be deleted; archive an active debt instead");
  try {
    return db.prepare("DELETE FROM debts WHERE id = ? AND status = 'draft'").run(id).changes > 0;
  } catch (error) {
    rethrowConstraint(error, {
      FOREIGN: "This draft already has linked transactions, lender observations or anchors; archive it instead.",
    });
  }
}

/** Point a debt at a revision just written in the same transaction. Revisions only move forward. */
export function setDebtCurrentRevision(db: SqliteDatabase, id: string, revision: number): void {
  const existing = getDebt(db, id);
  if (!existing) throw new AppDbValidationError("Debt not found");
  if (revision < existing.currentRevision) throw new AppDbValidationError("A debt's revision cannot move backwards");
  db.prepare("UPDATE debts SET current_revision = ? WHERE id = ?").run(revision, id);
}

/** Accept only the current revision's drift. A later material revision invalidates it naturally. */
export function setDebtDriftAcceptedRevision(db: SqliteDatabase, id: string, revision: number | null, fingerprint: string | null, now = new Date().toISOString()): DebtRecord {
  const debt = getDebt(db, id);
  if (!debt) throw new AppDbValidationError("Debt not found");
  if (revision !== null && revision !== debt.currentRevision) throw new AppDbValidationError("Only the current debt revision can accept drift");
  if ((revision === null) !== (fingerprint === null)) throw new AppDbValidationError("Drift acceptance needs both a revision and comparison fingerprint");
  db.prepare("UPDATE debts SET drift_accepted_revision = ?, drift_accepted_fingerprint = ?, updated_at = ? WHERE id = ?").run(revision, fingerprint, now, id);
  return getDebt(db, id)!;
}

export function setDebtOnboardingDate(db: SqliteDatabase, id: string, date: string, now = new Date().toISOString()): DebtRecord {
  if (!getDebt(db, id)) throw new AppDbValidationError("Debt not found");
  db.prepare("UPDATE debts SET onboarding_date = ?, updated_at = ? WHERE id = ?").run(requireIsoDate(date, "onboardingDate"), now, id);
  return getDebt(db, id)!;
}
