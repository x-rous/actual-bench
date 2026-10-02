import { resetAppDbForTests } from "./connection";
import { tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";
import type { SqliteDatabase } from "./types";

/*
 * v38 configuration constraints plus v39's offset-kind invariant, exercised with raw SQL: the database itself
 * refuses structurally invalid rows, whatever code path writes them. Semantic
 * rules are the service's; these are the structural floor under it.
 */

let db: SqliteDatabase;
beforeEach(() => {
  db = tempDebtDb();
});
afterEach(() => resetAppDbForTests());

const T = "2026-09-29T00:00:00.000Z";

function debt(values: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: "d1", budget_sync_id: "b1", name: "Home loan", debt_type: "mortgage", behavior_class: "term-loan", currency: "AUD",
    currency_minor_digits: 2, liability_account_id: "acc-l", payment_account_id: "acc-p", sign_convention: "negative-is-debt",
    lender_pattern: "separate-interest", execution_strategy: "bench-periodic", drift_tolerance_minor: 100, lender_charge_grace_days: 3,
    auto_apply_enabled: 0, current_revision: 1, current_config_json: "{}", status: "active", created_at: T, updated_at: T, archived_at: null,
    ...values,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO debts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]));
}

function insert(table: string, values: Record<string, unknown>) {
  const cols = Object.keys(values);
  db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => values[c]));
}

let n = 0;
const rate = (values: Record<string, unknown>) =>
  insert("debt_rate_periods", { id: `r${++n}`, debt_id: "d1", accrual_effective_from: `2024-01-${String(n).padStart(2, "0")}`, annual_rate_decimal: "0.0612", created_at: T, updated_at: T, ...values });
const offset = (values: Record<string, unknown>) =>
  insert("debt_offset_links", { id: `o${++n}`, debt_id: "d1", actual_account_id: "acc-o", effective_from: "2024-01-01", offset_percentage_bps: 10000, balance_basis: "total", created_at: T, updated_at: T, ...values });
const assumption = (values: Record<string, unknown>) =>
  insert("debt_future_assumptions", { id: `a${++n}`, debt_id: "d1", assumption_kind: "extra-repayment", effective_from: "2025-01-01", amount_minor: 1000, created_at: T, updated_at: T, ...values });
const revision = (values: Record<string, unknown>) =>
  insert("model_revisions", { subject_kind: "debt", subject_id: "d1", revision: ++n, config_format: "rd084.debt-revision", config_version: 1, config_json: "{}", config_hash: "a".repeat(64), created_at: T, ...values });

describe("debts", () => {
  it("accepts a valid debt and a draft without accounts", () => {
    debt();
    debt({ id: "d2", status: "draft", liability_account_id: null, payment_account_id: null });
    expect(db.prepare("SELECT count(*) AS n FROM debts").get<{ n: number }>()?.n).toBe(2);
  });

  it.each([
    ["a blank name", { name: "   " }],
    ["a lower-case currency", { currency: "aud" }],
    ["a four-letter currency", { currency: "AUDX" }],
    ["minor digits above 4", { currency_minor_digits: 5 }],
    ["minor digits stored as REAL", { currency_minor_digits: 2.5 }],
    ["a negative drift tolerance", { drift_tolerance_minor: -1 }],
    ["negative grace days", { lender_charge_grace_days: -1 }],
    ["a zero observation interval", { expected_observation_interval_days: 0 }],
    ["auto-apply stored as 2", { auto_apply_enabled: 2 }],
    ["revision 0", { current_revision: 0 }],
    ["an accepted drift revision above the current one", { drift_accepted_revision: 2 }],
    ["invalid config JSON", { current_config_json: "{not json" }],
    ["archived without archived_at", { status: "archived" }],
    ["archived_at on an active debt", { archived_at: T }],
    ["the payment account equal to the liability account", { payment_account_id: "acc-l" }],
    ["no budget", { budget_sync_id: null }],
  ])("refuses %s", (_label, values) => {
    expect(() => debt(values)).toThrow();
  });

  it("allows one live debt per liability account, but archived debts may share it", () => {
    debt();
    expect(() => debt({ id: "d2" })).toThrow(/UNIQUE/);
    debt({ id: "d3", status: "archived", archived_at: T });
    debt({ id: "d4", budget_sync_id: "b2" });
    db.prepare("UPDATE debts SET status = 'archived', archived_at = ? WHERE id = 'd1'").run(T);
    debt({ id: "d5" });
  });
});

