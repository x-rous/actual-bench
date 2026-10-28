import { z } from "zod";
import { generateId } from "@/lib/uuid";
import { ruleConditionSchema, type RuleCondition } from "@/lib/transactions/conditions";
import { AppDbValidationError } from "./errors";
import { getDebt } from "./debtRepository";
import type { SqliteDatabase } from "./types";

/**
 * Loan tracking (v60): what the user decided about Actual rows (the Loan Ledger), the payment rules that find
 * repayments which are not transfers, and the journal of every write Bench made to Actual for a loan.
 *
 * All of it is Bench metadata. Nothing here reads or writes Actual.
 */

export const LEDGER_ENTRY_TYPES = [
  "loan-received", "opening-balance", "principal-repayment", "extra-principal", "interest-charged", "fee", "draw", "adjustment", "not-repayment",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export type DebtLedgerEntry = {
  actualTransactionId: string;
  actualAccountId: string;
  entryType: LedgerEntryType;
  /** The installment this row pays, chosen by the user ("This is the payment"). */
  installmentDueDate: string | null;
  revision: number;
  updatedAt: string;
};

export type DebtPaymentRule = { id: string; debtId: string; name: string; match: "all" | "any"; conditions: RuleCondition[]; updatedAt: string };

export const WRITE_KINDS = ["split", "adjust-split", "undo-split", "link", "create", "delete", "notes", "convert"] as const;
export type DebtWriteKind = (typeof WRITE_KINDS)[number];
export type DebtWriteStatus = "applying" | "applied" | "failed" | "uncertain";

export type DebtWrite = {
  id: string;
  debtId: string;
  batchId: string | null;
  kind: DebtWriteKind;
  installmentDueDate: string | null;
  targetIds: string[];
  before: unknown;
  after: unknown;
  status: DebtWriteStatus;
  marker: string | null;
  actualIds: string[] | null;
  error: unknown;
  startedAt: string;
  finishedAt: string | null;
};

const MAX_RULES = 10;
/** Applied writes are kept this long as history; failed and uncertain ones until the user clears them. */
const KEEP_APPLIED_DAYS = 90;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const id = z.string().trim().min(1).max(200);

function requireDebt(db: SqliteDatabase, debtId: string) {
  const debt = getDebt(db, debtId);
  if (!debt) throw new AppDbValidationError("Loan not found");
  return debt;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppDbValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  return parsed.data;
}

// ── Ledger entries ─────────────────────────────────────────────────────────────

type EntryRow = { actual_transaction_id: string; actual_account_id: string; entry_type: string; installment_due_date: string | null; revision: number; updated_at: string };

const entryOf = (row: EntryRow): DebtLedgerEntry => ({
  actualTransactionId: row.actual_transaction_id,
  actualAccountId: row.actual_account_id,
  // A type this build no longer knows is treated as no decision.
  entryType: (LEDGER_ENTRY_TYPES as readonly string[]).includes(row.entry_type) ? (row.entry_type as LedgerEntryType) : "adjustment",
  installmentDueDate: row.installment_due_date,
  revision: row.revision,
  updatedAt: row.updated_at,
});

export function listLedgerEntries(db: SqliteDatabase, debtId: string): DebtLedgerEntry[] {
  return db.prepare("SELECT * FROM debt_ledger_entries WHERE debt_id = ? ORDER BY actual_transaction_id").all<EntryRow>(debtId).map(entryOf);
}

export const ledgerChangeSchema = z.object({
  actualTransactionId: id,
  actualAccountId: id,
  /** Null removes the decision (back to Bench's suggestion). */
  entryType: z.enum(LEDGER_ENTRY_TYPES).nullable(),
  installmentDueDate: isoDate.nullable().optional(),
  /** The revision the change was made from; 0 for a row with no saved decision. */
  revision: z.number().int().min(0),
}).strict();
export type LedgerChange = z.infer<typeof ledgerChangeSchema>;

/** Save the user's classifications, all or none. A change made from an older revision is refused. */
export function saveLedgerEntries(db: SqliteDatabase, debtId: string, input: unknown): DebtLedgerEntry[] {
  const changes = parse(z.array(ledgerChangeSchema).min(1).max(500), input);
  const debt = requireDebt(db, debtId);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const change of changes) {
      const existing = db.prepare("SELECT * FROM debt_ledger_entries WHERE budget_sync_id = ? AND actual_transaction_id = ?").get<EntryRow & { debt_id: string }>(debt.budgetSyncId, change.actualTransactionId);
      if (existing && existing.debt_id !== debtId) throw new AppDbValidationError("That transaction belongs to another loan.");
      if ((existing?.revision ?? 0) !== change.revision) throw new AppDbValidationError("The entry changed since it was read. Refresh and try again.");
      if (change.entryType === null) {
        db.prepare("DELETE FROM debt_ledger_entries WHERE budget_sync_id = ? AND actual_transaction_id = ?").run(debt.budgetSyncId, change.actualTransactionId);
        continue;
      }
      if (change.installmentDueDate && change.entryType !== "principal-repayment") throw new AppDbValidationError("Only a principal repayment pays an installment.");
      db.prepare(`INSERT INTO debt_ledger_entries (budget_sync_id, actual_transaction_id, debt_id, actual_account_id, entry_type, installment_due_date, revision, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(budget_sync_id, actual_transaction_id) DO UPDATE SET actual_account_id = excluded.actual_account_id, entry_type = excluded.entry_type,
          installment_due_date = excluded.installment_due_date, revision = debt_ledger_entries.revision + 1, updated_at = excluded.updated_at`)
        .run(debt.budgetSyncId, change.actualTransactionId, debtId, change.actualAccountId, change.entryType, change.installmentDueDate ?? null, now);
    }
  })();
  return listLedgerEntries(db, debtId);
}

