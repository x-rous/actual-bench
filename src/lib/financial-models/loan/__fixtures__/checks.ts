import { addMonths, daysBetween } from "../../calendar/dates";
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
