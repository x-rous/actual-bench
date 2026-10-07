import { AppDbValidationError } from "./errors";
import { replaceChildRows } from "./debtChildRows";
import {
  optionalCanonicalDecimal,
  optionalIsoDate,
  optionalText,
  requireCanonicalDecimal,
  requireInteger,
  requireIsoDate,
  requireOneOf,
  rethrowConstraint,
} from "./debtValues";
import {
  PAYMENT_CAP_KINDS,
  PER_RATE_RECAST_POLICIES,
  readStoredEnum,
  type DebtPaymentCap,
  type DebtRatePeriodRecord,
  type PerRateRecastPolicy,
  type SqliteDatabase,
} from "./types";

/**
 * A debt's effective-dated rate periods (RD-084 P1.3, v38; FR-043).
 *
 * A payment cap is stored in three columns, one per unit, never overloaded
 * (G1): no cap has all three null; `absolute` has only the amount;
 * `previous-payment-factor` has only the factor, as an exact decimal string.
 * A table CHECK enforces the same shapes.
 */

type RateRow = {
  id: string;
  debt_id: string;
  announced_at: string | null;
  accrual_effective_from: string;
  annual_rate_decimal: string;
  payment_recalc_policy: string | null;
  payment_effective_from: string | null;
  rate_cap_decimal: string | null;
  rate_floor_decimal: string | null;
  payment_cap_kind: string | null;
  payment_cap_amount_minor: number | null;
  payment_cap_factor_decimal: string | null;
  source: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type RatePeriodInput = {
  id?: string | null;
  announcedAt: string | null;
  accrualEffectiveFrom: string;
  /** Canonical decimal string, a fraction (0.0612 = 6.12%). Never a number. */
  annualRateDecimal: string;
  paymentRecalcPolicy: PerRateRecastPolicy | null;
  paymentEffectiveFrom: string | null;
  rateCapDecimal: string | null;
  rateFloorDecimal: string | null;
  paymentCap: { kind: "absolute"; amountMinor: number } | { kind: "previous-payment-factor"; factor: string } | null;
  source: string | null;
  note: string | null;
};

function readCap(row: RateRow): DebtPaymentCap | null {
  if (row.payment_cap_kind === null) return null;
  const kind = readStoredEnum(PAYMENT_CAP_KINDS, row.payment_cap_kind);
  if (kind === "absolute") return { kind, amountMinor: row.payment_cap_amount_minor! };
  if (kind === "previous-payment-factor") return { kind, factor: row.payment_cap_factor_decimal! };
  return { kind };
}

function rowToRecord(row: RateRow): DebtRatePeriodRecord {
  return {
    id: row.id,
    debtId: row.debt_id,
    announcedAt: row.announced_at,
    accrualEffectiveFrom: row.accrual_effective_from,
    annualRateDecimal: row.annual_rate_decimal,
    paymentRecalcPolicy: row.payment_recalc_policy === null ? null : readStoredEnum(PER_RATE_RECAST_POLICIES, row.payment_recalc_policy),
    paymentEffectiveFrom: row.payment_effective_from,
    rateCapDecimal: row.rate_cap_decimal,
    rateFloorDecimal: row.rate_floor_decimal,
    paymentCap: readCap(row),
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function capColumns(cap: unknown): [string | null, number | null, string | null] {
  if (cap === null || cap === undefined) return [null, null, null];
  if (typeof cap !== "object") throw new AppDbValidationError("paymentCap must be an object or null");
  const c = cap as Record<string, unknown>;
  const kind = requireOneOf(PAYMENT_CAP_KINDS, c.kind, "paymentCap.kind");
  if (kind === "absolute") {
    if (c.factor !== undefined) throw new AppDbValidationError("An absolute payment cap has no factor");
    return [kind, requireInteger(c.amountMinor, "paymentCap.amountMinor", 1), null];
  }
  if (c.amountMinor !== undefined) throw new AppDbValidationError("A previous-payment-factor cap has no amount");
  const factor = requireCanonicalDecimal(c.factor, "paymentCap.factor");
  if (factor === "0") throw new AppDbValidationError("paymentCap.factor must be greater than zero");
  return [kind, null, factor];
}

function columns(row: RatePeriodInput) {
  const [capKind, capAmount, capFactor] = capColumns(row.paymentCap);
  return [
    optionalIsoDate(row.announcedAt, "announcedAt"),
    requireIsoDate(row.accrualEffectiveFrom, "accrualEffectiveFrom"),
    requireCanonicalDecimal(row.annualRateDecimal, "annualRateDecimal"),
    row.paymentRecalcPolicy === null ? null : requireOneOf(PER_RATE_RECAST_POLICIES, row.paymentRecalcPolicy, "paymentRecalcPolicy"),
    optionalIsoDate(row.paymentEffectiveFrom, "paymentEffectiveFrom"),
    optionalCanonicalDecimal(row.rateCapDecimal, "rateCapDecimal"),
    optionalCanonicalDecimal(row.rateFloorDecimal, "rateFloorDecimal"),
    capKind,
    capAmount,
    capFactor,
    optionalText(row.source, "source"),
    optionalText(row.note, "note"),
  ] as const;
}

export function listDebtRates(db: SqliteDatabase, debtId: string): DebtRatePeriodRecord[] {
  return db
    .prepare("SELECT * FROM debt_rate_periods WHERE debt_id = ? ORDER BY accrual_effective_from, id")
    .all<RateRow>(debtId)
    .map(rowToRecord);
}

export function replaceDebtRates(db: SqliteDatabase, debtId: string, rows: readonly RatePeriodInput[], now = new Date().toISOString()): void {
  const prepared = rows.map((r) => ({ ...r, cols: columns(r) }));
  try {
    replaceChildRows(db, "debt_rate_periods", debtId, prepared, {
      insert: (id, r) =>
        db
          .prepare(
            `INSERT INTO debt_rate_periods (id, debt_id, announced_at, accrual_effective_from, annual_rate_decimal,
               payment_recalc_policy, payment_effective_from, rate_cap_decimal, rate_floor_decimal, payment_cap_kind,
               payment_cap_amount_minor, payment_cap_factor_decimal, source, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, debtId, ...r.cols, now, now),
      update: (id, r) =>
        db
          .prepare(
            `UPDATE debt_rate_periods SET announced_at = ?, accrual_effective_from = ?, annual_rate_decimal = ?,
               payment_recalc_policy = ?, payment_effective_from = ?, rate_cap_decimal = ?, rate_floor_decimal = ?,
               payment_cap_kind = ?, payment_cap_amount_minor = ?, payment_cap_factor_decimal = ?, source = ?, note = ?,
               updated_at = ?
             WHERE id = ? AND debt_id = ?`
          )
          .run(...r.cols, now, id, debtId),
    });
  } catch (error) {
    rethrowConstraint(error, {
      "debt_rate_periods.debt_id, debt_rate_periods.accrual_effective_from": "Two rate periods start accruing on the same date.",
      FOREIGN: "The debt does not exist.",
    });
  }
}
