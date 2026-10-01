import { resetAppDbForTests } from "./connection";
import { canonicalHash, canonicalJson } from "./canonicalJson";
import { listDebtAssumptions, replaceDebtAssumptions, type AssumptionInput } from "./debtAssumptionRepository";
import { listDebtIdsOffsetByAccount, listDebtOffsetLinks, replaceDebtOffsetLinks } from "./debtOffsetLinkRepository";
import { listDebtRates, replaceDebtRates, type RatePeriodInput } from "./debtRateRepository";
import {
  archiveDebt,
  defaultDriftToleranceMinor,
  deleteDraftDebt,
  getDebt,
  insertDebt,
  listDebts,
  setDebtCurrentRevision,
  updateDebt,
  type DebtFields,
} from "./debtRepository";
import * as revisions from "./modelRevisionRepository";
import { getLatestModelRevision, getModelRevision, insertModelRevision, listModelRevisions, revisionHash } from "./modelRevisionRepository";
import { tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";
import type { SqliteDatabase } from "./types";

let db: SqliteDatabase;
beforeEach(() => {
  db = tempDebtDb();
});
afterEach(() => resetAppDbForTests());

const fields = (patch: Partial<DebtFields> = {}): DebtFields => ({
  budgetSyncId: "b1",
  name: "Home loan",
  debtType: "mortgage",
  behaviorClass: "term-loan",
  currency: "AUD",
  currencyMinorDigits: 2,
  liabilityAccountId: "acc-l",
  paymentAccountId: "acc-p",
  signConvention: "negative-is-debt",
  lenderPattern: "separate-interest",
  executionStrategy: "bench-daily",
  lenderChargeGraceDays: 3,
  onboardingDate: null,
  loanPaymentCategoryId: null,
  drawCategoryId: null,
  expectedObservationIntervalDays: null,
  currentConfigJson: "{}",
  ...patch,
});

const rate = (patch: Partial<RatePeriodInput> = {}): RatePeriodInput => ({
  announcedAt: null,
  accrualEffectiveFrom: "2024-01-01",
  annualRateDecimal: "0.0612",
  paymentRecalcPolicy: null,
  paymentEffectiveFrom: null,
  rateCapDecimal: null,
  rateFloorDecimal: null,
  paymentCap: null,
  source: null,
  note: null,
  ...patch,
});

describe("canonical JSON", () => {
  it("sorts keys at every level, so key order never changes the hash", () => {
    const a = { b: 1, a: { d: [1, { y: null, x: "s" }], c: true } };
    const b = { a: { c: true, d: [1, { x: "s", y: null }] }, b: 1 };
    expect(canonicalJson(a)).toBe('{"a":{"c":true,"d":[1,{"x":"s","y":null}]},"b":1}');
    expect(canonicalHash(a)).toBe(canonicalHash(b));
    expect(canonicalHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses floats, non-finite numbers, undefined and class instances", () => {
    expect(() => canonicalJson({ rate: 0.0612 })).toThrow(/safe integers/);
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: undefined })).toThrow(/use null/);
    expect(() => canonicalJson({ when: new Date(0) })).toThrow(/plain objects/);
  });

  it("hashes UTF-8 text deterministically", () => {
    expect(canonicalHash({ name: "Prêt immobilier €" })).toBe(canonicalHash({ name: "Prêt immobilier €" }));
    expect(canonicalHash({ name: "a" })).not.toBe(canonicalHash({ name: "b" }));
  });
});

