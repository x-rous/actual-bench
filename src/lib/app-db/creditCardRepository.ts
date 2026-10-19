import { z } from "zod";
import {
  applyChangeSet,
  changeSetSchema,
  CreditCardConflictError,
  CreditCardRuleError,
  diffWorkspaces,
  type ChangeSet,
} from "@/lib/credit-cards/changes";
import {
  cardSchema,
  decisionSchema,
  limitChangeSchema,
  planEntrySchema,
  planSchema,
  statementSchema,
  typeCorrectionSchema,
  type Card,
  type Decision,
  type PlanEntry,
  type RepaymentPlan,
  type Statement,
  type TypeCorrection,
  type Workspace,
} from "@/lib/credit-cards/schema";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

/**
 * Credit-card metadata (RD-098 / PR-127c). Server-only. Stores Actual ids, opaque hashes and the
 * user's own figures, scoped by budget sync id; never Actual transactions, balances or credentials,
 * and nothing is read from or written to Actual here.
 *
 * Every write is one change set applied in one SQLite transaction: the shared `applyChangeSet`
 * checks each expected revision and the repository rules (§12.3) against the rows read inside the
 * transaction, and the database constraints are a second line of defence.
 */

type Row = Record<string, unknown>;

export type CreditCardRead = {
  workspace: Workspace;
  /** Rows this build cannot read (for example a newer type value); kept, never coerced or deleted. */
  unsupported: number;
};

const bool = (value: unknown) => value === 1;
const flag = (value: boolean) => (value ? 1 : 0);

function cardFrom(row: Row): unknown {
  return {
    id: row.id, budgetSyncId: row.budget_sync_id, accountId: row.account_id, revision: row.revision,
    status: row.status, network: row.network, color: row.color, bankTimeZone: row.bank_time_zone,
    creditLimitMinor: row.credit_limit_minor, purchaseAprBps: row.purchase_apr_bps, interestModel: row.interest_model,
    closingDay: row.closing_day,
    dueRule: row.due_rule_kind === null ? null : { kind: row.due_rule_kind, value: row.due_rule_value },
    billingDaysSource: row.billing_days_source,
    minimumPercentBps: row.minimum_percent_bps, minimumFloorMinor: row.minimum_floor_minor,
    interestCategoryId: row.interest_category_id, feeCategoryId: row.fee_category_id, cashbackCategoryId: row.cashback_category_id,
    statementsIncludePlanBalances: bool(row.statements_include_plan_balances),
    firstTrackedStatementDate: row.first_tracked_statement_date, openedDate: row.opened_date, autoPay: row.auto_pay,
    annualFeeMinor: row.annual_fee_minor, annualFeeRenewalDate: row.annual_fee_renewal_date,
  };
}

function statementFrom(row: Row): unknown {
  return {
    id: row.id, cardId: row.card_id, revision: row.revision,
    periodStart: row.period_start, closingDate: row.closing_date, dueDate: row.due_date,
    balanceMinor: row.balance_minor, minimumDueMinor: row.minimum_due_minor, amountDueMinor: row.amount_due_minor,
    previousBalanceMinor: row.previous_balance_minor, reviewState: row.review_state, reviewHash: row.review_hash,
    reviewedAt: row.reviewed_at, scopeAcceptedDifferenceMinor: row.scope_accepted_difference_minor,
  };
}

function decisionFrom(row: Row): unknown {
  return {
    statementId: row.statement_id, cardId: row.card_id, transactionId: row.transaction_id, decision: row.decision,
    origin: row.origin, bankPostingDate: row.bank_posting_date, sourceHash: row.source_hash, note: row.note,
  };
}

function typeFrom(row: Row): unknown {
  return {
    cardId: row.card_id, transactionId: row.transaction_id, kind: row.kind,
    identityHash: row.identity_hash, sourceHash: row.source_hash, note: row.note,
  };
}

