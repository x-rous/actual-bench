import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { insertDebt, getDebt, updateDebt, type DebtFields } from "./debtRepository";
import { finishDebtWrite, listDebtWrites, listLedgerEntries, listPaymentRules, saveLedgerEntries, savePaymentRule, startDebtWrite } from "./debtTrackingRepository";

const fields: DebtFields = {
  budgetSyncId: "budget", name: "Home", debtType: "mortgage", behaviorClass: "term-loan", currency: "USD", currencyMinorDigits: 2,
  liabilityAccountId: "loan", paymentAccountId: null, signConvention: "negative-is-debt", lenderPattern: "embedded-interest", executionStrategy: "bench-daily",
  lenderChargeGraceDays: 0, onboardingDate: null, loanPaymentCategoryId: null, drawCategoryId: null, expectedObservationIntervalDays: null, currentConfigJson: "{}",
};

function fixture() {
  const db = getAppDb(join(mkdtempSync(join(tmpdir(), "debt-tracking-")), "app.sqlite"));
  const debt = insertDebt(db, { ...fields, id: "d1", status: "active", currentRevision: 1 });
  return { db, debt };
}
afterEach(resetAppDbForTests);

describe("tracking settings on the debt", () => {
  it("defaults a new loan to untracked with the #interest suffix, and keeps settings an update leaves out", () => {
    const { db } = fixture();
    expect(getDebt(db, "d1")).toMatchObject({ trackingStartDueDate: null, principalNoteSuffix: "", interestNoteSuffix: "#interest", missingGraceDays: 5 });
    updateDebt(db, "d1", { ...fields, status: "active", currentRevision: 1, trackingStartDueDate: "2026-01-01", interestNoteSuffix: " #int ", missingGraceDays: 7 });
    expect(getDebt(db, "d1")).toMatchObject({ trackingStartDueDate: "2026-01-01", interestNoteSuffix: "#int", missingGraceDays: 7 });
    updateDebt(db, "d1", { ...fields, name: "Renamed", status: "active", currentRevision: 1 });
    expect(getDebt(db, "d1")).toMatchObject({ name: "Renamed", trackingStartDueDate: "2026-01-01", missingGraceDays: 7 });
    expect(() => updateDebt(db, "d1", { ...fields, status: "active", currentRevision: 1, missingGraceDays: 99 })).toThrow(/0 to 60/);
  });
});

describe("ledger entries", () => {
  it("saves, revises and removes a classification, refusing a stale revision", () => {
    const { db } = fixture();
    saveLedgerEntries(db, "d1", [{ actualTransactionId: "t1", actualAccountId: "loan", entryType: "extra-principal", revision: 0 }]);
    expect(listLedgerEntries(db, "d1")).toMatchObject([{ actualTransactionId: "t1", entryType: "extra-principal", revision: 1, installmentDueDate: null }]);
    expect(() => saveLedgerEntries(db, "d1", [{ actualTransactionId: "t1", actualAccountId: "loan", entryType: "draw", revision: 0 }])).toThrow(/changed since/);
    saveLedgerEntries(db, "d1", [{ actualTransactionId: "t1", actualAccountId: "loan", entryType: "principal-repayment", installmentDueDate: "2026-02-01", revision: 1 }]);
    expect(listLedgerEntries(db, "d1")[0]).toMatchObject({ entryType: "principal-repayment", installmentDueDate: "2026-02-01", revision: 2 });
    expect(() => saveLedgerEntries(db, "d1", [{ actualTransactionId: "t1", actualAccountId: "loan", entryType: "fee", installmentDueDate: "2026-02-01", revision: 2 }])).toThrow(/Only a principal repayment/);
    saveLedgerEntries(db, "d1", [{ actualTransactionId: "t1", actualAccountId: "loan", entryType: null, revision: 2 }]);
    expect(listLedgerEntries(db, "d1")).toEqual([]);
  });

  it("refuses a row another loan already classified", () => {
    const { db } = fixture();
    insertDebt(db, { ...fields, id: "d2", liabilityAccountId: "loan-2", status: "active", currentRevision: 1 });
    saveLedgerEntries(db, "d1", [{ actualTransactionId: "t1", actualAccountId: "checking", entryType: "not-repayment", revision: 0 }]);
    expect(() => saveLedgerEntries(db, "d2", [{ actualTransactionId: "t1", actualAccountId: "checking", entryType: "not-repayment", revision: 1 }])).toThrow(/another loan/);
  });
});

describe("payment rules", () => {
  const rule = { name: "Mortgage", match: "all", conditions: [{ field: "account", operator: "equals", value: "checking" }, { field: "payee", operator: "equals", value: "bank" }] };
  it("creates, edits and deletes rules on the shared conditions", () => {
    const { db } = fixture();
    const [created] = savePaymentRule(db, "d1", { kind: "save", rule });
    expect(created).toMatchObject({ name: "Mortgage", match: "all", conditions: rule.conditions });
    savePaymentRule(db, "d1", { kind: "save", rule: { ...rule, id: created.id, match: "any" } });
    expect(listPaymentRules(db, "d1")).toMatchObject([{ id: created.id, match: "any" }]);
    expect(savePaymentRule(db, "d1", { kind: "delete", id: created.id })).toEqual([]);
    expect(() => savePaymentRule(db, "d1", { kind: "save", rule: { ...rule, conditions: [] } })).toThrow(/at least one condition/);
    expect(() => savePaymentRule(db, "d1", { kind: "save", rule: { ...rule, id: "gone" } })).toThrow(/no longer exists/);
  });

  it("allows at most ten rules", () => {
    const { db } = fixture();
    for (let i = 0; i < 10; i++) savePaymentRule(db, "d1", { kind: "save", rule: { ...rule, name: `R${i}` } });
    expect(() => savePaymentRule(db, "d1", { kind: "save", rule })).toThrow(/at most 10/);
  });
});

describe("write journal", () => {
  const start = { kind: "split", installmentDueDate: "2026-02-01", targetIds: ["p1"], before: { id: "p1" }, after: { children: 2 } };
  it("allows one write in flight per loan and records how it ended", () => {
    const { db } = fixture();
    const first = startDebtWrite(db, "d1", start);
    expect(first.status).toBe("applying");
    expect(() => startDebtWrite(db, "d1", start)).toThrow(/still being written/);
    finishDebtWrite(db, "d1", first.id, { status: "applied", actualIds: ["p1", "c1", "c2"] });
    expect(() => finishDebtWrite(db, "d1", first.id, { status: "failed" })).toThrow(/already finished/);
    const second = startDebtWrite(db, "d1", start);
    finishDebtWrite(db, "d1", second.id, { status: "uncertain", error: { message: "timeout" } });
    // An uncertain write is resolved once the user checked Actual.
    finishDebtWrite(db, "d1", second.id, { status: "applied" });
    expect(listDebtWrites(db, "d1").map((w) => w.status)).toEqual(["applied", "applied"]);
  });

  it("prunes applied writes older than 90 days and refuses writes on a draft", () => {
    const { db } = fixture();
    const old = startDebtWrite(db, "d1", start, "2025-01-01T00:00:00.000Z");
    finishDebtWrite(db, "d1", old.id, { status: "applied" });
    startDebtWrite(db, "d1", start, "2026-10-01T00:00:00.000Z");
    expect(listDebtWrites(db, "d1")).toHaveLength(1);
    insertDebt(db, { ...fields, id: "draft", liabilityAccountId: "loan-3", status: "draft", currentRevision: 1 });
    expect(() => startDebtWrite(db, "draft", start)).toThrow(/active loan/);
  });
});
