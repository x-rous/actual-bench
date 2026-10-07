import { adjustSchedule, type BusinessDayConvention } from "../calendar/businessDays";
import { toDayNumber } from "../calendar/dates";
import { generateSchedule } from "../calendar/schedule";
import { simulateDaily } from "./daily-engine";
import type { LoanModelSnapshot } from "./model";
import { allocateObservedRepayments, compareLenderStatement, type ObservedRepayment } from "./statementAllocation";
import history from "./__goldens__/hsbc-aed-350k-history/history.json";

/**
 * The full HSBC AED 350,000 repayment history (RD-084 P1.6 T285), as the
 * lender reported it: 35 repayments, each paid a few days before its due date.
 *
 * The lender's convention is generic: Actual/365 daily interest on the actual
 * balance, due dates on the 1st moved to the following business day (Sunday
 * and the saved holidays are non-business days), and statements that allocate
 * interest to each adjusted due date with the early-payment benefit credited
 * one repayment later. Nothing here is HSBC-specific code.
 *
 * The last repayment reports 100.00 more interest than the convention
 * explains. It is flagged and kept as a separate, unexplained charge; the
 * calculation is never fitted to it.
 */

type HistoryRow = (typeof history.rows)[number];

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

const anomaly = (row: HistoryRow) => ("anomaly" in row ? row.anomaly : null);
const isAnomaly = (row: HistoryRow) => anomaly(row) !== null;

/** The repayments as observed; the flagged charge is recorded as its own fee line, never as interest. */
const observed = (withFlaggedFee: boolean): ObservedRepayment[] =>
  history.rows.map((row) => ({
    dueDate: row.adjustedDueDate,
    paidDate: row.paidDate,
    amountMinor: row.paymentMinor,
    ...(withFlaggedFee && anomaly(row) ? { feesMinor: anomaly(row)!.amountMinor } : {}),
  }));

const allocate = (allocation: "as-calculated" | "accrued-to-due-date", withFlaggedFee = true) => {
  const result = allocateObservedRepayments({
    model: MODEL,
    opening: { date: history.openingDate, principalMinor: history.principalMinor },
    repayments: observed(withFlaggedFee),
    allocation,
  });
  if (!result.ok) throw new Error(result.message);
  return result;
};

/** Independent rational oracle: interest on `balanceMinor` for `days` at the fixture rate, Act/365, exact. */
const oracleInterest = (balanceMinor: number, days: number) => (balanceMinor * Number(history.annualRateDecimal) * days) / 365;
const days = (from: string, to: string) => toDayNumber(to) - toDayNumber(from);

