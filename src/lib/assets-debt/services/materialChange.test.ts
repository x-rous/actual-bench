import { revisionHash } from "@/lib/app-db/modelRevisionRepository";
import type { DebtAssumptionRecord, DebtOffsetLinkRecord, DebtRatePeriodRecord, DebtRecord } from "@/lib/app-db/types";
import type { DebtConfigV1 } from "@/lib/financial-models/loan/configSchema";
import { parseDebtConfig } from "@/lib/financial-models/loan/configSchema";
import { debtConfig } from "../testing/debtFixtures";
import { buildDebtRevisionSnapshot, COSMETIC_FIELDS, DEBT_REVISION_FORMAT, type DebtRevisionInput } from "./materialChange";

/*
 * G1 D-13: everything persisted is material unless whitelisted as cosmetic.
 * A cosmetic edit keeps the hash; a representative material edit changes it.
 */

const T = "2026-09-29T00:00:00.000Z";

function config(): DebtConfigV1 {
  const parsed = parseDebtConfig(debtConfig({ paymentRecasts: [], components: [
    { economicKind: "principal", label: "Principal", destination: "transfer", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 0 },
    { economicKind: "fee", label: "Account fee", destination: "category", categoryId: "cat-fees", amountRule: "fixed", fixedAmountMinor: 1000, treatment: "cash-paid", order: 1 },
  ] }));
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  if (parsed.config.version !== 1) throw new Error("fixture must remain config v1");
  return parsed.config;
}

function input(): DebtRevisionInput {
  const debt: DebtRecord = {
    id: "d1", budgetSyncId: "b1", name: "Home loan", debtType: "mortgage", behaviorClass: "term-loan", currency: "AUD", currencyMinorDigits: 2,
    liabilityAccountId: "acc-l", paymentAccountId: "acc-p", signConvention: "negative-is-debt", lenderPattern: "separate-interest",
    executionStrategy: "bench-periodic", driftToleranceMinor: 100, lenderChargeGraceDays: 3, onboardingDate: null, loanPaymentCategoryId: "cat-loan",
    drawCategoryId: null, expectedObservationIntervalDays: 30, autoApplyEnabled: false, driftAcceptedRevision: null, currentRevision: 1,
    currentConfigJson: "{}", status: "active", createdAt: T, updatedAt: T, archivedAt: null, unknownValues: [],
  };
  const rates: DebtRatePeriodRecord[] = [
    { id: "r2", debtId: "d1", announcedAt: null, accrualEffectiveFrom: "2025-01-01", annualRateDecimal: "0.065", paymentRecalcPolicy: null, paymentEffectiveFrom: null, rateCapDecimal: null, rateFloorDecimal: null, paymentCap: { kind: "previous-payment-factor", factor: "1.075" }, source: "Letter", note: null, createdAt: T, updatedAt: T },
    { id: "r1", debtId: "d1", announcedAt: null, accrualEffectiveFrom: "2024-01-01", annualRateDecimal: "0.0612", paymentRecalcPolicy: null, paymentEffectiveFrom: null, rateCapDecimal: null, rateFloorDecimal: null, paymentCap: null, source: "Contract", note: "first", createdAt: T, updatedAt: T },
  ];
  const offsets: DebtOffsetLinkRecord[] = [{ id: "o1", debtId: "d1", actualAccountId: "acc-o", effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 10000, balanceBasis: "total", capMinor: null, createdAt: T, updatedAt: T }];
  const assumptions: DebtAssumptionRecord[] = [{ id: "a1", debtId: "d1", assumptionKind: "fee", effectiveFrom: "2025-06-01", recurrence: null, amountMinor: 3000, feeTreatment: "capitalized", offsetAccountId: null, note: "annual fee", createdAt: T, updatedAt: T }];
  return { debt, config: config(), rates, offsets, assumptions };
}

const hash = (i: DebtRevisionInput) => revisionHash(buildDebtRevisionSnapshot(i));