function planFrom(row: Row): unknown {
  return {
    id: row.id, cardId: row.card_id, revision: row.revision, name: row.name, recordedAs: row.recorded_as,
    planAccountId: row.plan_account_id, planAccountTag: row.plan_account_tag, status: row.status, endedOn: row.ended_on,
    originalAmountMinor: row.original_amount_minor, startDate: row.start_date,
    opening: row.opening_date === null ? null : { date: row.opening_date, principalMinor: row.opening_principal_minor },
    scheduleKind: row.schedule_kind, firstDueDate: row.first_due_date, instalmentCount: row.instalment_count,
    instalmentMinor: row.instalment_minor, aprBps: row.apr_bps, upfrontFeeMinor: row.upfront_fee_minor,
    monthlyFeeMinor: row.monthly_fee_minor, includesCosts: bool(row.instalment_includes_costs),
    minimumPercentBps: row.minimum_percent_bps, minimumFloorMinor: row.minimum_floor_minor,
    expiryDate: row.expiry_date, note: row.note,
  };
}

function limitChangeFrom(row: Row): unknown {
  return { cardId: row.card_id, effectiveDate: row.effective_date, limitMinor: row.limit_minor };
}

function entryFrom(row: Row): unknown {
  return {
    planId: row.plan_id, transactionId: row.transaction_id, role: row.role, instalmentNumber: row.instalment_number,
    transferPairKey: row.transfer_pair_key, identityHash: row.identity_hash, sourceHash: row.source_hash,
  };
}

/** Rows this build understands; anything else is counted and left alone. */
function readable<T>(rows: Row[], map: (row: Row) => unknown, schema: z.ZodType<T>) {
  const parsed: T[] = [];
  let skipped = 0;
  for (const row of rows) {
    const result = schema.safeParse(map(row));
    if (result.success) parsed.push(result.data);
    else skipped++;
  }
  return { parsed, skipped };
}

/** All credit-card metadata for one budget (it is small). */
export function readCreditCardWorkspace(db: SqliteDatabase, budgetSyncId: string): CreditCardRead {
  const all = (sql: string) => db.prepare(sql).all(budgetSyncId) as Row[];
  const cards = readable(all("SELECT * FROM credit_cards WHERE budget_sync_id = ? ORDER BY created_at, id"), cardFrom, cardSchema);
  const cardIds = new Set(cards.parsed.map((card) => card.id));
  const byCard = <T extends { cardId: string }>(rows: T[]) => rows.filter((row) => cardIds.has(row.cardId));
  const statements = readable(all(`SELECT s.* FROM credit_card_statements s JOIN credit_cards c ON c.id = s.card_id
    WHERE c.budget_sync_id = ? ORDER BY s.closing_date, s.id`), statementFrom, statementSchema);
  const statementIds = new Set(statements.parsed.map((statement) => statement.id));
  const decisions = readable(all(`SELECT d.* FROM credit_card_statement_decisions d JOIN credit_cards c ON c.id = d.card_id
    WHERE c.budget_sync_id = ? ORDER BY d.statement_id, d.transaction_id`), decisionFrom, decisionSchema);
  const types = readable(all(`SELECT t.* FROM credit_card_transaction_types t JOIN credit_cards c ON c.id = t.card_id
    WHERE c.budget_sync_id = ? ORDER BY t.card_id, t.transaction_id`), typeFrom, typeCorrectionSchema);
  const plans = readable(all("SELECT * FROM credit_card_plans WHERE budget_sync_id = ? ORDER BY created_at, id"), planFrom, planSchema);
  const planIds = new Set(plans.parsed.map((plan) => plan.id));
  const entries = readable(all("SELECT * FROM credit_card_plan_entries WHERE budget_sync_id = ? ORDER BY plan_id, transaction_id"), entryFrom, planEntrySchema);
  const accounts = all("SELECT account_id FROM credit_card_plan_accounts WHERE budget_sync_id = ? ORDER BY created_at, account_id");
  const limits = readable(all(`SELECT l.* FROM credit_card_limit_changes l JOIN credit_cards c ON c.id = l.card_id
    WHERE c.budget_sync_id = ? ORDER BY l.card_id, l.effective_date`), limitChangeFrom, limitChangeSchema);
  const workspace: Workspace = {
    cards: cards.parsed,
    statements: byCard(statements.parsed),
    decisions: decisions.parsed.filter((row) => statementIds.has(row.statementId)),
    typeCorrections: byCard(types.parsed),
    plans: byCard(plans.parsed),
    planEntries: entries.parsed.filter((row) => planIds.has(row.planId)),
    planAccounts: accounts.map((row) => String(row.account_id)),
    limitChanges: byCard(limits.parsed),
  };
  const unsupported = cards.skipped + statements.skipped + decisions.skipped + types.skipped + plans.skipped + entries.skipped + limits.skipped;
  return { workspace, unsupported };
}

