import { toDayNumber } from "../calendar/dates";
import { simulateDaily, simulateDailyAtVersion } from "./daily-engine";
import type { LoanModelSnapshot, ModelEvent } from "./model";
import published from "./__goldens__/hsbc-aed-350k/published.json";

type Row = {
  date: string;
  paymentMinor: number;
  principalMinor: number;
  interestMinor: number;
  balanceMinor: number;
};

const MODEL: LoanModelSnapshot = {
  debtId: "hsbc-aed-350k",
  revision: 1,
  currency: { code: published.currency, minorDigits: published.minorDigits },
  behaviorClass: "term-loan",
  lenderPattern: "embedded-interest",
  terms: {
    openingDate: published.openingDate,
    openingPrincipalMinor: published.principalMinor,
    maturityDate: published.maturityDate,
    contractualTermMonths: published.paymentCount,
    amortizationTermMonths: published.paymentCount,
    contractualPaymentMinor: published.contractualPaymentMinor,
    creditLimitMinor: null,
    firstPaymentDate: published.firstPaymentDate,
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
  rates: [{ accrualEffectiveFrom: published.openingDate, annualRateDecimal: published.inferredCalculationRateDecimal }],
  phases: [],
  offsets: [],
  components: [],
  paymentRecasts: [],
  assumptions: [],
  revolving: null,
};

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const index = year * 12 + month - 1 + months;
  const y = Math.floor(index / 12);
  const m = index % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

/** Independent integer-rational oracle; no engine money/accrual/schedule code is imported. */
function oracleRows(rateDecimal: string): Row[] {
  const digits = rateDecimal.replace(/^0\./, "");
  const rateNumerator = BigInt(digits);
  const rateDenominator = BigInt(10) ** BigInt(digits.length);
  let balance = BigInt(published.principalMinor);
  let previous = published.openingDate;
  const rows: Row[] = [];
  for (let i = 0; i < published.paymentCount; i++) {
    const date = addMonths(published.firstPaymentDate, i);
    const days = BigInt(toDayNumber(date) - toDayNumber(previous));
    const interest = halfUp(balance * rateNumerator * days, rateDenominator * BigInt(365));
    const owed = balance + interest;
    const regular = BigInt(published.contractualPaymentMinor);
    const payment = i === published.paymentCount - 1 || regular > owed ? owed : regular;
    const principal = payment - interest;
    balance -= principal;
    rows.push({ date, paymentMinor: Number(payment), principalMinor: Number(principal), interestMinor: Number(interest), balanceMinor: Number(balance) });
    previous = date;
  }
  return rows;
}

function engineRow(event: ModelEvent): Row {
  const paymentMinor = -event.cashMovementMinor;
  return {
    date: event.date,
    paymentMinor,
    principalMinor: paymentMinor - event.interestMinor,
    interestMinor: event.interestMinor,
    balanceMinor: event.balanceAfterMinor,
  };
}

function run(model = MODEL, historical = false) {
  const request = {
    model,
    anchor: { date: published.openingDate, principalMinor: published.principalMinor, accruedInterestMinor: 0, source: "bank-opening" },
    events: [],
    to: published.maturityDate,
  };
  const result = historical ? simulateDailyAtVersion("loan-daily@3", request) : simulateDaily(request);
  if (!result.ok) throw new Error(result.blocked.map((b) => b.message).join("; "));
  return { result, payments: result.events.filter((e) => e.type === "repayment" || e.type === "final-payment") };
}

describe("HSBC AED 350,000 irregular-first-period fixture", () => {
  it("reproduces the five bank-published rows with the labelled inferred calculation rate", () => {
    const { payments } = run();
    expect(payments.slice(0, 5).map(engineRow)).toEqual(published.rows);
    expect(oracleRows(published.inferredCalculationRateDecimal).slice(0, 5)).toEqual(published.rows);
  });

  it("documents that exact published 6.99% is one cent lower in the first row", () => {
    const exact = oracleRows(published.publishedAnnualRateDecimal);
    expect(exact[0]).toMatchObject({ interestMinor: 248001, principalMinor: 589956, balanceMinor: 34410044 });
    expect(exact[0].interestMinor).toBe(published.rows[0].interestMinor - 1);
  });

  it("still gives exact 6.99% all 48 dates instead of hiding the missing period in a large true-up", () => {
    const exactModel: LoanModelSnapshot = {
      ...MODEL,
      terms: { ...MODEL.terms, maturityDate: null },
      rates: [{ accrualEffectiveFrom: published.openingDate, annualRateDecimal: published.publishedAnnualRateDecimal }],
    };
    const { payments } = run(exactModel);
    expect(payments).toHaveLength(48);
    expect(payments.at(-1)).toMatchObject({ date: "2027-11-01", cashMovementMinor: -902252, balanceAfterMinor: 0 });
    expect(payments.reduce((sum, row) => sum - row.cashMovementMinor, 0)).toBe(40286231);
  });

  it("uses 37 accrued days without changing the day count or same-day order", () => {
    expect(toDayNumber(published.firstPaymentDate) - toDayNumber(published.openingDate)).toBe(37);
    const { payments } = run();
    expect(payments[0].diagnostics.sameDayStep).toBe("scheduled-repayment");
    expect(payments[0].interestMinor).toBe(248002);
  });

  it("produces all 48 contractual dates through 01-Nov-2027 and only a modest final true-up", () => {
    const noExplicitMaturity: LoanModelSnapshot = { ...MODEL, terms: { ...MODEL.terms, maturityDate: null } };
    const { result, payments } = run(noExplicitMaturity);
    expect(payments).toHaveLength(published.paymentCount);
    expect(payments.at(-1)).toMatchObject({ date: published.maturityDate, cashMovementMinor: -published.derivedUnadjusted.finalPaymentMinor, balanceAfterMinor: 0 });
    expect(payments.reduce((sum, row) => sum + row.interestMinor, 0)).toBe(published.derivedUnadjusted.totalInterestMinor);
    expect(payments.reduce((sum, row) => sum - row.cashMovementMinor, 0)).toBe(published.derivedUnadjusted.totalRepaymentsMinor);
    expect(result.closing).toMatchObject({ principalMinor: 0, paidOff: true });
    expect(result.versions.engine).toBe("loan-daily@7");
  });

  it("keeps the full unadjusted schedule tied to an independent oracle", () => {
    const { payments } = run();
    expect(payments.map(engineRow)).toEqual(oracleRows(published.inferredCalculationRateDecimal));
    for (const checkpoint of published.derivedUnadjusted.checkpoints) {
      expect(engineRow(payments[checkpoint.installment - 1])).toEqual({
        date: checkpoint.date,
        paymentMinor: checkpoint.paymentMinor,
        principalMinor: checkpoint.principalMinor,
        interestMinor: checkpoint.interestMinor,
        balanceMinor: checkpoint.balanceMinor,
      });
    }
  });

  it("retains the published 02-Sep-2024 evidence without inventing a business-day rule", () => {
    expect(published.observedDateExceptions).toEqual([
      { nominalDate: "2024-09-01", publishedDate: "2024-09-02", classification: "bank-published date; adjustment rule unknown" },
    ]);
    const { payments } = run();
    expect(payments.some((p) => p.date === "2024-09-01")).toBe(true);
    expect(payments.some((p) => p.date === "2024-09-02")).toBe(false);
  });

  it("keeps loan-daily@3 callable with its former opening-date cutoff", () => {
    const noExplicitMaturity: LoanModelSnapshot = { ...MODEL, terms: { ...MODEL.terms, maturityDate: null } };
    const { result, payments } = run(noExplicitMaturity, true);
    expect(payments).toHaveLength(47);
    expect(payments.at(-1)?.date).toBe("2027-10-01");
    expect(result.versions.engine).toBe("loan-daily@3");
  });
});