describe("rate periods and the payment-cap union", () => {
  beforeEach(() => debt());

  it.each([
    ["no cap", {}],
    ["an absolute cap", { payment_cap_kind: "absolute", payment_cap_amount_minor: 50000 }],
    ["a previous-payment factor", { payment_cap_kind: "previous-payment-factor", payment_cap_factor_decimal: "1.075" }],
    ["a zero rate", { annual_rate_decimal: "0" }],
    ["rate cap and floor", { rate_cap_decimal: "0.1", rate_floor_decimal: "0.02" }],
  ])("accepts %s", (_label, values) => {
    expect(() => rate(values)).not.toThrow();
  });

  it.each([
    ["absolute without an amount", { payment_cap_kind: "absolute" }],
    ["absolute with a factor", { payment_cap_kind: "absolute", payment_cap_amount_minor: 5, payment_cap_factor_decimal: "1.1" }],
    ["a factor cap with an amount", { payment_cap_kind: "previous-payment-factor", payment_cap_amount_minor: 5, payment_cap_factor_decimal: "1.1" }],
    ["a factor cap without a factor", { payment_cap_kind: "previous-payment-factor" }],
    ["an amount with no kind", { payment_cap_amount_minor: 5 }],
    ["a factor with no kind", { payment_cap_factor_decimal: "1.1" }],
    ["an unknown kind", { payment_cap_kind: "percent", payment_cap_amount_minor: 5 }],
    ["a zero amount", { payment_cap_kind: "absolute", payment_cap_amount_minor: 0 }],
    ["an amount stored as REAL", { payment_cap_kind: "absolute", payment_cap_amount_minor: 100.5 }],
    ["a zero factor", { payment_cap_kind: "previous-payment-factor", payment_cap_factor_decimal: "0.000" }],
    ["a negative factor", { payment_cap_kind: "previous-payment-factor", payment_cap_factor_decimal: "-1" }],
    ["a factor with two points", { payment_cap_kind: "previous-payment-factor", payment_cap_factor_decimal: "1.07.5" }],
    ["a factor with an exponent", { payment_cap_kind: "previous-payment-factor", payment_cap_factor_decimal: "1e3" }],
    ["a trailing point", { payment_cap_kind: "previous-payment-factor", payment_cap_factor_decimal: "1." }],
    ["a negative rate", { annual_rate_decimal: "-0.01" }],
    ["an empty rate", { annual_rate_decimal: "" }],
    ["a bad rate cap", { rate_cap_decimal: "ten" }],
  ])("refuses %s", (_label, values) => {
    expect(() => rate(values)).toThrow();
  });

  it("allows one rate per accrual date", () => {
    rate({ accrual_effective_from: "2030-01-01" });
    expect(() => rate({ accrual_effective_from: "2030-01-01" })).toThrow(/UNIQUE/);
  });

  it("stores a factor as text, never REAL", () => {
    rate({ id: "rf", payment_cap_kind: "previous-payment-factor", payment_cap_factor_decimal: "1.075" });
    expect(db.prepare("SELECT typeof(payment_cap_factor_decimal) AS t FROM debt_rate_periods WHERE id = 'rf'").get()).toEqual({ t: "text" });
  });
});