describe("debt repository", () => {
  it("creates, reads, updates and lists debts with the drift tolerance defaulted from the currency (G1 D-14)", () => {
    const aud = insertDebt(db, { ...fields(), status: "active", currentRevision: 1 });
    expect(aud).toMatchObject({ name: "Home loan", driftToleranceMinor: 100, autoApplyEnabled: false, status: "active", unknownValues: [] });
    const jpy = insertDebt(db, { ...fields({ currency: "JPY", currencyMinorDigits: 0, liabilityAccountId: "acc-j" }), status: "draft", currentRevision: 1 });
    expect(jpy.driftToleranceMinor).toBe(1);
    expect(defaultDriftToleranceMinor(3)).toBe(1000);
    const explicit = insertDebt(db, { ...fields({ liabilityAccountId: "acc-x", driftToleranceMinor: 0 }), status: "active", currentRevision: 1 });
    expect(explicit.driftToleranceMinor).toBe(0);

    const updated = updateDebt(db, aud.id, { ...fields({ name: "Renamed" }), status: "active", currentRevision: 1 });
    expect(updated.name).toBe("Renamed");
    expect(listDebts(db, { budgetSyncId: "b1" }).map((d) => d.name)).toEqual(["Home loan", "Home loan", "Renamed"]);
  });

  it("refuses bad structure before SQLite can coerce it", () => {
    expect(() => insertDebt(db, { ...fields({ currency: "aud" }), status: "active", currentRevision: 1 })).toThrow(/three-letter/);
    expect(() => insertDebt(db, { ...fields({ debtType: "yacht" as never }), status: "active", currentRevision: 1 })).toThrow(/debtType/);
    expect(() => insertDebt(db, { ...fields({ lenderChargeGraceDays: 1.5 }), status: "active", currentRevision: 1 })).toThrow(/whole number/);
    insertDebt(db, { ...fields(), status: "active", currentRevision: 1 });
    expect(() => insertDebt(db, { ...fields(), status: "active", currentRevision: 1 })).toThrow(/already uses that liability account/);
  });

  it("reads an unknown stored enum as unknown, never as a known value", () => {
    const d = insertDebt(db, { ...fields(), status: "active", currentRevision: 1 });
    db.prepare("UPDATE debts SET debt_type = 'houseboat' WHERE id = ?").run(d.id);
    const read = getDebt(db, d.id)!;
    expect(read.debtType).toEqual({ unknown: "houseboat" });
    expect(read.unknownValues).toEqual(["debt_type=houseboat"]);
  });

  it("archives, refuses edits after archiving, and deletes only drafts", () => {
    const active = insertDebt(db, { ...fields(), status: "active", currentRevision: 1 });
    expect(() => deleteDraftDebt(db, active.id)).toThrow(/Only a draft/);
    const archived = archiveDebt(db, active.id, 2, "2026-09-29T00:00:00.000Z");
    expect(archived).toMatchObject({ status: "archived", archivedAt: "2026-09-29T00:00:00.000Z", currentRevision: 2 });
    expect(listDebts(db, { budgetSyncId: "b1" })).toHaveLength(0);
    expect(listDebts(db, { budgetSyncId: "b1", includeArchived: true })).toHaveLength(1);
    expect(() => updateDebt(db, active.id, { ...fields(), status: "active", currentRevision: 2 })).toThrow(/archived/);

    const draft = insertDebt(db, { ...fields({ liabilityAccountId: null }), status: "draft", currentRevision: 1 });
    expect(deleteDraftDebt(db, draft.id)).toBe(true);
    expect(getDebt(db, draft.id)).toBeNull();
  });

  it("never moves a revision pointer backwards", () => {
    const d = insertDebt(db, { ...fields(), status: "active", currentRevision: 3 });
    expect(() => setDebtCurrentRevision(db, d.id, 2)).toThrow(/backwards/);
    setDebtCurrentRevision(db, d.id, 4);
    expect(getDebt(db, d.id)?.currentRevision).toBe(4);
  });
});