const requestSchema = z.strictObject({
  budgetSyncId: z.string().trim().min(1).max(200),
  changes: changeSetSchema,
});

function parseRequest(input: unknown): { budgetSyncId: string; changes: ChangeSet } {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppDbValidationError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).slice(0, 5).join("; "));
  }
  return parsed.data;
}

function writeCard(db: SqliteDatabase, card: Card, now: string) {
  db.prepare(`INSERT INTO credit_cards (
      id, budget_sync_id, account_id, status, network, color, bank_time_zone, credit_limit_minor, purchase_apr_bps,
      interest_model, closing_day, due_rule_kind, due_rule_value, billing_days_source, minimum_percent_bps,
      minimum_floor_minor, interest_category_id, fee_category_id, cashback_category_id, statements_include_plan_balances,
      first_tracked_statement_date, opened_date, auto_pay, annual_fee_minor, annual_fee_renewal_date, revision,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, network = excluded.network, color = excluded.color, bank_time_zone = excluded.bank_time_zone,
      credit_limit_minor = excluded.credit_limit_minor, purchase_apr_bps = excluded.purchase_apr_bps,
      interest_model = excluded.interest_model, closing_day = excluded.closing_day, due_rule_kind = excluded.due_rule_kind,
      due_rule_value = excluded.due_rule_value, billing_days_source = excluded.billing_days_source,
      minimum_percent_bps = excluded.minimum_percent_bps, minimum_floor_minor = excluded.minimum_floor_minor,
      interest_category_id = excluded.interest_category_id, fee_category_id = excluded.fee_category_id,
      cashback_category_id = excluded.cashback_category_id,
      statements_include_plan_balances = excluded.statements_include_plan_balances,
      first_tracked_statement_date = excluded.first_tracked_statement_date, opened_date = excluded.opened_date,
      auto_pay = excluded.auto_pay, annual_fee_minor = excluded.annual_fee_minor,
      annual_fee_renewal_date = excluded.annual_fee_renewal_date, revision = excluded.revision, updated_at = excluded.updated_at`)
    .run(card.id, card.budgetSyncId, card.accountId, card.status, card.network, card.color, card.bankTimeZone,
      card.creditLimitMinor, card.purchaseAprBps, card.interestModel, card.closingDay, card.dueRule?.kind ?? null,
      card.dueRule?.value ?? null, card.billingDaysSource, card.minimumPercentBps, card.minimumFloorMinor,
      card.interestCategoryId, card.feeCategoryId, card.cashbackCategoryId, flag(card.statementsIncludePlanBalances),
      card.firstTrackedStatementDate, card.openedDate, card.autoPay, card.annualFeeMinor, card.annualFeeRenewalDate,
      card.revision, now, now);
}

function writeStatement(db: SqliteDatabase, statement: Statement, now: string) {
  db.prepare(`INSERT INTO credit_card_statements (
      id, card_id, period_start, closing_date, due_date, balance_minor, minimum_due_minor, amount_due_minor,
      previous_balance_minor, review_state, review_hash, reviewed_at, scope_accepted_difference_minor, revision,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      period_start = excluded.period_start, closing_date = excluded.closing_date, due_date = excluded.due_date,
      balance_minor = excluded.balance_minor, minimum_due_minor = excluded.minimum_due_minor,
      amount_due_minor = excluded.amount_due_minor, previous_balance_minor = excluded.previous_balance_minor,
      review_state = excluded.review_state, review_hash = excluded.review_hash, reviewed_at = excluded.reviewed_at,
      scope_accepted_difference_minor = excluded.scope_accepted_difference_minor, revision = excluded.revision,
      updated_at = excluded.updated_at`)
    .run(statement.id, statement.cardId, statement.periodStart, statement.closingDate, statement.dueDate,
      statement.balanceMinor, statement.minimumDueMinor, statement.amountDueMinor, statement.previousBalanceMinor,
      statement.reviewState, statement.reviewHash, statement.reviewedAt, statement.scopeAcceptedDifferenceMinor,
      statement.revision, now, now);
}