describe("HSBC AED 350,000 full repayment history (golden)", () => {
  it("is internally consistent as the lender reported it", () => {
    let balance = history.principalMinor;
    for (const row of history.rows) {
      expect(row.principalMinor + row.interestMinor).toBe(row.paymentMinor);
      expect(balance - row.principalMinor).toBe(row.balanceMinor);
      expect(days(row.paidDate, row.adjustedDueDate)).toBeGreaterThan(0);
      balance = row.balanceMinor;
    }
    expect(history.rows).toHaveLength(35);
    expect(history.rows.filter(isAnomaly)).toHaveLength(1);
  });

  it("derives every adjusted due date from the 1st with the following rule, Sunday and the saved holidays", () => {
    const contractual = generateSchedule(
      { frequency: "monthly", firstDate: history.firstPaymentDate, shortMonthPolicy: "clamp-to-last-calendar-day" },
      { from: history.firstPaymentDate, to: history.rows.at(-1)!.contractualDueDate }
    );
    expect(contractual).toEqual(history.rows.map((r) => r.contractualDueDate));
    expect(adjustSchedule(contractual, CONVENTION)).toEqual(history.rows.map((r) => r.adjustedDueDate));
    // Saturday is a business day for this lender: 01-Mar-2025 does not move.
    expect(history.rows.find((r) => r.contractualDueDate === "2025-03-01")?.adjustedDueDate).toBe("2025-03-01");
  });

  it("schedules projected repayments on the adjusted dates in the daily engine", () => {
    const result = simulateDaily({
      model: MODEL,
      anchor: { date: history.openingDate, principalMinor: history.principalMinor, accruedInterestMinor: 0, source: "bank-opening" },
      events: [],
      to: "2026-10-31",
    });
    if (!result.ok) throw new Error(result.blocked.map((b) => b.message).join("; "));
    const dates = result.events.filter((e) => e.type === "repayment").map((e) => e.date);
    expect(dates).toEqual(history.rows.map((r) => r.adjustedDueDate));
    expect(result.versions["business-days"]).toBe("business-days@1");

    const unadjusted = simulateDaily({
      model: { ...MODEL, businessDays: null },
      anchor: { date: history.openingDate, principalMinor: history.principalMinor, accruedInterestMinor: 0, source: "bank-opening" },
      events: [],
      to: "2026-10-31",
    });
    if (!unadjusted.ok) throw new Error("unadjusted run blocked");
    expect(unadjusted.events.filter((e) => e.type === "repayment").map((e) => e.date)).toEqual(history.rows.map((r) => r.contractualDueDate));
    expect(unadjusted.versions["business-days"]).toBeUndefined();
  });

  it("reproduces the lender's principal and interest split with the accrued-to-due-date allocation", () => {
    const { rows } = allocate("accrued-to-due-date");
    history.rows.forEach((bank, i) => {
      const fee = anomaly(bank)?.amountMinor ?? 0;
      expect(rows[i].feesMinor).toBe(fee);
      // The documented ±0.01 rounding residual; never more.
      expect(Math.abs(rows[i].interestMinor + fee - bank.interestMinor)).toBeLessThanOrEqual(RESIDUAL);
      expect(Math.abs(rows[i].principalMinor - bank.principalMinor)).toBeLessThanOrEqual(RESIDUAL);
    });
    expect(rows.filter((r, i) => r.interestMinor === history.rows[i].interestMinor).length).toBeGreaterThanOrEqual(15);
  });

  it("tracks the lender's balance on every row and lands on it exactly", () => {
    const { rows } = allocate("accrued-to-due-date");
    history.rows.forEach((bank, i) => {
      expect(Math.abs(rows[i].balanceAfterMinor - bank.balanceMinor)).toBeLessThanOrEqual(2 * RESIDUAL);
    });
    expect(rows.at(-1)!.balanceAfterMinor).toBe(history.rows.at(-1)!.balanceMinor);
  });

  it("flags the known AED 100 row as an unexplained difference instead of fitting it", () => {
    const { rows } = allocate("accrued-to-due-date", false);
    const comparison = compareLenderStatement(rows, history.rows.map((r) => ({ paidDate: r.paidDate, principalMinor: r.principalMinor, interestMinor: r.interestMinor })), RESIDUAL);
    const flagged = comparison.filter((c) => c.status === "unexplained-difference");
    expect(flagged).toHaveLength(1);
    expect(flagged[0].paidDate).toBe("2026-09-25");
    expect(Math.abs(flagged[0].interestDifferenceMinor - 10_000)).toBeLessThanOrEqual(RESIDUAL);
    // The calculation itself is the same with or without the flag: the charge never moves into interest.
    const withFee = allocate("accrued-to-due-date").rows;
    expect(withFee.at(-1)!.interestMinor).toBe(rows.at(-1)!.interestMinor);
    expect(withFee.at(-1)!.principalMinor).toBe(rows.at(-1)!.principalMinor - 10_000);
  });

  it("keeps the economics: cumulative lender interest is accrual to the due date plus the pending early-payment credit", () => {
    const { rows } = allocate("accrued-to-due-date");
    let economic = 0;
    let reported = 0;
    let flagged = 0;
    let previous = history.openingDate;
    history.rows.forEach((bank, i) => {
      economic += oracleInterest(rows[i].balanceBeforeMinor, days(previous, bank.paidDate));
      reported += bank.interestMinor;
      flagged += anomaly(bank)?.amountMinor ?? 0;
      // Accrual to the due date with this repayment on its actual date (the economic view).
      const toDue = economic + oracleInterest(rows[i].balanceAfterMinor, days(bank.paidDate, bank.adjustedDueDate));
      // The lender credits the early-payment benefit one repayment later.
      const pendingCredit = oracleInterest(rows[i].principalMinor, days(bank.paidDate, bank.adjustedDueDate));
      expect(Math.abs(pendingCredit - bank.pendingEarlyCreditMinor)).toBeLessThanOrEqual(RESIDUAL);
      expect(Math.abs(reported - flagged - toDue - pendingCredit)).toBeLessThanOrEqual(2 * RESIDUAL);
      previous = bank.paidDate;
    });
  });

  it("splits by actual payment dates under the default allocation, so early payments carry less interest", () => {
    const asCalculated = allocate("as-calculated").rows;
    const catchUp = allocate("accrued-to-due-date").rows;
    // The first repayment, 6 days early, carries 31 days of interest instead of 37.
    expect(asCalculated[0].interestMinor).toBe(Math.round(oracleInterest(history.principalMinor, 31)));
    expect(asCalculated[0].interestMinor).toBeLessThan(catchUp[0].interestMinor);
    asCalculated.forEach((row, i) => {
      expect(Math.abs(row.interestMinor - Math.round(oracleInterest(row.balanceBeforeMinor, days(i === 0 ? history.openingDate : history.rows[i - 1].paidDate, history.rows[i].paidDate))))).toBeLessThanOrEqual(RESIDUAL);
    });
    // The default does not match this lender's statements: its split books more principal, so the
    // reconstructed balance runs below the lender's. That is what the statement allocation option is for.
    expect(asCalculated[0].balanceAfterMinor).toBeLessThan(history.rows[0].balanceMinor);
    expect(catchUp[0].balanceAfterMinor).toBe(history.rows[0].balanceMinor);
  });
});