describe("offset links and assumptions", () => {
  beforeEach(() => debt());

  it("checks offset percentages, caps and date order", () => {
    expect(() => offset({})).not.toThrow();
    expect(() => offset({ effective_to: "2025-01-01", cap_minor: 100 })).not.toThrow();
    for (const bad of [{ offset_percentage_bps: 0 }, { offset_percentage_bps: 10001 }, { cap_minor: 0 }, { fund_scheduled_repayments: 2 }, { effective_to: "2024-01-01" }, { effective_to: "2023-12-31" }, { actual_account_id: null }]) {
      expect(() => offset(bad)).toThrow();
    }
  });

  it("ties fee treatment to fees and the account to all offset assumptions", () => {
    expect(() => assumption({ assumption_kind: "fee", fee_treatment: "capitalized" })).not.toThrow();
    expect(() => assumption({ assumption_kind: "offset-balance", offset_account_id: "acc-o" })).not.toThrow();
    expect(() => assumption({ assumption_kind: "offset-deposit", offset_account_id: "acc-o", amount_minor: 1 })).not.toThrow();
    expect(() => assumption({ assumption_kind: "offset-withdrawal", offset_account_id: "acc-o", amount_minor: 1 })).not.toThrow();
    expect(() => assumption({ assumption_kind: "fee" })).toThrow();
    expect(() => assumption({ fee_treatment: "cash-paid" })).toThrow();
    expect(() => assumption({ assumption_kind: "offset-balance" })).toThrow();
    expect(() => assumption({ assumption_kind: "offset-deposit" })).toThrow();
    expect(() => assumption({ assumption_kind: "offset-withdrawal" })).toThrow();
    expect(() => assumption({ offset_account_id: "acc-o" })).toThrow();
    expect(() => assumption({ recurrence_json: "{oops" })).toThrow();
    expect(() => assumption({ amount_minor: -1 })).toThrow();
  });

  it("has no rate_decimal column (G1 D-4)", () => {
    expect(() => assumption({ rate_decimal: "0.05" })).toThrow(/no column named rate_decimal/);
  });
});

describe("model revisions", () => {
  beforeEach(() => debt());

  it("checks revision numbers, JSON and hash syntax", () => {
    expect(() => revision({})).not.toThrow();
    for (const bad of [{ revision: 0 }, { config_version: 0 }, { config_json: "nope" }, { config_hash: "A".repeat(64) }, { config_hash: "a".repeat(63) }, { config_hash: "g".repeat(64) }]) {
      expect(() => revision(bad)).toThrow();
    }
  });

  it("defaults the change summary to empty text", () => {
    revision({ revision: 50 });
    expect(db.prepare("SELECT change_summary FROM model_revisions WHERE revision = 50").get()).toEqual({ change_summary: "" });
  });

  it("refuses every update", () => {
    revision({ revision: 60 });
    expect(() => db.prepare("UPDATE model_revisions SET change_summary = 'edited' WHERE revision = 60").run()).toThrow(/immutable/);
    expect(() => db.prepare("UPDATE model_revisions SET config_hash = ? WHERE revision = 60").run("b".repeat(64))).toThrow(/immutable/);
  });
});

describe("foreign keys and deletion", () => {
  it("refuses child rows for a missing debt", () => {
    expect(() => rate({ debt_id: "missing" })).toThrow(/FOREIGN KEY/);
    expect(() => offset({ debt_id: "missing" })).toThrow(/FOREIGN KEY/);
    expect(() => assumption({ debt_id: "missing" })).toThrow(/FOREIGN KEY/);
  });

  it("deleting a debt removes its configuration rows and, by trigger, only its own revisions", () => {
    debt();
    debt({ id: "d2", liability_account_id: "acc-l2" });
    rate({});
    offset({});
    assumption({});
    revision({ revision: 1 });
    revision({ revision: 2 });
    revision({ subject_id: "d2", revision: 1 });
    // Another subject kind with the same id is not the debt's.
    revision({ subject_kind: "asset", revision: 1 });
    db.prepare("DELETE FROM debts WHERE id = 'd1'").run();
    const count = (sql: string) => db.prepare(sql).get<{ n: number }>()?.n;
    expect(count("SELECT count(*) AS n FROM debt_rate_periods")).toBe(0);
    expect(count("SELECT count(*) AS n FROM debt_offset_links")).toBe(0);
    expect(count("SELECT count(*) AS n FROM debt_future_assumptions")).toBe(0);
    expect(db.prepare("SELECT subject_kind, subject_id FROM model_revisions ORDER BY subject_kind, subject_id").all()).toEqual([
      { subject_kind: "asset", subject_id: "d1" },
      { subject_kind: "debt", subject_id: "d2" },
    ]);
  });
});