function writePlan(db: SqliteDatabase, plan: RepaymentPlan, budgetSyncId: string, now: string) {
  db.prepare(`INSERT INTO credit_card_plans (
      id, card_id, budget_sync_id, name, recorded_as, plan_account_id, plan_account_tag, status, original_amount_minor,
      start_date, opening_date, opening_principal_minor, schedule_kind, first_due_date, instalment_count,
      instalment_minor, apr_bps, upfront_fee_minor, monthly_fee_minor, instalment_includes_costs, minimum_percent_bps,
      minimum_floor_minor, expiry_date, ended_on, note, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, recorded_as = excluded.recorded_as, plan_account_id = excluded.plan_account_id,
      plan_account_tag = excluded.plan_account_tag, status = excluded.status,
      original_amount_minor = excluded.original_amount_minor, start_date = excluded.start_date,
      opening_date = excluded.opening_date, opening_principal_minor = excluded.opening_principal_minor,
      schedule_kind = excluded.schedule_kind, first_due_date = excluded.first_due_date,
      instalment_count = excluded.instalment_count, instalment_minor = excluded.instalment_minor,
      apr_bps = excluded.apr_bps, upfront_fee_minor = excluded.upfront_fee_minor,
      monthly_fee_minor = excluded.monthly_fee_minor, instalment_includes_costs = excluded.instalment_includes_costs,
      minimum_percent_bps = excluded.minimum_percent_bps, minimum_floor_minor = excluded.minimum_floor_minor,
      expiry_date = excluded.expiry_date, ended_on = excluded.ended_on, note = excluded.note,
      revision = excluded.revision, updated_at = excluded.updated_at`)
    .run(plan.id, plan.cardId, budgetSyncId, plan.name, plan.recordedAs, plan.planAccountId, plan.planAccountTag,
      plan.status, plan.originalAmountMinor, plan.startDate, plan.opening?.date ?? null, plan.opening?.principalMinor ?? null,
      plan.scheduleKind, plan.firstDueDate, plan.instalmentCount, plan.instalmentMinor, plan.aprBps, plan.upfrontFeeMinor,
      plan.monthlyFeeMinor, flag(plan.includesCosts), plan.minimumPercentBps, plan.minimumFloorMinor, plan.expiryDate,
      plan.endedOn, plan.note, plan.revision, now, now);
}

