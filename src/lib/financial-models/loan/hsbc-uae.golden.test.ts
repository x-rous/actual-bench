import { toDayNumber } from "../calendar/dates";
import { simulateDaily, simulateDailyV2 } from "./daily-engine";
import type { LoanModelSnapshot, ModelEvent } from "./model";
import published from "./__goldens__/hsbc-uae-ijara/published.json";

type OracleRow = {
  date: string;
  days: number;
  principalMinor: number;
  profitMinor: number;
  paymentMinor: number;
  balanceMinor: number;
};

const MODEL: LoanModelSnapshot = {
  debtId: "hsbc-uae-ijara",
  revision: 1,
  currency: { code: "AED", minorDigits: 2 },
  behaviorClass: "term-loan",
  lenderPattern: "embedded-interest",
  terms: {
    openingDate: published.openingDate,
    openingPrincipalMinor: published.principalMinor,
    maturityDate: published.maturityDate,
    contractualTermMonths: 300,
    amortizationTermMonths: 300,
    contractualPaymentMinor: null,
    creditLimitMinor: null,
    firstPaymentDate: published.firstPaymentDate,
    firstInterestChargeDate: null,
  },
  profile: {
    amortization: "level-payment",
    rateQuote: "nominal-simple-periodic",
    dayCount: "actual-360",
    accrual: "daily-simple",
    chargeFrequency: "at-repayment",
    chargeDay: null,
    capitalization: "at-charge",
    repaymentFrequency: "monthly",
    repaymentDerivation: "dated-cashflow-annuity",
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
  rates: [{ accrualEffectiveFrom: published.openingDate, annualRateDecimal: published.annualRateDecimal }],
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

/** Independent integer-rational oracle: it imports no engine money, accrual, schedule or repayment code. */
function oracleRows(): OracleRow[] {
  const rows: OracleRow[] = [];
  let balance = BigInt(published.principalMinor);
  let previous = published.openingDate;
  const rateNumerator = BigInt(449);
  const rateDenominator = BigInt(10_000 * 360);
  for (let i = 0; i < published.paymentCount; i++) {
    const date = addMonths(published.firstPaymentDate, i);
    const days = toDayNumber(date) - toDayNumber(previous);
    const profit = halfUp(balance * rateNumerator * BigInt(days), rateDenominator);
    const owed = balance + profit;
    const regular = BigInt(published.regularPaymentMinor);
    const payment = i === published.paymentCount - 1 || regular > owed ? owed : regular;
    const principal = payment - profit;
    balance -= principal;
    rows.push({
      date,
      days,
      principalMinor: Number(principal),
      profitMinor: Number(profit),
      paymentMinor: Number(payment),
      balanceMinor: Number(balance),
    });
    previous = date;
  }
  return rows;
}

function engineRow(event: ModelEvent): Omit<OracleRow, "days"> {
  const profitMinor = event.interestMinor;
  const paymentMinor = -event.cashMovementMinor;
  return {
    date: event.date,
    principalMinor: paymentMinor - profitMinor,
    profitMinor,
    paymentMinor,
    balanceMinor: event.balanceAfterMinor,
  };
}

function oracleEngineRow(row: OracleRow): Omit<OracleRow, "days"> {
  return {
    date: row.date,
    principalMinor: row.principalMinor,
    profitMinor: row.profitMinor,
    paymentMinor: row.paymentMinor,
    balanceMinor: row.balanceMinor,
  };
}

describe("HSBC UAE Actual/360 Ijara golden fixture", () => {
  const result = simulateDaily({
    model: MODEL,
    anchor: { date: published.openingDate, principalMinor: published.principalMinor, accruedInterestMinor: 0, source: "bank-opening" },
    events: [],
    to: published.maturityDate,
  });
  if (!result.ok) throw new Error(result.blocked.map((b) => b.message).join("; "));
  const payments = result.events.filter((e) => e.type === "repayment" || e.type === "final-payment");
  const oracle = oracleRows();

  it("uses 24 included accrual days, while start-of-day placement uses 23", () => {
    expect(oracle[0].days).toBe(24);
    expect(payments[0].interestMinor).toBe(449000);
    const before = simulateDaily({
      model: { ...MODEL, profile: { ...MODEL.profile, eventOrder: { timing: "start-of-day" } } },
      anchor: { date: published.openingDate, principalMinor: published.principalMinor, accruedInterestMinor: 0, source: "comparison" },
      events: [],
      to: published.firstPaymentDate,
    });
    expect(before.ok && before.events.find((e) => e.type === "repayment")?.interestMinor).toBe(430292);
  });

  it("derives the bank's regular payment without a contractual payment override", () => {
    expect(MODEL.terms.contractualPaymentMinor).toBeNull();
    expect(result.closing.scheduledPaymentMinor).toBe(published.regularPaymentMinor);
    expect(result.versions).toMatchObject({ engine: "loan-daily@8", repayment: "repayment@2", recast: "recast@2" });
  });

  it("leaves the conventional payment-frequency PMT behavior unchanged", () => {
    const model = { ...MODEL, profile: { ...MODEL.profile, repaymentDerivation: "annuity-at-payment-frequency" as const } };
    const request = {
      model,
      anchor: { date: published.openingDate, principalMinor: published.principalMinor, accruedInterestMinor: 0, source: "comparison" },
      events: [],
      to: published.firstPaymentDate,
    };
    const conventional = simulateDaily(request);
    expect(conventional.ok && conventional.closing.scheduledPaymentMinor).toBe(832898);
    expect(conventional.ok && conventional.events.find((e) => e.type === "repayment")?.interestMinor).toBe(449000);
    const historical = simulateDailyV2(request);
    expect(historical.ok).toBe(true);
    if (!conventional.ok || !historical.ok) return;
    const financialEvents = (events: typeof conventional.events) => events.map((event) => {
      const diagnostics = { ...event.diagnostics };
      delete diagnostics.eventOrder;
      return { ...event, diagnostics };
    });
    expect({ events: financialEvents(conventional.events), periods: conventional.periods, closing: conventional.closing })
      .toEqual({ events: financialEvents(historical.events), periods: historical.periods, closing: historical.closing });
    expect(historical.versions).toMatchObject({ engine: "loan-daily@2", repayment: "repayment@1", recast: "recast@1" });
  });

  it("matches every one of the 300 independently calculated rows", () => {
    expect(payments).toHaveLength(300);
    expect(payments.map(engineRow)).toEqual(oracle.map(oracleEngineRow));
  });

  it("matches the five bank-published rows exactly", () => {
    expect(payments.slice(0, 5).map(engineRow)).toEqual(published.rows);
  });

  it("matches bank totals, final payment, maturity and zero final balance", () => {
    expect(payments.at(-1)).toMatchObject({ date: published.maturityDate, cashMovementMinor: -published.finalPaymentMinor, balanceAfterMinor: 0 });
    expect(payments.reduce((sum, row) => sum + row.interestMinor, 0)).toBe(published.totalProfitMinor);
    expect(payments.reduce((sum, row) => sum - row.cashMovementMinor, 0)).toBe(published.totalRepaymentsMinor);
    expect(result.closing).toMatchObject({ date: published.maturityDate, principalMinor: 0, accruedInterestMinor: 0, paidOff: true });
  });

  it("keeps round-each-posting distinct from carry-full-precision", () => {
    const carried = simulateDaily({
      model: { ...MODEL, profile: { ...MODEL.profile, rounding: { ...MODEL.profile.rounding, balancePrecision: "carry-full-precision" } } },
      anchor: { date: published.openingDate, principalMinor: published.principalMinor, accruedInterestMinor: 0, source: "precision-comparison" },
      events: [],
      to: published.maturityDate,
    });
    if (!carried.ok) throw new Error(carried.blocked[0].message);
    const carriedPayments = carried.events.filter((e) => e.type === "repayment" || e.type === "final-payment");
    expect(-carriedPayments.at(-1)!.cashMovementMinor).toBe(837650);
    expect(carriedPayments.reduce((sum, row) => sum + row.interestMinor, 0)).toBe(101367059);
    expect(carriedPayments.at(-1)!.diagnostics.settledCarriedRemainder).toEqual(expect.any(String));
    expect(carried.closing.carriedRemainder).toBe("0");
    expect(carriedPayments.map(engineRow)).not.toEqual(oracle.map(oracleEngineRow));
  });

  it("re-solves over the remaining dated schedule at a qualifying recast", () => {
    const recastModel: LoanModelSnapshot = {
      ...MODEL,
      profile: { ...MODEL.profile, recast: "on-contract-date" },
      paymentRecasts: [{ date: "2027-07-27" }],
      assumptions: [{ kind: "extra-repayment", date: "2027-06-15", amountMinor: 10_000_000 }],
    };
    const recast = simulateDaily({
      model: recastModel,
      anchor: { date: published.openingDate, principalMinor: published.principalMinor, accruedInterestMinor: 0, source: "recast-test" },
      events: [],
      to: published.maturityDate,
    });
    if (!recast.ok) throw new Error(recast.blocked[0].message);
    const event = recast.events.find((e) => e.type === "recast");
    expect(event).toMatchObject({ date: "2027-07-27", diagnostics: { reason: "contract-date", previousPaymentMinor: published.regularPaymentMinor } });
    expect(event!.diagnostics.recalculatedPaymentMinor).toEqual(expect.any(Number));
    expect(event!.diagnostics.recalculatedPaymentMinor as number).toBeLessThan(published.regularPaymentMinor);
    const final = recast.events.filter((e) => e.type === "final-payment").at(-1)!;
    expect(final.date).toBe(published.maturityDate);
    expect(-final.cashMovementMinor).toBeLessThan(event!.diagnostics.recalculatedPaymentMinor as number * 2);
    expect(recast.closing).toMatchObject({ principalMinor: 0, paidOff: true });
  });

  it("keeps independently derived later checkpoints labelled as derived", () => {
    const derived = [60, 120, 180, 240, 299, 300].map((number) => ({ number, ...oracle[number - 1] }));
    expect(derived).toEqual([
      { number: 60, date: "2031-06-27", days: 31, principalMinor: 327011, profitMinor: 510880, paymentMinor: 837891, balanceMinor: 131806661 },
      { number: 120, date: "2036-06-27", days: 31, principalMinor: 414366, profitMinor: 423525, paymentMinor: 837891, balanceMinor: 109125843 },
      { number: 180, date: "2041-06-27", days: 31, principalMinor: 524086, profitMinor: 313805, paymentMinor: 837891, balanceMinor: 80638174 },
      { number: 240, date: "2046-06-27", days: 31, principalMinor: 661804, profitMinor: 176087, paymentMinor: 837891, balanceMinor: 44881221 },
      { number: 299, date: "2051-05-27", days: 30, principalMinor: 831657, profitMinor: 6234, paymentMinor: 837891, balanceMinor: 834437 },
      { number: 300, date: "2051-06-27", days: 31, principalMinor: 834437, profitMinor: 3226, paymentMinor: 837663, balanceMinor: 0 },
    ]);
  });
});