describe("rd084.debt-revision v2 snapshot", () => {
  it("wraps the debt config and every material input in a fixed shape", () => {
    const s = buildDebtRevisionSnapshot(input());
    expect(Object.keys(s).sort()).toEqual(["assumptions", "config", "debt", "format", "offsets", "rates", "version"]);
    expect(s.format).toBe(DEBT_REVISION_FORMAT);
    expect((s.config as { format: string }).format).toBe("rd084.debt-config");
    // Child lists in a deterministic order, whatever order they were read in.
    expect(s.rates.map((r) => r.accrualEffectiveFrom)).toEqual(["2024-01-01", "2025-01-01"]);
    // Bench bookkeeping and cosmetic fields are left out; semantic external ids stay.
    expect(Object.keys(s.debt)).not.toEqual(expect.arrayContaining(["id"]));
    for (const k of ["id", "name", "createdAt", "updatedAt", "archivedAt", "currentRevision", "driftAcceptedRevision", "currentConfigJson", "unknownValues"]) expect(s.debt).not.toHaveProperty(k);
    for (const k of ["liabilityAccountId", "paymentAccountId", "loanPaymentCategoryId", "status", "executionStrategy", "lenderPattern", "driftToleranceMinor", "autoApplyEnabled"]) expect(s.debt).toHaveProperty(k);
    expect(s.rates[0]).not.toHaveProperty("source");
    expect(s.rates[0]).not.toHaveProperty("id");
    expect(s.assumptions[0]).not.toHaveProperty("note");
    expect(JSON.stringify(s)).not.toMatch(/balance(Minor)?"?:|transactions/);
  });

  it("does not depend on the order rows were read in", () => {
    const a = input();
    const b = input();
    b.rates = [...b.rates].reverse();
    expect(hash(a)).toBe(hash(b));
  });

  it.each([
    ["the debt name", (i: DebtRevisionInput) => { i.debt.name = "Renamed"; }],
    ["a rate's source text", (i: DebtRevisionInput) => { i.rates[0].source = "Phone call"; }],
    ["a rate's note", (i: DebtRevisionInput) => { i.rates[1].note = "edited"; }],
    ["an assumption's note", (i: DebtRevisionInput) => { i.assumptions[0].note = "changed"; }],
    ["a recast note", (i: DebtRevisionInput) => { i.config.paymentRecasts = [{ date: "2029-01-01", note: null }]; }],
    ["timestamps and row ids", (i: DebtRevisionInput) => { i.debt.updatedAt = "2030-01-01"; i.rates[0].id = "other"; i.offsets[0].createdAt = "x"; }],
    ["the revision pointers", (i: DebtRevisionInput) => { i.debt.currentRevision = 7; i.debt.driftAcceptedRevision = 7; }],
  ])("a cosmetic edit (%s) keeps the hash", (label, edit) => {
    const base = input();
    if (label === "a recast note") base.config.paymentRecasts = [{ date: "2029-01-01", note: "from the letter" }];
    const edited = structuredClone(base);
    edit(edited);
    expect(hash(edited)).toBe(hash(base));
  });

  it.each([
    ["the liability account", (i: DebtRevisionInput) => { i.debt.liabilityAccountId = "acc-other"; }],
    ["the loan payment category", (i: DebtRevisionInput) => { i.debt.loanPaymentCategoryId = "cat-other"; }],
    ["the lender pattern", (i: DebtRevisionInput) => { i.debt.lenderPattern = "embedded-interest"; }],
    ["the strategy", (i: DebtRevisionInput) => { i.debt.executionStrategy = "bench-daily"; }],
    ["the drift tolerance", (i: DebtRevisionInput) => { i.debt.driftToleranceMinor = 500; }],
    ["the grace days", (i: DebtRevisionInput) => { i.debt.lenderChargeGraceDays = 5; }],
    ["the observation interval", (i: DebtRevisionInput) => { i.debt.expectedObservationIntervalDays = 60; }],
    ["the status", (i: DebtRevisionInput) => { i.debt.status = "archived"; }],
    ["a rate value", (i: DebtRevisionInput) => { i.rates[0].annualRateDecimal = "0.066"; }],
    ["a rate date", (i: DebtRevisionInput) => { i.rates[0].accrualEffectiveFrom = "2025-02-01"; }],
    ["a payment cap factor", (i: DebtRevisionInput) => { i.rates[0].paymentCap = { kind: "previous-payment-factor", factor: "1.05" }; }],
    ["an offset account", (i: DebtRevisionInput) => { i.offsets[0].actualAccountId = "acc-o2"; }],
    ["an offset percentage", (i: DebtRevisionInput) => { i.offsets[0].offsetPercentageBps = 5000; }],
    ["offset repayment funding", (i: DebtRevisionInput) => { i.offsets[0].fundScheduledRepayments = true; }],
    ["offset repayment funding start", (i: DebtRevisionInput) => { i.offsets[0].fundScheduledRepaymentsFrom = "2025-03-01"; }],
    ["Actual-linked offset history", (i: DebtRevisionInput) => { i.offsets[0].useActualBalance = true; }],
    ["an assumption amount", (i: DebtRevisionInput) => { i.assumptions[0].amountMinor = 3001; }],
    ["a fee treatment", (i: DebtRevisionInput) => { i.assumptions[0].feeTreatment = "cash-paid"; }],
    ["a component label (material under G1)", (i: DebtRevisionInput) => { i.config.components[1].label = "Package fee"; }],
    ["a component category", (i: DebtRevisionInput) => { i.config.components[1].categoryId = "cat-other"; }],
    ["a component economic kind", (i: DebtRevisionInput) => { i.config.components[1].economicKind = "insurance"; i.config.components[1].treatment = null; }],
    ["a repayment convention", (i: DebtRevisionInput) => { i.config.profile.repaymentDerivation = "contractual-fixed"; }],
    ["a phase", (i: DebtRevisionInput) => { i.config.phases = [{ kind: "interest-only", from: "2024-01-01", to: "2025-01-01", recastAtEnd: "on-rate-change" }]; }],
    ["a dated recast", (i: DebtRevisionInput) => { i.config.paymentRecasts = [{ date: "2029-01-01", note: null }]; }],
    ["the opening principal", (i: DebtRevisionInput) => { i.config.terms.openingPrincipalMinor += 1; }],
  ])("a material edit (%s) changes the hash", (_label, edit) => {
    const base = input();
    const edited = structuredClone(base);
    edit(edited);
    expect(hash(edited)).not.toBe(hash(base));
  });

  it("keeps the cosmetic whitelist exactly as approved", () => {
    expect(COSMETIC_FIELDS).toEqual({ debt: ["name"], rate: ["source", "note"], offset: [], assumption: ["note"], paymentRecast: ["note"] });
  });

  it("treats a field it has never heard of as material", () => {
    const base = input();
    const edited = structuredClone(base);
    (edited.debt as unknown as Record<string, unknown>).futurePostingPolicy = "strict";
    expect(hash(edited)).not.toBe(hash(base));
  });
});
