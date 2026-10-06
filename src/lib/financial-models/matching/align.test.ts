import history from "../loan/__goldens__/hsbc-aed-350k-history/history.json";
import { alignPayments, type AlignDue, type AlignPayment } from "./align";

/** One pass over the whole loan (owner decision 2026-10-07): no day window, no amount limit. */

const monthly = (from: string, count: number, expectedMinor = 100_000): AlignDue[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    const date = d.toISOString().slice(0, 10);
    return { key: date, date, expectedMinor };
  });
const pay = (id: string, date: string, amountMinor = 100_000): AlignPayment => ({ id, date, amountMinor });
const run = (dues: AlignDue[], payments: AlignPayment[], pins: { key: string; paymentId: string }[] = []) => alignPayments({ dues, payments, pins }, { toleranceMinor: 100 });
const paired = (result: ReturnType<typeof run>) => Object.fromEntries(result.dues.map((d) => [d.key, d.payment?.id ?? null]));

describe("lining payments up against the schedule", () => {
  it("the HSBC history: all 35 repayments pair with their own due date and are routine (paid up to 11 days early)", () => {
    const dues = history.rows.map((r) => ({ key: r.adjustedDueDate, date: r.adjustedDueDate, expectedMinor: history.contractualPaymentMinor }));
    const payments = history.rows.map((r, i) => pay(`p${i}`, r.paidDate, r.paymentMinor));
    const result = run(dues, payments);
    expect(result.dues.map((d) => d.payment?.id)).toEqual(payments.map((p) => p.id));
    expect(result.dues.every((d) => d.clean)).toBe(true);
    expect(result.extras).toEqual([]);
  });

  it("pairs a payment far outside any day window, and says it was late", () => {
    const result = run(monthly("2024-01-01", 3), [pay("a", "2023-12-28"), pay("b", "2024-02-22"), pay("c", "2024-03-03")]);
    expect(paired(result)).toEqual({ "2024-01-01": "a", "2024-02-01": "b", "2024-03-01": "c" });
    const feb = result.dues[1];
    expect(feb.clean).toBe(false);
    expect(feb.reasons).toEqual([expect.objectContaining({ code: "late", text: "Paid 21 days after the due date." })]);
  });

  it("follows a changed repayment (a rate change) with no rule to edit, flagging only the amount", () => {
    const dues = monthly("2024-01-01", 3).map((d, i) => (i === 2 ? { ...d, expectedMinor: 104_000 } : d));
    const result = run(dues, [pay("a", "2024-01-01"), pay("b", "2024-02-01"), pay("c", "2024-03-01", 104_000)]);
    expect(paired(result)).toEqual({ "2024-01-01": "a", "2024-02-01": "b", "2024-03-01": "c" });
    expect(result.dues.every((d) => d.clean)).toBe(true);
  });

  it("a month with nothing paid is missed, with the payments either side named", () => {
    const result = run(monthly("2024-01-01", 3), [pay("a", "2024-01-01"), pay("c", "2024-03-01")]);
    expect(paired(result)).toEqual({ "2024-01-01": "a", "2024-02-01": null, "2024-03-01": "c" });
    expect(result.dues[1].reasons[0]).toEqual({ code: "missed", text: "No payment to this loan was found for this due date between the payments on 2024-01-01 and 2024-03-01." });
  });

  it("two payments in one month: the one nearer the repayment pairs, the other is extra, and the pairing says so", () => {
    const result = run(monthly("2024-01-01", 2), [pay("a", "2024-01-01"), pay("x", "2024-01-20", 25_000), pay("b", "2024-02-01")]);
    expect(paired(result)).toEqual({ "2024-01-01": "a", "2024-02-01": "b" });
    expect(result.extras.map((p) => p.id)).toEqual(["x"]);
  });

  it("two equal payments near one due date: pairs one, and flags the other as a possible repayment", () => {
    const result = run(monthly("2024-01-01", 1), [pay("a", "2023-12-30"), pay("b", "2024-01-02")]);
    expect(result.extras).toHaveLength(1);
    expect(result.dues[0].clean).toBe(false);
    expect(result.dues[0].reasons.map((r) => r.code)).toContain("another-candidate");
  });

  it("two repayments paid at once after a missed month: Review with the reason, never a guess", () => {
    const result = run(monthly("2024-01-01", 3), [pay("a", "2024-01-01"), pay("bc", "2024-03-01", 200_000)]);
    expect(paired(result)).toEqual({ "2024-01-01": "a", "2024-02-01": null, "2024-03-01": "bc" });
    expect(result.dues[2].reasons[0]).toEqual(expect.objectContaining({ code: "covers-missed" }));
    expect(result.dues[2].clean).toBe(false);
  });

  it("a small unrelated payment is not taken for a repayment", () => {
    const result = run(monthly("2024-01-01", 2), [pay("a", "2024-01-01"), pay("tiny", "2024-02-01", 500)]);
    expect(paired(result)).toEqual({ "2024-01-01": "a", "2024-02-01": null });
    expect(result.extras.map((p) => p.id)).toEqual(["tiny"]);
  });

  it("settled due dates and the user's pins are fixed; the rest aligns around them", () => {
    const dues = monthly("2024-01-01", 4).map((d, i) => (i === 0 ? { ...d, settled: { paymentId: "s", date: "2023-12-29" } } : d));
    // The user says the payment on Feb 20 is March's repayment (paid early), not February's.
    const result = run(dues, [pay("b", "2024-02-02"), pay("c", "2024-02-20"), pay("d", "2024-04-01")], [{ key: "2024-03-01", paymentId: "c" }]);
    expect(paired(result)).toEqual({ "2024-01-01": "s", "2024-02-01": "b", "2024-03-01": "c", "2024-04-01": "d" });
    expect(result.dues[0]).toMatchObject({ settled: true, clean: true });
    expect(result.dues[2]).toMatchObject({ pinned: true, clean: true });
  });
});

describe("due dates not reached yet", () => {
  it("are never missed, and take only a payment made shortly before them", () => {
    const dues = monthly("2024-01-01", 3).map((d, i) => (i === 2 ? { ...d, upcoming: true } : d));
    const early = run(dues, [pay("a", "2024-01-01"), pay("b", "2024-02-01"), pay("c", "2024-02-25")]);
    expect(paired(early)).toEqual({ "2024-01-01": "a", "2024-02-01": "b", "2024-03-01": "c" });
    const nothing = run(dues, [pay("a", "2024-01-01"), pay("b", "2024-02-01")]);
    expect(nothing.dues[2]).toMatchObject({ payment: null, clean: true, reasons: [] });
    // A duplicate the day after a due date is not taken for next month's repayment.
    const dup = run(dues, [pay("a", "2024-01-01"), pay("b", "2024-02-01"), pay("b2", "2024-02-02")]);
    expect(dup.extras.map((p) => p.id)).toEqual(["b2"]);
    expect(dup.dues[1].reasons.map((r) => r.code)).toContain("another-candidate");
  });
});
