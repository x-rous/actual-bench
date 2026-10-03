import { AppDbValidationError } from "./errors";
import { replaceChildRows } from "./debtChildRows";
import { optionalInteger, optionalIsoDate, requireInteger, requireIsoDate, requireOneOf, requireText, rethrowConstraint } from "./debtValues";
import { OFFSET_BALANCE_BASES, readStoredEnum, type DebtOffsetLinkRecord, type OffsetBalanceBasis, type SqliteDatabase } from "./types";

/**
 * Offset account links (RD-084 P1.3, v38; FR-055). A link names an Actual
 * account by id; that the account exists, is in the debt's budget and may
 * offset is checked by the configuration service against the budget's
 * accounts. Offset balances are read from Actual when needed, never stored.
 */

type OffsetRow = {
  id: string;
  debt_id: string;
  actual_account_id: string;
  effective_from: string;
  effective_to: string | null;
  offset_percentage_bps: number;
  balance_basis: string;
  cap_minor: number | null;
  fund_scheduled_repayments: number;
  fund_scheduled_repayments_from: string | null;
  use_actual_balance: number;
  created_at: string;
  updated_at: string;
};

export type OffsetLinkInput = {
  id?: string | null;
  actualAccountId: string;
  effectiveFrom: string;
  /** Exclusive; null is open-ended. */
  effectiveTo: string | null;
  offsetPercentageBps: number;
  balanceBasis: OffsetBalanceBasis;
  capMinor: number | null;
  fundScheduledRepayments?: boolean;
  fundScheduledRepaymentsFrom?: string | null;
  useActualBalance?: boolean;
};

function rowToRecord(row: OffsetRow): DebtOffsetLinkRecord {
  return {
    id: row.id,
    debtId: row.debt_id,
    actualAccountId: row.actual_account_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    offsetPercentageBps: row.offset_percentage_bps,
    balanceBasis: readStoredEnum(OFFSET_BALANCE_BASES, row.balance_basis),
    capMinor: row.cap_minor,
    fundScheduledRepayments: row.fund_scheduled_repayments === 1,
    fundScheduledRepaymentsFrom: row.fund_scheduled_repayments_from,
    useActualBalance: row.use_actual_balance === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function columns(row: OffsetLinkInput) {
  const from = requireIsoDate(row.effectiveFrom, "effectiveFrom");
  const to = optionalIsoDate(row.effectiveTo, "effectiveTo");
  if (to !== null && to <= from) throw new AppDbValidationError("An offset link must end after it starts");
  const bps = requireInteger(row.offsetPercentageBps, "offsetPercentageBps", 1);
  if (bps > 10_000) throw new AppDbValidationError("offsetPercentageBps must be at most 10000 (100%)");
  return [
    requireText(row.actualAccountId, "actualAccountId"),
    from,
    to,
    bps,
    requireOneOf(OFFSET_BALANCE_BASES, row.balanceBasis, "balanceBasis"),
    optionalInteger(row.capMinor, "capMinor", 1),
    row.fundScheduledRepayments ? 1 : 0,
    optionalIsoDate(row.fundScheduledRepaymentsFrom, "fundScheduledRepaymentsFrom"),
    row.useActualBalance ? 1 : 0,
  ] as const;
}

export function listDebtOffsetLinks(db: SqliteDatabase, debtId: string): DebtOffsetLinkRecord[] {
  return db
    .prepare("SELECT * FROM debt_offset_links WHERE debt_id = ? ORDER BY effective_from, actual_account_id, id")
    .all<OffsetRow>(debtId)
    .map(rowToRecord);
}

/** Debts linking an Actual account as an offset (query pattern behind the account index). */
export function listDebtIdsOffsetByAccount(db: SqliteDatabase, actualAccountId: string): string[] {
  return db
    .prepare("SELECT DISTINCT debt_id FROM debt_offset_links WHERE actual_account_id = ? ORDER BY debt_id")
    .all<{ debt_id: string }>(actualAccountId)
    .map((r) => r.debt_id);
}

export function replaceDebtOffsetLinks(db: SqliteDatabase, debtId: string, rows: readonly OffsetLinkInput[], now = new Date().toISOString()): void {
  const prepared = rows.map((r) => ({ ...r, cols: columns(r) }));
  try {
    replaceChildRows(db, "debt_offset_links", debtId, prepared, {
      insert: (id, r) =>
        db
          .prepare(
            `INSERT INTO debt_offset_links (id, debt_id, actual_account_id, effective_from, effective_to,
               offset_percentage_bps, balance_basis, cap_minor, fund_scheduled_repayments,
               fund_scheduled_repayments_from, use_actual_balance, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, debtId, ...r.cols, now, now),
      update: (id, r) =>
        db
          .prepare(
            `UPDATE debt_offset_links SET actual_account_id = ?, effective_from = ?, effective_to = ?,
               offset_percentage_bps = ?, balance_basis = ?, cap_minor = ?, fund_scheduled_repayments = ?,
               fund_scheduled_repayments_from = ?, use_actual_balance = ?, updated_at = ?
             WHERE id = ? AND debt_id = ?`
          )
          .run(...r.cols, now, id, debtId),
    });
  } catch (error) {
    rethrowConstraint(error, { FOREIGN: "The debt does not exist." });
  }
}
