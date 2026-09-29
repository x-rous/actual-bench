import { dec, sub, toDecString, type Dec } from "../money/kernel";
import { actual365Fixed } from "./daycount/act365f";
import { periodInterest } from "./daycount/types";
import { dayStepOrder, orderEvents, stepForEvent, type EventOrderProfile } from "./events";

describe("day step order", () => {
  it("follows FR-047 by default (start-of-day)", () => {
    expect(dayStepOrder()).toEqual([
      "contract-change",
      "external-cash",
      "payment",
      "scheduled-repayment",
      "offset-change",
      "determine-balance",
      "accrue",
      "charge",
      "close",
    ]);
  });

  it("moves payments and offsets after the accrual and the charge for end-of-day", () => {
    expect(dayStepOrder({ timing: "end-of-day" })).toEqual([
      "contract-change",
      "external-cash",
      "determine-balance",
      "accrue",
      "charge",
      "payment",
      "scheduled-repayment",
      "offset-change",
      "close",
    ]);
  });

  it("lets a lender profile place scheduled repayments, other payments and offsets separately", () => {
    // Figura: extra repayments and offset deposits before the accrual, scheduled repayments after it.
    const order = dayStepOrder({ scheduledRepayments: "after-accrual", otherPayments: "before-accrual", offsets: "before-accrual" });
    expect(order.indexOf("payment")).toBeLessThan(order.indexOf("accrue"));
    expect(order.indexOf("offset-change")).toBeLessThan(order.indexOf("accrue"));
    expect(order.indexOf("scheduled-repayment")).toBeGreaterThan(order.indexOf("accrue"));
    expect(order.indexOf("scheduled-repayment")).toBeGreaterThan(order.indexOf("charge"));
  });
});

describe("orderEvents", () => {
  const events = [
    { date: "2024-03-01", kind: "lender-interest-charge", key: "c1" },
    { date: "2024-03-01", kind: "repayment", key: "r2" },
    { date: "2024-02-29", kind: "offset-balance", key: "o1" },
    { date: "2024-03-01", kind: "rate-change", key: "rate" },
    { date: "2024-03-01", kind: "repayment", key: "r1" },
    { date: "2024-03-01", kind: "offset-balance", key: "o2" },
    { date: "2024-03-01", kind: "fee", key: "f1" },
  ];

  it("sorts by date, then step, then key, whatever the input order", () => {
    const expected = ["o1", "rate", "f1", "r1", "r2", "o2", "c1"];
    expect(orderEvents(events).map((e) => e.key)).toEqual(expected);
    expect(orderEvents([...events].reverse()).map((e) => e.key)).toEqual(expected);
  });

  it("refuses an event kind with no step", () => {
    expect(() => orderEvents([{ date: "2024-01-01", kind: "mystery", key: "x" }])).toThrow(RangeError);
    expect(stepForEvent("draw")).toBe("payment");
    expect(stepForEvent("extra-repayment")).toBe("payment");
    expect(stepForEvent("repayment")).toBe("scheduled-repayment");
  });
});

describe("start-of-day vs end-of-day change the day's interest", () => {
  // $100,000 owed, $40,000 repaid on 2024-03-01, 6% Actual/365 Fixed.
  function dayInterest(profile: EventOrderProfile): string {
    let balance: Dec = dec("100000");
    let interest: Dec = dec("0");
    for (const step of dayStepOrder(profile)) {
      if (step === "payment") balance = sub(balance, dec("40000"));
      if (step === "accrue") interest = periodInterest(balance, dec("0.06"), actual365Fixed, "2024-03-01", "2024-03-02", 5, "half-up");
    }
    return toDecString(interest);
  }

  it("accrues on the reduced balance at start of day and the full one at end of day", () => {
    expect(dayInterest({ timing: "start-of-day" })).toBe("9.86301"); // 60000 × 0.06 / 365
    expect(dayInterest({ timing: "end-of-day" })).toBe("16.43836"); // 100000 × 0.06 / 365
  });
});
