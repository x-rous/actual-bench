import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb } from "@/lib/app-db/connection";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { AccountDirectory } from "../actual/ledgerPort";
import type { DebtSaveInput } from "../services/debtConfigService";

/**
 * Test fixtures for Assets & Debt configuration (RD-084 P1.3). Test support
 * only: no production module imports this file.
 */

export const BUDGET = "budget-1";

export function tempDebtDb(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-debt-"));
  return getAppDb(join(root, "metadata.sqlite"));
}

export function directory(overrides: Partial<AccountDirectory> = {}): AccountDirectory {
  return {
    budgetSyncId: BUDGET,
    accounts: [
      { id: "acc-checking", name: "Everyday", offBudget: false, closed: false },
      { id: "acc-offset", name: "Offset", offBudget: false, closed: false },
      { id: "acc-mortgage", name: "Home loan", offBudget: true, closed: false },
      { id: "acc-car", name: "Car loan", offBudget: true, closed: false },
      { id: "acc-closed", name: "Old savings", offBudget: false, closed: true },
    ],
    categories: [
      { id: "cat-loan", name: "Loan payments", groupName: "Bills", isIncome: false, hidden: false },
      { id: "cat-draw", name: "Redraw", groupName: "Bills", isIncome: false, hidden: false },
      { id: "cat-fees", name: "Bank fees", groupName: "Bills", isIncome: false, hidden: false },
      { id: "cat-income", name: "Salary", groupName: "Income", isIncome: true, hidden: false },
    ],
    ...overrides,
  };
}

/** A complete, supported `rd084.debt-config` v1: $400,000 at a monthly level payment. */
export function debtConfig(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    format: "rd084.debt-config",
    version: 1,
    terms: {
      openingDate: "2024-01-01",
      openingPrincipalMinor: 40_000_000,
      maturityDate: null,
      contractualTermMonths: 360,
      amortizationTermMonths: 360,
      contractualPaymentMinor: null,
      creditLimitMinor: null,
      firstPaymentDate: "2024-02-01",
      firstInterestChargeDate: null,
    },
    profile: {
      amortization: "level-payment",
      rateQuote: "nominal-simple-periodic",
      dayCount: "actual-365-fixed",
      accrual: "per-period",
      chargeFrequency: "at-repayment",
      chargeDay: null,
      capitalization: "at-charge",
      repaymentFrequency: "monthly",
      repaymentDerivation: "annuity-at-payment-frequency",
      recast: "on-rate-change",
      rateEffectiveTiming: "on-accrual-effective-date",
      repaymentEffectiveTiming: "transaction-date",
      rounding: {
        paymentRounding: "half-up",
        interestPostingRounding: "half-up",
        intermediateScale: { mode: "full" },
        intermediateRounding: "half-even",
        balancePrecision: "round-each-posting",
      },
      eventOrder: { timing: "start-of-day" },
      finalPayment: "true-up-to-zero",
      shortMonth: "clamp-to-last-calendar-day",
      negativeAmortizationAllowed: false,
      interestOnlyRepayment: "charged-interest-outstanding",
      presetId: null,
    },
    phases: [],
    components: [
      { economicKind: "principal", label: "Principal", destination: "transfer", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 0 },
      { economicKind: "interest", label: "Interest", destination: "category", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 1 },
    ],
    paymentRecasts: [],
    revolving: null,
  };
  return { ...base, ...patch };
}

export function saveInput(patch: Partial<DebtSaveInput> = {}): DebtSaveInput {
  return {
    budgetSyncId: BUDGET,
    name: "Home loan",
    debtType: "mortgage",
    behaviorClass: "term-loan",
    currency: "AUD",
    currencyMinorDigits: 2,
    liabilityAccountId: "acc-mortgage",
    paymentAccountId: "acc-checking",
    signConvention: "negative-is-debt",
    lenderPattern: "separate-interest",
    executionStrategy: "bench-periodic",
    lenderChargeGraceDays: 3,
    onboardingDate: null,
    loanPaymentCategoryId: "cat-loan",
    drawCategoryId: null,
    expectedObservationIntervalDays: null,
    status: "active",
    config: debtConfig(),
    rates: [
      {
        announcedAt: null,
        accrualEffectiveFrom: "2024-01-01",
        annualRateDecimal: "0.0612",
        paymentRecalcPolicy: null,
        paymentEffectiveFrom: null,
        rateCapDecimal: null,
        rateFloorDecimal: null,
        paymentCap: null,
        source: "Loan contract",
        note: null,
      },
    ],
    offsets: [],
    assumptions: [],
    ...patch,
  };
}