describe("rate repository", () => {
  let debtId: string;
  beforeEach(() => {
    debtId = insertDebt(db, { ...fields(), status: "active", currentRevision: 1 }).id;
  });

  it("stores each payment-cap shape in its own column and reads it back", () => {
    replaceDebtRates(db, debtId, [
      rate(),
      rate({ accrualEffectiveFrom: "2025-01-01", paymentRecalcPolicy: "on-rate-change", paymentCap: { kind: "absolute", amountMinor: 250000 } }),
      rate({ accrualEffectiveFrom: "2026-01-01", paymentCap: { kind: "previous-payment-factor", factor: "1.075" } }),
    ]);
    expect(listDebtRates(db, debtId).map((r) => r.paymentCap)).toEqual([null, { kind: "absolute", amountMinor: 250000 }, { kind: "previous-payment-factor", factor: "1.075" }]);
    const raw = db.prepare("SELECT payment_cap_kind, payment_cap_amount_minor, payment_cap_factor_decimal FROM debt_rate_periods ORDER BY accrual_effective_from").all();
    expect(raw).toEqual([
      { payment_cap_kind: null, payment_cap_amount_minor: null, payment_cap_factor_decimal: null },
      { payment_cap_kind: "absolute", payment_cap_amount_minor: 250000, payment_cap_factor_decimal: null },
      { payment_cap_kind: "previous-payment-factor", payment_cap_amount_minor: null, payment_cap_factor_decimal: "1.075" },
    ]);
  });

  it("accepts only canonical decimal strings: never a JS number, never a non-canonical form", () => {
    expect(() => replaceDebtRates(db, debtId, [rate({ annualRateDecimal: 0.0612 as unknown as string })])).toThrow(/not a number/);
    expect(() => replaceDebtRates(db, debtId, [rate({ annualRateDecimal: "0.06120" })])).toThrow(/canonical/);
    expect(() => replaceDebtRates(db, debtId, [rate({ annualRateDecimal: "-0.01" })])).toThrow(/canonical/);
    expect(() => replaceDebtRates(db, debtId, [rate({ paymentCap: { kind: "previous-payment-factor", factor: 1.075 as unknown as string } })])).toThrow(/not a number/);
    expect(() => replaceDebtRates(db, debtId, [rate({ paymentCap: { kind: "previous-payment-factor", factor: "0" } })])).toThrow(/greater than zero/);
    expect(() => replaceDebtRates(db, debtId, [rate({ paymentCap: { kind: "absolute", amountMinor: 0 } })])).toThrow();
    expect(() => replaceDebtRates(db, debtId, [rate({ paymentRecalcPolicy: "annual" as never })])).toThrow(/paymentRecalcPolicy/);
    replaceDebtRates(db, debtId, [rate({ annualRateDecimal: "0" })]);
    expect(listDebtRates(db, debtId)[0].annualRateDecimal).toBe("0");
  });

  it("replaces the set: kept ids keep created_at, missing rows go, new rows arrive", () => {
    replaceDebtRates(db, debtId, [rate(), rate({ accrualEffectiveFrom: "2025-01-01" })], "2026-01-01T00:00:00.000Z");
    const [first] = listDebtRates(db, debtId);
    replaceDebtRates(db, debtId, [rate({ id: first.id, annualRateDecimal: "0.07" }), rate({ accrualEffectiveFrom: "2027-01-01" })], "2026-02-01T00:00:00.000Z");
    const after = listDebtRates(db, debtId);
    expect(after.map((r) => [r.accrualEffectiveFrom, r.annualRateDecimal])).toEqual([["2024-01-01", "0.07"], ["2027-01-01", "0.0612"]]);
    expect(after[0]).toMatchObject({ id: first.id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" });
    expect(() => replaceDebtRates(db, debtId, [rate(), rate()])).toThrow(/same date/);
  });
});

describe("offset link and assumption repositories", () => {
  let debtId: string;
  beforeEach(() => {
    debtId = insertDebt(db, { ...fields(), status: "active", currentRevision: 1 }).id;
  });

  it("stores offset links and finds the debts an account offsets", () => {
    replaceDebtOffsetLinks(db, debtId, [{ actualAccountId: "acc-o", effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 10000, balanceBasis: "cleared", capMinor: null }]);
    expect(listDebtOffsetLinks(db, debtId)).toEqual([expect.objectContaining({ actualAccountId: "acc-o", balanceBasis: "cleared", offsetPercentageBps: 10000 })]);
    expect(listDebtIdsOffsetByAccount(db, "acc-o")).toEqual([debtId]);
    expect(() => replaceDebtOffsetLinks(db, debtId, [{ actualAccountId: "acc-o", effectiveFrom: "2024-01-01", effectiveTo: "2024-01-01", offsetPercentageBps: 10000, balanceBasis: "total", capMinor: null }])).toThrow(/end after/);
  });

  it("stores assumptions with a versioned recurrence envelope and kind-specific fields", () => {
    const rows: AssumptionInput[] = [
      { kind: "extra-repayment", effectiveFrom: "2025-01-01", recurrence: { frequency: "monthly", until: "2025-12-01" }, amountMinor: 50000, feeTreatment: null, offsetAccountId: null, note: "bonus" },
      { kind: "fee", effectiveFrom: "2025-06-01", recurrence: null, amountMinor: 3000, feeTreatment: "capitalized", offsetAccountId: null, note: null },
      { kind: "offset-balance", effectiveFrom: "2025-02-01", recurrence: null, amountMinor: 1_000_000, feeTreatment: null, offsetAccountId: "acc-o", note: null },
      { kind: "offset-deposit", effectiveFrom: "2025-03-01", recurrence: { frequency: "monthly", until: "2025-05-01" }, amountMinor: 25_000, feeTreatment: null, offsetAccountId: "acc-o", note: "salary" },
      { kind: "offset-withdrawal", effectiveFrom: "2025-04-01", recurrence: null, amountMinor: 10_000, feeTreatment: null, offsetAccountId: "acc-o", note: null },
    ];
    replaceDebtAssumptions(db, debtId, rows);
    const stored = listDebtAssumptions(db, debtId);
    expect(stored.map((a) => a.assumptionKind)).toEqual(["extra-repayment", "offset-balance", "offset-deposit", "offset-withdrawal", "fee"]);
    expect(stored[0].recurrence).toEqual({ frequency: "monthly", until: "2025-12-01" });
    expect(db.prepare("SELECT recurrence_json FROM debt_future_assumptions WHERE assumption_kind = 'extra-repayment'").get()).toEqual({
      recurrence_json: '{"version":1,"data":{"frequency":"monthly","until":"2025-12-01"}}',
    });
    expect(() => replaceDebtAssumptions(db, debtId, [{ ...rows[1], feeTreatment: null }])).toThrow(/feeTreatment/);
    expect(() => replaceDebtAssumptions(db, debtId, [{ ...rows[0], feeTreatment: "cash-paid" }])).toThrow(/Only a fee/);
    expect(() => replaceDebtAssumptions(db, debtId, [{ ...rows[2], offsetAccountId: null }])).toThrow(/offsetAccountId/);
    expect(() => replaceDebtAssumptions(db, debtId, [{ ...rows[3], offsetAccountId: null }])).toThrow(/offsetAccountId/);
    expect(() => replaceDebtAssumptions(db, debtId, [{ ...rows[0], kind: "payment-change" }])).toThrow(/cannot recur/);
  });

  it("reads a recurrence envelope from a newer build as unknown, not as v1", () => {
    replaceDebtAssumptions(db, debtId, [{ kind: "draw", effectiveFrom: "2025-01-01", recurrence: null, amountMinor: 100, feeTreatment: null, offsetAccountId: null, note: null }]);
    db.prepare("UPDATE debt_future_assumptions SET recurrence_json = ?").run('{"version":2,"data":{"rule":"FREQ=MONTHLY"}}');
    expect(listDebtAssumptions(db, debtId)[0].recurrence).toEqual({ unknown: '{"version":2,"data":{"rule":"FREQ=MONTHLY"}}' });
  });
});

describe("model revision repository", () => {
  it("is insert-only: no update or delete is exported", () => {
    const exported = Object.keys(revisions).sort();
    expect(exported).toEqual(["getLatestModelRevision", "getModelRevision", "insertModelRevision", "listModelRevisions", "revisionHash"]);
  });

  it("stores the canonical snapshot so the stored text re-hashes to the stored hash", () => {
    const snapshot = { version: 1, format: "rd084.debt-revision", debt: { b: "2", a: 1 } };
    const r = insertModelRevision(db, { subjectKind: "debt", subjectId: "d1", revision: 1, configFormat: "rd084.debt-revision", configVersion: 1, snapshot });
    expect(r.configJson).toBe('{"debt":{"a":1,"b":"2"},"format":"rd084.debt-revision","version":1}');
    expect(r.configHash).toBe(revisionHash(JSON.parse(r.configJson)));
    expect(r.configHash).toBe(revisionHash({ debt: { a: 1, b: "2" }, format: "rd084.debt-revision", version: 1 }));
    expect(() => insertModelRevision(db, { subjectKind: "debt", subjectId: "d1", revision: 1, configFormat: "x", configVersion: 1, snapshot: {} })).toThrow(/already exists/);
    insertModelRevision(db, { subjectKind: "debt", subjectId: "d1", revision: 2, configFormat: "rd084.debt-revision", configVersion: 1, snapshot: {}, changeSummary: "Rate change" });
    expect(getLatestModelRevision(db, "debt", "d1")).toMatchObject({ revision: 2, changeSummary: "Rate change" });
    expect(listModelRevisions(db, "debt", "d1").map((x) => x.revision)).toEqual([1, 2]);
    expect(getModelRevision(db, "debt", "d1", 3)).toBeNull();
  });

  it("returns a revision with an unknown wrapper format or version as data, never reinterpreted", () => {
    db.prepare(
      "INSERT INTO model_revisions (subject_kind, subject_id, revision, config_format, config_version, config_json, config_hash, created_at) VALUES ('debt', 'd9', 1, 'rd084.debt-revision', 2, '{\"future\":true}', ?, 't')"
    ).run("c".repeat(64));
    expect(getModelRevision(db, "debt", "d9", 1)).toMatchObject({ configFormat: "rd084.debt-revision", configVersion: 2, configJson: '{"future":true}' });
  });
});