function writeDecision(db: SqliteDatabase, decision: Decision, now: string) {
  db.prepare(`INSERT INTO credit_card_statement_decisions
      (statement_id, card_id, transaction_id, decision, bank_posting_date, origin, source_hash, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(decision.statementId, decision.cardId, decision.transactionId, decision.decision, decision.bankPostingDate,
      decision.origin, decision.sourceHash, decision.note, now);
}

function writeType(db: SqliteDatabase, correction: TypeCorrection, now: string) {
  db.prepare(`INSERT INTO credit_card_transaction_types (card_id, transaction_id, kind, identity_hash, source_hash, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id, transaction_id) DO UPDATE SET
      kind = excluded.kind, identity_hash = excluded.identity_hash, source_hash = excluded.source_hash,
      note = excluded.note, updated_at = excluded.updated_at`)
    .run(correction.cardId, correction.transactionId, correction.kind, correction.identityHash, correction.sourceHash,
      correction.note, now);
}

function writeEntry(db: SqliteDatabase, entry: PlanEntry, budgetSyncId: string, now: string) {
  db.prepare(`INSERT INTO credit_card_plan_entries
      (plan_id, budget_sync_id, transaction_id, role, instalment_number, transfer_pair_key, identity_hash, source_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(entry.planId, budgetSyncId, entry.transactionId, entry.role, entry.instalmentNumber, entry.transferPairKey,
      entry.identityHash, entry.sourceHash, now);
}

/** Writes the rows that differ between `current` and the checked `next` workspace. */
function writeDifference(db: SqliteDatabase, budgetSyncId: string, current: Workspace, next: Workspace) {
  const now = new Date().toISOString();
  const changes = diffWorkspaces(current, next);
  for (const guard of changes.plans.remove) {
    db.prepare("DELETE FROM credit_card_plans WHERE id = ? AND budget_sync_id = ?").run(guard.id, budgetSyncId);
  }
  for (const guard of changes.statements.remove) {
    db.prepare(`DELETE FROM credit_card_statements WHERE id = ?
      AND card_id IN (SELECT id FROM credit_cards WHERE budget_sync_id = ?)`).run(guard.id, budgetSyncId);
  }
  for (const guard of changes.cards.remove) {
    db.prepare("DELETE FROM credit_cards WHERE id = ? AND budget_sync_id = ?").run(guard.id, budgetSyncId);
  }
  for (const card of changes.cards.put) writeCard(db, card, now);
  // Statements are written in closing order so period checks see final neighbours.
  for (const statement of [...changes.statements.put].sort((a, b) => a.closingDate.localeCompare(b.closingDate))) {
    writeStatement(db, statement, now);
  }
  for (const plan of changes.plans.put) writePlan(db, plan, budgetSyncId, now);
  for (const change of changes.typeCorrections) {
    if (change.next) writeType(db, change.next, now);
    else db.prepare("DELETE FROM credit_card_transaction_types WHERE card_id = ? AND transaction_id = ?").run(change.cardId, change.transactionId);
  }
  for (const entry of changes.decisions) {
    db.prepare("DELETE FROM credit_card_statement_decisions WHERE statement_id = ?").run(entry.statementId);
    for (const decision of entry.rows) writeDecision(db, decision, now);
  }
  for (const entry of changes.limitChanges) {
    db.prepare("DELETE FROM credit_card_limit_changes WHERE card_id = ?").run(entry.cardId);
    for (const row of entry.rows) {
      db.prepare("INSERT INTO credit_card_limit_changes (card_id, effective_date, limit_minor, created_at) VALUES (?, ?, ?, ?)")
        .run(row.cardId, row.effectiveDate, row.limitMinor, now);
    }
  }
  for (const entry of changes.planEntries) {
    db.prepare("DELETE FROM credit_card_plan_entries WHERE plan_id = ? AND budget_sync_id = ?").run(entry.planId, budgetSyncId);
    for (const row of entry.rows) writeEntry(db, row, budgetSyncId, now);
  }
  if (changes.planAccounts) {
    const keep = new Set(changes.planAccounts.next);
    for (const accountId of changes.planAccounts.expected) {
      if (!keep.has(accountId)) {
        db.prepare("DELETE FROM credit_card_plan_accounts WHERE budget_sync_id = ? AND account_id = ?").run(budgetSyncId, accountId);
      }
    }
    for (const accountId of keep) {
      db.prepare("INSERT OR IGNORE INTO credit_card_plan_accounts (budget_sync_id, account_id, created_at) VALUES (?, ?, ?)")
        .run(budgetSyncId, accountId, now);
    }
  }
}

function isConstraintError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}

/**
 * Applies one change set atomically and returns the budget's committed metadata. A stale revision
 * or expected value raises `AppDbConflictError` (409); a broken rule raises `AppDbValidationError`.
 */
export function applyCreditCardChanges(db: SqliteDatabase, input: unknown): Workspace {
  const { budgetSyncId, changes } = parseRequest(input);
  try {
    db.transaction(() => {
      const current = readCreditCardWorkspace(db, budgetSyncId).workspace;
      const next = applyChangeSet(current, changes, budgetSyncId);
      writeDifference(db, budgetSyncId, current, next);
    })();
  } catch (error) {
    if (error instanceof CreditCardConflictError) throw new AppDbConflictError(error.message);
    if (error instanceof CreditCardRuleError) throw new AppDbValidationError(error.message);
    if (isConstraintError(error)) throw new AppDbValidationError(`These values break a stored rule: ${(error as Error).message}`);
    throw error;
  }
  return readCreditCardWorkspace(db, budgetSyncId).workspace;
}
