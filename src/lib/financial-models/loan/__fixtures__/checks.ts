import { addMonths, daysBetween } from "../../calendar/dates";
import { simulateDaily } from "../daily-engine";
import type { LedgerEvent, LoanModelSnapshot } from "../model";
import type { CalculationProfile } from "../profile";
import { add, dec, decInt, div, mul, round, sub, toDecString, toMinor, WORKING_SCALE, type Dec } from "../../money/kernel";
import type { RoundingMode } from "../../money/rounding";
import { yearFractionExact, periodInterest, type DayCountConvention } from "../daycount/types";
import { periodicRate } from "../rates";
import { levelPayment } from "../repayment";
import { compareRows, type CsvRow, type Fixture, type RowMismatch } from "./harness";

/*
 * Test support: runs a fixture through the engine's P1.1 primitives and
 * returns row mismatches. Used by the day-count fixture test and by the
 * registry test that decides which conventions may be selectable. Never
 * imported by production code.
 */

type PeriodInterestInput = {
  kind: "period-interest";
  currency: { minorDigits: number };
  principal: string;
  annualRate: string;
  rounding: RoundingMode;
};

type Actual360AggregateInput = {
  kind: "actual360-aggregate-amortization";
  currency: { minorDigits: number };
  principal: string;
  annualRate: string;
  paymentsPerYear: number;
  amortizationPayments: number;
  termPayments: number;
  firstPaymentDate: string;
};

/** Fixture kinds this module can check for a day-count convention. */
export const ENGINE_CHECKED_KINDS = ["period-interest", "actual360-aggregate-amortization"] as const;

export function checkFixture(fixture: Fixture, convention: DayCountConvention): RowMismatch[] {
  const kind = (fixture.input as { kind: string }).kind;
  if (kind === "period-interest") return compareRows(fixture.expected, periodInterestRows(fixture.input as PeriodInterestInput, fixture.expected, convention));
  if (kind === "actual360-aggregate-amortization") return compareRows(fixture.expected, aggregateRows(fixture.input as Actual360AggregateInput, convention));
  throw new Error(`${fixture.family}/${fixture.name}: no engine check for fixture kind ${kind}`);
}

function periodInterestRows(input: PeriodInterestInput, expected: CsvRow[], convention: DayCountConvention): CsvRow[] {
  const digits = input.currency.minorDigits;
  return expected.map((row) => ({
    start: row.start,
    end: row.end,
    days: String(daysBetween(row.start, row.end)),
    interest_minor: String(
      toMinor(periodInterest(dec(input.principal), dec(input.annualRate), convention, row.start, row.end, digits, input.rounding), digits, "down")
    ),
  }));
}

/**
 * The Fannie Mae §1103 calculation from P1.1 primitives: a level payment at
 * the nominal monthly rate, each period's interest as balance × rate × the
 * convention's fraction for the month before the payment, carried at the
 * working scale with nothing rounded until the total. A test-level loop, not
 * an engine.
 */
function aggregateRows(input: Actual360AggregateInput, convention: DayCountConvention): CsvRow[] {
  const P = dec(input.principal);
  const rate = dec(input.annualRate);
  const payment = levelPayment(P, periodicRate("nominal-simple-periodic", rate, input.paymentsPerYear), input.amortizationPayments);
  let balance: Dec = P;
  let aggregate: Dec = dec("0");
  for (let k = 0; k < input.termPayments; k++) {
    const due = addMonths(input.firstPaymentDate, k);
    const periodStart = addMonths(due, -1);
    const { numerator, denominator } = yearFractionExact(convention, periodStart, due);
    const interest = div(mul(mul(balance, rate), { int: numerator, scale: 0 }), { int: denominator, scale: 0 }, WORKING_SCALE, "half-even");
    const principal = sub(payment, interest);
    aggregate = add(aggregate, principal);
    balance = sub(balance, principal);
  }
  const digits = input.currency.minorDigits;
  const constantPct = round(div(mul(payment, decInt(1200)), P, WORKING_SCALE, "half-even"), 7, "half-up");
  const aggregateMinor = toMinor(aggregate, digits, "half-up");
  return [
    {
      debt_service_constant_pct_7dp: toDecString(constantPct),
      monthly_pi_minor: String(toMinor(div(mul(P, constantPct), decInt(1200), WORKING_SCALE, "half-even"), digits, "half-up")),
      aggregate_principal_minor: String(aggregateMinor),
      fixed_monthly_principal_minor: String(toMinor(div(decInt(aggregateMinor), decInt(100 * input.termPayments), WORKING_SCALE, "half-even"), digits, "half-up")),
      balance_after_term_minor: String(toMinor(P, digits, "half-up") - aggregateMinor),
    },
  ];
}

// ─── daily-loan fixtures through bench-daily ──────────────────────────────────

type DailyLoanFixtureInput = {
  kind: "daily-loan";
  convention: DayCountConvention["id"];
  currency: { code: string; minorDigits: number };
  anchorDate: string;
  openingPrincipal: string;
  annualRate: string;
  dailyInterestScale: number;
  dailyInterestRounding: RoundingMode;
  postingRounding: RoundingMode;
  chargeDates: string[];
  eventOrder: { scheduledRepayments: "before-accrual" | "after-accrual"; otherPayments: "before-accrual" | "after-accrual"; offsets: "before-accrual" | "after-accrual" };
  until: string;
};