// ── Payment rules ──────────────────────────────────────────────────────────────

export const paymentRuleInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Name the rule").max(100),
  match: z.enum(["all", "any"]),
  conditions: z.array(ruleConditionSchema).min(1, "Add at least one condition").max(20),
}).strict();
export type PaymentRuleInput = z.infer<typeof paymentRuleInputSchema>;

type RuleRow = { id: string; debt_id: string; name: string; match: string; conditions: string; updated_at: string };

export function listPaymentRules(db: SqliteDatabase, debtId: string): DebtPaymentRule[] {
  return db.prepare("SELECT * FROM debt_payment_rules WHERE debt_id = ? ORDER BY created_at, id").all<RuleRow>(debtId).map((row) => ({
    id: row.id, debtId: row.debt_id, name: row.name, match: row.match === "any" ? "any" : "all",
    conditions: (JSON.parse(row.conditions) as unknown[]).flatMap((c) => { const parsed = ruleConditionSchema.safeParse(c); return parsed.success ? [parsed.data] : []; }),
    updatedAt: row.updated_at,
  }));
}

const ruleOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("save"), rule: paymentRuleInputSchema }).strict(),
  z.object({ kind: z.literal("delete"), id }).strict(),
]);

/** Rules only describe which payments are the loan's; saving one changes nothing in Actual. */
export function savePaymentRule(db: SqliteDatabase, debtId: string, input: unknown): DebtPaymentRule[] {
  const operation = parse(ruleOperationSchema, input);
  const debt = requireDebt(db, debtId);
  db.transaction(() => {
    if (operation.kind === "delete") {
      db.prepare("DELETE FROM debt_payment_rules WHERE id = ? AND debt_id = ?").run(operation.id, debtId);
      return;
    }
    const { rule } = operation;
    const now = new Date().toISOString();
    const exists = rule.id ? db.prepare("SELECT 1 AS x FROM debt_payment_rules WHERE id = ? AND debt_id = ?").get(rule.id, debtId) : undefined;
    if (rule.id && !exists) throw new AppDbValidationError("That rule no longer exists. Refresh and try again.");
    const values = [rule.name, rule.match, JSON.stringify(rule.conditions), now];
    if (exists) db.prepare("UPDATE debt_payment_rules SET name = ?, match = ?, conditions = ?, updated_at = ? WHERE id = ?").run(...values, rule.id);
    else {
      const count = db.prepare("SELECT count(*) AS n FROM debt_payment_rules WHERE debt_id = ?").get<{ n: number }>(debtId)?.n ?? 0;
      if (count >= MAX_RULES) throw new AppDbValidationError(`A loan can have at most ${MAX_RULES} payment rules.`);
      db.prepare("INSERT INTO debt_payment_rules (name, match, conditions, updated_at, id, debt_id, budget_sync_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(...values, generateId(), debtId, debt.budgetSyncId, now);
    }
  })();
  return listPaymentRules(db, debtId);
}

// ── Write journal ──────────────────────────────────────────────────────────────

type WriteRow = {
  id: string; debt_id: string; batch_id: string | null; kind: string; installment_due_date: string | null; target_ids_json: string; before_json: string;
  after_json: string; status: string; marker: string | null; actual_ids_json: string | null; error_json: string | null; started_at: string; finished_at: string | null;
};

const writeOf = (row: WriteRow): DebtWrite => ({
  id: row.id, debtId: row.debt_id, batchId: row.batch_id, kind: row.kind as DebtWriteKind, installmentDueDate: row.installment_due_date,
  targetIds: JSON.parse(row.target_ids_json) as string[], before: JSON.parse(row.before_json), after: JSON.parse(row.after_json),
  status: row.status as DebtWriteStatus, marker: row.marker, actualIds: row.actual_ids_json ? (JSON.parse(row.actual_ids_json) as string[]) : null,
  error: row.error_json ? JSON.parse(row.error_json) : null, startedAt: row.started_at, finishedAt: row.finished_at,
});

export function listDebtWrites(db: SqliteDatabase, debtId: string, limit = 200): DebtWrite[] {
  return db.prepare("SELECT * FROM debt_writes WHERE debt_id = ? ORDER BY started_at DESC, id DESC LIMIT ?").all<WriteRow>(debtId, limit).map(writeOf);
}

export function getDebtWrite(db: SqliteDatabase, writeId: string): DebtWrite | null {
  const row = db.prepare("SELECT * FROM debt_writes WHERE id = ?").get<WriteRow>(writeId);
  return row ? writeOf(row) : null;
}

export const startWriteSchema = z.object({
  batchId: id.nullable().optional(),
  kind: z.enum(WRITE_KINDS),
  installmentDueDate: isoDate.nullable().optional(),
  targetIds: z.array(id).max(50),
  before: z.unknown(),
  after: z.unknown(),
  marker: z.string().max(400).nullable().optional(),
}).strict();

/**
 * Record that a write is about to start. Only one write per loan may be in flight: a second tab, or a write left
 * unfinished by a closed page, is refused until it is resolved.
 */
export function startDebtWrite(db: SqliteDatabase, debtId: string, input: unknown, now = new Date().toISOString()): DebtWrite {
  const w = parse(startWriteSchema, input);
  const debt = requireDebt(db, debtId);
  if (debt.status !== "active") throw new AppDbValidationError("Only an active loan can change Actual.");
  const writeId = generateId();
  return db.transaction(() => {
    const cutoff = new Date(Date.parse(now) - KEEP_APPLIED_DAYS * 86_400_000).toISOString();
    db.prepare("DELETE FROM debt_writes WHERE debt_id = ? AND status = 'applied' AND started_at < ?").run(debtId, cutoff);
    const inFlight = db.prepare("SELECT 1 AS x FROM debt_writes WHERE debt_id = ? AND status = 'applying'").get(debtId);
    if (inFlight) throw new AppDbValidationError("Another change to this loan is still being written to Actual. Wait for it, or refresh and check it first.");
    db.prepare(`INSERT INTO debt_writes (id, debt_id, budget_sync_id, batch_id, kind, installment_due_date, target_ids_json, before_json, after_json, status, marker, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'applying', ?, ?)`)
      .run(writeId, debtId, debt.budgetSyncId, w.batchId ?? null, w.kind, w.installmentDueDate ?? null, JSON.stringify(w.targetIds),
        JSON.stringify(w.before ?? null), JSON.stringify(w.after ?? null), w.marker ?? null, now);
    return getDebtWrite(db, writeId)!;
  })();
}

export const finishWriteSchema = z.object({
  status: z.enum(["applied", "failed", "uncertain"]),
  actualIds: z.array(id).max(50).nullable().optional(),
  error: z.unknown().optional(),
}).strict();

/** Record how a write ended. An uncertain write can later be resolved to applied or failed after the user checked Actual. */
export function finishDebtWrite(db: SqliteDatabase, debtId: string, writeId: string, input: unknown, now = new Date().toISOString()): DebtWrite {
  const f = parse(finishWriteSchema, input);
  const existing = getDebtWrite(db, writeId);
  if (!existing || existing.debtId !== debtId) throw new AppDbValidationError("That write is not part of this loan.");
  if (existing.status === "applied" || existing.status === "failed") throw new AppDbValidationError("That write has already finished.");
  db.prepare("UPDATE debt_writes SET status = ?, actual_ids_json = ?, error_json = ?, finished_at = ? WHERE id = ?")
    .run(f.status, f.actualIds ? JSON.stringify(f.actualIds) : null, f.error === undefined ? null : JSON.stringify(f.error), now, writeId);
  return getDebtWrite(db, writeId)!;
}
