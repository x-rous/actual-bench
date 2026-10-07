import { levelPayment } from "./conventions";
import { q, qadd, qdiv, qmul, qs, qsub, qToFixed, roundHalfAwayScaled, type Q } from "./rational";

/*
 * Keeps loan/__fixtures__/CANDIDATES.md honest. These are candidate sources
 * for the P1.2 engines (payment caps, fees, ARM recasts), checked here against
 * their original publications with a plain payment-numbered schedule (round
 * each row, half-up). They are not golden fixtures yet: P1.2 translates them
 * into dated events. Where a source cannot be reproduced in full, the test
 * pins exactly which published cells disagree, so nobody quietly keeps only
 * the cells that match.
 */

const cents = (x: Q) => q(roundHalfAwayScaled(x, 2), 100);
const money = (x: Q) => qToFixed(x, 2);

describe("ProEducate ARM payment cap (republished consumer page; figures self-consistent)", () => {
  it("reproduces all four published anchors with round-each rows", () => {
    let balance = qs("65000");
    const r1 = qdiv(qs("0.10"), q(12));
    const pay1 = cents(levelPayment("65000", r1, 360).payment);
    for (let m = 0; m < 12; m++) balance = qsub(balance, qsub(pay1, cents(qmul(balance, r1))));
    const r2 = qdiv(qs("0.12"), q(12));
    const uncapped = cents(levelPayment(money(balance), r2, 348).payment);
    const capped = cents(qmul(pay1, qs("1.075")));
    const endYear1 = balance;
    for (let m = 0; m < 12; m++) balance = qsub(balance, qsub(capped, cents(qmul(balance, r2))));
    expect([money(pay1), money(endYear1), money(uncapped), money(capped), money(balance), money(qsub(balance, endYear1))]).toEqual([
      "570.42", "64638.72", "667.30", "613.20", "65059.62", "420.90",
    ]);
  });
});

describe("MoneyVox tableau d'amortissement with assurance (all 48 published cells)", () => {
  it("reproduces interest, principal, total payment and balance for every row", () => {
    const published = [
      ["41.67", "814.40", "858.99", "9185.60"], ["38.27", "817.80", "858.99", "8367.80"], ["34.87", "821.20", "858.99", "7546.60"],
      ["31.44", "824.63", "858.99", "6721.97"], ["28.01", "828.06", "858.99", "5893.91"], ["24.56", "831.51", "858.99", "5062.40"],
      ["21.09", "834.98", "858.99", "4227.42"], ["17.61", "838.46", "858.99", "3388.96"], ["14.12", "841.95", "858.99", "2547.01"],
      ["10.61", "845.46", "858.99", "1701.55"], ["7.09", "848.98", "858.99", "852.57"], ["3.55", "852.57", "859.04", "0.00"],
    ];
    const r = qdiv(qs("0.05"), q(12));
    const pay = cents(levelPayment("10000", r, 12).payment);
    const insurance = cents(qdiv(qmul(qs("10000"), qs("0.0035")), q(12))); // 0.35% a year on the initial capital
    let balance = qs("10000");
    const rows = published.map((_, k) => {
      const interest = cents(qmul(balance, r));
      const principal = k === 11 ? balance : qsub(pay, interest); // final row trues up
      balance = qsub(balance, principal);
      return [money(interest), money(principal), money(qadd(qadd(principal, interest), insurance)), money(balance)];
    });
    expect(rows).toEqual(published);
  });
});

describe("Reg Z Appendix H Sample H-14 (variable-rate illustration)", () => {
  const rates = ["17.41", "15.41", "15.17", "13.17", ...Array(11).fill("12.41")];
  const publishedPayments = ["145.90", "129.81", "127.91", "112.43", ...Array(11).fill("106.73")];
  const publishedBalances = [
    "9989.37", "9969.66", "9945.51", "9903.70", "9848.94", "9786.98", "9716.88", "9637.56",
    "9547.83", "9446.29", "9331.56", "9201.61", "9054.72", "8888.52", "8700.37",
  ];

  function run(recastEveryYear: boolean) {
    let balance = qs("10000");
    let pay: Q | null = null;
    const out: { payment: string; balance: string }[] = [];
    rates.forEach((rate, year) => {
      const r = qdiv(qdiv(qs(rate), q(100)), q(12));
      if (pay === null || recastEveryYear || rate !== rates[year - 1]) pay = cents(levelPayment(money(balance), r, 360 - 12 * year).payment);
      for (let m = 0; m < 12; m++) balance = qsub(balance, qsub(pay, cents(qmul(balance, r))));
      out.push({ payment: money(pay), balance: money(balance) });
    });
    return out;
  }
  const mismatches = (rows: { payment: string; balance: string }[]) =>
    rows.flatMap((row, i) => [
      ...(row.payment === publishedPayments[i] ? [] : [`${1982 + i} payment ${row.payment} vs ${publishedPayments[i]}`]),
      ...(row.balance === publishedBalances[i] ? [] : [`${1982 + i} balance ${row.balance} vs ${publishedBalances[i]}`]),
    ]);

  it("annual recast matches all 15 balances but prints 106.72 where H-14 prints 106.73 in three years", () => {
    expect(mismatches(run(true))).toEqual([
      "1992 payment 106.72 vs 106.73",
      "1994 payment 106.72 vs 106.73",
      "1995 payment 106.72 vs 106.73",
    ]);
  });

  it("recasting only on a rate change matches every payment but drifts the balances from 1992", () => {
    const failing = mismatches(run(false));
    expect(failing.every((m) => m.includes("balance"))).toBe(true);
    expect(failing[0]).toMatch(/^1992 balance/);
  });
});