/**
 * A daily-loan fixture as a model: monthly charges on the fixture's dates,
 * scheduled repayments at the fixture's cadence and amount, other events as
 * observed ledger events. Returns rows in the fixture's CSV shape.
 */
export function runDailyLoanFixture(fixture: Fixture): CsvRow[] | string {
  const input = fixture.input as DailyLoanFixtureInput;
  const scheduled = fixture.events.filter((e) => e.kind === "repayment");
  const gaps = scheduled.slice(1).map((e, i) => daysBetween(scheduled[i].date, e.date));
  const frequency = gaps.every((g) => g === 14) ? "fortnightly" : gaps.every((g) => g === 7) ? "weekly" : null;
  if (!frequency) return "fixture repayments are not a regular weekly or fortnightly series";
  const amount = Math.abs(Number(scheduled[0].amount_minor));
  const model = baseDailyModel({
    anchorDate: input.anchorDate,
    principalMinor: toMinor(dec(input.openingPrincipal), input.currency.minorDigits, "down"),
    annualRate: input.annualRate,
    currency: input.currency,
    convention: input.convention,
    firstChargeDate: input.chargeDates[0],
    chargeDay: Number(input.anchorDate.slice(8, 10)),
    firstPaymentDate: scheduled[0].date,
    repaymentFrequency: frequency,
    paymentMinor: amount,
    intermediatePlaces: input.dailyInterestScale,
    intermediateRounding: input.dailyInterestRounding,
    postingRounding: input.postingRounding,
    eventOrder: input.eventOrder,
  });
  const ledger: LedgerEvent[] = fixture.events
    .filter((e) => e.kind !== "repayment")
    .map((e, i) => ({ kind: e.kind as "extra-repayment", date: e.date, amountMinor: Math.abs(Number(e.amount_minor)), ref: { source: "actual", id: `fixture-${i}` } }));
  const result = simulateDaily({ model, anchor: { date: input.anchorDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "fixture" }, events: ledger, to: input.until });
  if (!result.ok) return result.blocked.map((b) => b.message).join("; ");
  return result.events
    .filter((e) => e.type === "repayment" || e.type === "extra-repayment" || e.type === "interest-charge")
    .map((e) => ({
      date: e.date,
      event: e.type,
      amount_minor: String(e.type === "interest-charge" ? e.interestMinor : e.cashMovementMinor),
      balance_after_minor: String(e.balanceAfterMinor),
    }));
}

export type BaseDailyModelInput = {
  anchorDate: string;
  principalMinor: number;
  annualRate: string;
  currency: { code: string; minorDigits: number };
  convention: DayCountConvention["id"];
  firstChargeDate: string;
  chargeDay: number | null;
  firstPaymentDate: string;
  repaymentFrequency: "weekly" | "fortnightly" | "monthly";
  paymentMinor: number | null;
  intermediatePlaces: number | null;
  intermediateRounding: RoundingMode;
  postingRounding: RoundingMode;
  eventOrder: CalculationProfile["eventOrder"];
};

/** A daily-simple, monthly-charge model with a contractual fixed payment: the shape the AU fixtures use. */
export function baseDailyModel(input: BaseDailyModelInput): LoanModelSnapshot {
  return {
    debtId: "fixture",
    revision: 1,
    currency: input.currency,
    behaviorClass: "term-loan",
    lenderPattern: "separate-interest",
    terms: {
      openingDate: input.anchorDate,
      openingPrincipalMinor: input.principalMinor,
      maturityDate: addMonths(input.anchorDate, 360),
      contractualTermMonths: 360,
      amortizationTermMonths: 360,
      contractualPaymentMinor: input.paymentMinor,
      creditLimitMinor: null,
      firstPaymentDate: input.firstPaymentDate,
      firstInterestChargeDate: input.firstChargeDate,
    },
    profile: {
      amortization: "level-payment",
      rateQuote: "nominal-simple-periodic",
      dayCount: input.convention,
      accrual: "daily-simple",
      chargeFrequency: "monthly",
      chargeDay: input.chargeDay,
      capitalization: "at-charge",
      repaymentFrequency: input.repaymentFrequency,
      repaymentDerivation: "contractual-fixed",
      recast: "never",
      rateEffectiveTiming: "on-accrual-effective-date",
      repaymentEffectiveTiming: "transaction-date",
      rounding: {
        paymentRounding: "half-up",
        interestPostingRounding: input.postingRounding,
        intermediateScale: input.intermediatePlaces === null ? { mode: "full" } : { mode: "fixed", places: input.intermediatePlaces },
        intermediateRounding: input.intermediateRounding,
        balancePrecision: "round-each-posting",
      },
      eventOrder: input.eventOrder,
      finalPayment: "true-up-to-zero",
      shortMonth: "clamp-to-last-calendar-day",
      negativeAmortizationAllowed: false,
      feeCapitalization: "not-permitted",
      presetId: null,
    },
    rates: [{ accrualEffectiveFrom: input.anchorDate, annualRateDecimal: input.annualRate }],
    phases: [],
    offsets: [],
    components: [],
    assumptions: [],
    revolving: null,
  };
}
