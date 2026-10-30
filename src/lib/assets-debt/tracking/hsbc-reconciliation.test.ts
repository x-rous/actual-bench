import { planTracking } from "./plan";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import type { BusinessDayConvention } from "@/lib/financial-models/calendar/businessDays";
import history from "@/lib/financial-models/loan/__goldens__/hsbc-aed-350k-history/history.json";

const CONVENTION = history.businessDays as BusinessDayConvention;
const RESIDUAL = history.roundingResidualMinor;
const MODEL: LoanModelSnapshot = {
  debtId: "hsbc-aed-350k-history",
  revision: 1,
  currency: { code: history.currency, minorDigits: history.minorDigits },
  behaviorClass: "term-loan",
  lenderPattern: "embedded-interest",
  terms: {
    openingDate: history.openingDate,
    openingPrincipalMinor: history.principalMinor,
    maturityDate: history.maturityDate,
    contractualTermMonths: history.paymentCount,
    amortizationTermMonths: history.paymentCount,
    contractualPaymentMinor: history.contractualPaymentMinor,
    creditLimitMinor: null,
    firstPaymentDate: history.firstPaymentDate,
    firstInterestChargeDate: null,
  },
  profile: {
    amortization: "level-payment",
    rateQuote: "nominal-simple-periodic",
    dayCount: "actual-365-fixed",
    accrual: "daily-simple",
    chargeFrequency: "at-repayment",
    chargeDay: null,
    capitalization: "at-charge",
    repaymentFrequency: "monthly",
    repaymentDerivation: "contractual-fixed",
    recast: "never",
    rateEffectiveTiming: "on-accrual-effective-date",
    repaymentEffectiveTiming: "transaction-date",
    rounding: {
      paymentRounding: "half-up",
      interestPostingRounding: "half-up",
      intermediateScale: { mode: "full" },
      intermediateRounding: "half-even",
      balancePrecision: "round-each-posting",
    },
    eventOrder: { scheduledRepayments: "after-accrual", otherPayments: "before-accrual", offsets: "before-accrual" },
    finalPayment: "true-up-to-zero",
    shortMonth: "clamp-to-last-calendar-day",
    negativeAmortizationAllowed: false,
    interestOnlyRepayment: "charged-interest-outstanding",
    presetId: null,
  },
  rates: [{ accrualEffectiveFrom: history.openingDate, annualRateDecimal: history.annualRateDecimal }],
  phases: [],
  offsets: [],
  components: [],
  paymentRecasts: [],
  assumptions: [],
  revolving: null,
  businessDays: CONVENTION,
  lenderStatement: { interestAllocation: "accrued-to-due-date" },
};

const isAnomaly = (row: (typeof history.rows)[number]) => "anomaly" in row;

describe("HSBC reconciliation", () => {
  it("keeps the lender allocation when Actual's balance is accepted after early payments", () => {
    const tx = (fields: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "id" | "accountId" | "date" | "amount">): SyncSourceTransaction => ({
      payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false,
      importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...fields,
    });
    // The last fixture payment includes a separately documented unexplained charge.
    const rows = history.rows.filter((row) => !isAnomaly(row));
    const loanRows = [tx({ id: "opening", accountId: "loan", date: history.openingDate, amount: -history.principalMinor, payeeName: "Starting Balance" })];
    const bankRows: SyncSourceTransaction[] = [];
    rows.forEach((row, i) => {
      const loanId = `loan-${i}`;
      const principalId = `principal-${i}`;
      loanRows.push(tx({ id: loanId, accountId: "loan", date: row.paidDate, amount: row.principalMinor, transferId: principalId }));
      bankRows.push(tx({ id: `payment-${i}`, accountId: "bank", date: row.paidDate, amount: -row.paymentMinor, isParent: true, splitLines: [
        { id: principalId, amount: -row.principalMinor, transferId: loanId, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null },
        { id: `interest-${i}`, amount: -row.interestMinor, transferId: null, payeeId: null, payeeName: null, categoryId: "interest", categoryName: null, notes: null },
      ] }));
    });
    const input = {
      debt: { id: "d", budgetSyncId: "b", liabilityAccountId: "loan", trackingStartDueDate: history.firstPaymentDate, representation: "split", loanPaymentCategoryId: null, interestCategoryId: "interest", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "", toleranceMinor: RESIDUAL, missingGraceDays: 5 },
      model: MODEL, today: rows.at(-1)!.paidDate, accounts: [], transferPayeeByAccount: {}, loanRows, bankRows, entries: [], rules: [],
      anchors: rows.map((row) => ({ date: row.paidDate, principalMinor: row.balanceMinor })),
    } satisfies Parameters<typeof planTracking>[0];
    const result = planTracking(input);
    if (!result.ok) throw new Error(result.message);
    // Before the fix these were 248001, 250411, 265251 and 228455 minor units.
    rows.forEach((row, i) => {
      expect(Math.abs(result.installments[i].calculatedInterestMinor - row.interestMinor)).toBeLessThanOrEqual(RESIDUAL);
      expect(result.installments[i].balanceAfterMinor).toBe(row.balanceMinor);
    });
    // An accepted balance can also differ from the calculated one. Interest after that anchor
    // must use the changed principal, while retaining what the prior repayment reported.
    const anchors = [...input.anchors];
    anchors[0] = { ...anchors[0], principalMinor: anchors[0].principalMinor + 365_000 };
    const changed = planTracking({ ...input, anchors });
    if (!changed.ok) throw new Error(changed.message);
    expect(changed.installments[0].balanceAfterMinor).toBe(rows[0].balanceMinor + 365_000);
    expect(Math.abs(changed.installments[1].calculatedInterestMinor - result.installments[1].calculatedInterestMinor - 2_656)).toBeLessThanOrEqual(RESIDUAL);
  });

});
