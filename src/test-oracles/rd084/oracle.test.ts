import { dayCount, levelPayment, periodicRate, periodInterest, simulateDailyLoan, yearFraction, type OracleConvention } from "./conventions";
import { allFixtures } from "./fixtureFiles";
import { qdiv, qmul, qToFixed, roundHalfAwayScaled, qs } from "./rational";

/*
 * Two jobs. First, the oracle must reproduce published figures on its own,
 * which is what earns its synthetic rows any trust. Second, every fixture's
 * expected.csv must be exactly what the oracle computes, so no expected value
 * can be hand-edited or produced by the engine without this failing.
 */

const cents = (convention: OracleConvention, p: string, r: string, a: string, b: string) =>
  Number(roundHalfAwayScaled(periodInterest(convention, p, r, a, b), 2));

describe("oracle reproduces published figures", () => {
  it("ISDA 1998 memo, Actual/Actual ISDA method (£10,000 at 10%)", () => {
    const isda = (a: string, b: string) => cents("actual-actual-calendar", "10000", "0.10", a, b);
    expect(isda("2003-11-01", "2004-05-01")).toBe(49772); // p.3: 61/365 + 121/366 = £497.72
    expect(isda("1999-02-01", "1999-07-01")).toBe(41096); // p.5: £410.96
    expect(isda("1999-07-01", "2000-07-01")).toBe(100138); // p.5: £1,001.38
    expect(isda("2002-08-15", "2003-07-15")).toBe(91507); // p.6: £915.07
    expect(isda("1999-07-30", "2000-01-30")).toBe(50389); // p.7: £503.89
    expect(isda("2000-01-30", "2000-06-30")).toBe(41530); // p.8: £415.30
    expect(isda("1999-11-30", "2000-04-30")).toBe(41554); // p.9: £415.54
  });

  it("finds the memo's printed ISDA figure for Jul 2003 - Jan 2004 inconsistent with its own rule", () => {
    // Printed as 184/365 = £504.11; the period holds 14 days of leap-year 2004.
    expect(cents("actual-actual-calendar", "10000", "0.10", "2003-07-15", "2004-01-15")).toBe(50400);
    expect(cents("actual-365-fixed", "10000", "0.10", "2003-07-15", "2004-01-15")).toBe(50411);
  });

  it("Unloan (CBA): ($600,000 x 0.045) / 365 = $73.97 a day", () => {
    expect(cents("actual-365-fixed", "600000", "0.045", "2024-07-01", "2024-07-02")).toBe(7397);
  });

  it("ISDA 1998 memo: 10% Actual/360 is 10.139% Actual/365 (Fixed)", () => {
    const ratio = qdiv(yearFraction("actual-360", "2023-01-01", "2024-01-01"), yearFraction("actual-365-fixed", "2023-01-01", "2024-01-01"));
    expect(qToFixed(qmul(qs("10"), ratio), 3)).toBe("10.139");
  });

  it("York University guide: 6% j2 → 0.493862% a month, PV factor 156.297225, payment $639.81", () => {
    const r = periodicRate("0.06", 2, 12, 40);
    expect(qToFixed(qmul(r, qs("100")), 6)).toBe("0.493862");
    const { pvFactor, payment } = levelPayment("100000", r, 300);
    expect(qToFixed(pvFactor, 6)).toBe("156.297225");
    expect(qToFixed(payment, 2)).toBe("639.81");
  });
});

describe("every fixture's expected values are the oracle's", () => {
  const fixtures = allFixtures();

  it("finds fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtures.map((f) => [`${f.family}/${f.name}`, f] as const))("%s", (_id, fixture) => {
    const input = fixture.input as Record<string, unknown> & { kind: string };
    if (input.kind === "period-interest") {
      const { convention, principal, annualRate } = input as unknown as { convention: OracleConvention; principal: string; annualRate: string };
      expect(input.rounding).toBe("half-up");
      const computed = fixture.expected.map((row) => ({
        start: row.start,
        end: row.end,
        days: String(dayCount(row.start, row.end)),
        interest_minor: String(cents(convention, principal, annualRate, row.start, row.end)),
      }));
      expect(computed).toEqual(fixture.expected);
    } else if (input.kind === "daily-loan") {
      const rows = simulateDailyLoan(input as never, fixture.events.map((e) => ({ date: e.date, amountMinor: Number(e.amount_minor) })));
      expect(
        rows.map((r) => ({ date: r.date, event: r.event, amount_minor: String(r.amountMinor), balance_after_minor: String(r.balanceAfterMinor) }))
      ).toEqual(fixture.expected);
    } else if (input.kind === "level-payment") {
      const { annualRate, paymentsPerYear, principal, payments, rateQuote } = input as unknown as {
        annualRate: string; paymentsPerYear: number; principal: string; payments: number; rateQuote: string;
      };
      expect(rateQuote).toBe("nominal-compounded-semiannual");
      const r = periodicRate(annualRate, 2, paymentsPerYear, 40);
      const { pvFactor, payment } = levelPayment(principal, r, payments);
      expect([
        { periodic_rate_pct_6dp: qToFixed(qmul(r, qs("100")), 6), pv_factor_6dp: qToFixed(pvFactor, 6), payment_minor: String(roundHalfAwayScaled(payment, 2)) },
      ]).toEqual(fixture.expected);
    } else {
      throw new Error(`oracle has no reading of fixture kind ${input.kind}`);
    }
  });
});
