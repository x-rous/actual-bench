import { parseBudgetMonth } from "./parseBudgetMonth";
import trackingMonth from "./__fixtures__/tracking-month.json";
import envelopeMonth from "./__fixtures__/envelope-month.json";

function ok(input: unknown) {
  const result = parseBudgetMonth(input);
  if (!result.ok) throw new Error("expected ok, got errors: " + result.errors.join("; "));
  return result;
}

describe("parseBudgetMonth — transport shapes", () => {
  it("parses a Direct payload (month at top level)", () => {
    const { month } = ok(trackingMonth);
    expect(month.month).toBe("2026-06");
    expect(month.groups).toHaveLength(5);
  });

  it("parses the HTTP { data } envelope identically to Direct", () => {
    const direct = ok(trackingMonth).month;
    const http = ok({ data: trackingMonth }).month;
    expect(http).toEqual(direct);
  });

  it("parses the { body: { data } } capture wrapper", () => {
    const { month } = ok({ httpStatus: 200, body: { data: envelopeMonth } });
    expect(month.month).toBe("2026-06");
    expect(month.totalBudgeted).toBe(-3200);
  });
});

describe("parseBudgetMonth — sign preservation (BM-07)", () => {
  it("keeps Tracking totalBudgeted positive", () => {
    expect(ok(trackingMonth).month.totalBudgeted).toBe(4500);
  });
  it("keeps Envelope totalBudgeted negative", () => {
    expect(ok(envelopeMonth).month.totalBudgeted).toBe(-3200);
  });
  it("keeps signed spent (refund stays positive)", () => {
    const reimb = ok(trackingMonth).month.groups
      .flatMap((g) => g.categories)
      .find((c) => c.id === "c-reimb");
    expect(reimb?.spent).toBe(100); // net-positive refund, not clamped
  });
});

describe("parseBudgetMonth — absent ≠ zero (BM-39)", () => {
  it("Tracking funding fields are null (not 0)", () => {
    const m = ok(trackingMonth).month;
    expect(m.incomeAvailable).toBeNull();
    expect(m.toBudget).toBeNull();
    expect(m.forNextMonth).toBeNull();
  });
  it("a real 0 is preserved as 0", () => {
    expect(ok(envelopeMonth).month.forNextMonth).toBe(0);
  });
  it("Envelope income exposes received but not budgeted/balance", () => {
    const incomeGroup = ok(envelopeMonth).month.groups.find((g) => g.isIncome)!;
    expect(incomeGroup.received).toBe(6000);
    expect(incomeGroup.budgeted).toBeNull();
    expect(incomeGroup.balance).toBeNull();
    expect(incomeGroup.categories[0].received).toBe(6000);
    expect(incomeGroup.categories[0].budgeted).toBeNull();
  });
  it("Tracking income exposes budgeted, received, and balance", () => {
    const incomeCat = ok(trackingMonth).month.groups
      .find((g) => g.isIncome)!
      .categories[0];
    expect(incomeCat.budgeted).toBe(5000);
    expect(incomeCat.received).toBe(5200);
    expect(incomeCat.balance).toBe(-200); // budgeted − received (inverse of expense)
  });
});

describe("parseBudgetMonth — hidden + carryover flags", () => {
  it("preserves hidden group/category flags", () => {
    const hidden = ok(trackingMonth).month.groups.find((g) => g.id === "g-old")!;
    expect(hidden.hidden).toBe(true);
    expect(hidden.categories[0].hidden).toBe(true);
    const visible = ok(trackingMonth).month.groups.find((g) => g.id === "g-housing")!;
    expect(visible.hidden).toBe(false);
  });
  it("carryover is boolean when present, null when the side omits it", () => {
    const car = ok(trackingMonth).month.groups
      .flatMap((g) => g.categories)
      .find((c) => c.id === "c-car")!;
    expect(car.carryover).toBe(true);
    const envIncomeCat = ok(envelopeMonth).month.groups
      .find((g) => g.isIncome)!
      .categories[0];
    expect(envIncomeCat.carryover).toBeNull(); // Envelope income has no carryover
  });
});

describe("parseBudgetMonth — validation", () => {
  it("rejects a non-object payload", () => {
    expect(parseBudgetMonth(42)).toEqual({ ok: false, errors: expect.any(Array) });
  });
  it("rejects a missing/malformed month", () => {
    const r = parseBudgetMonth({ month: "June", categoryGroups: [] });
    expect(r.ok).toBe(false);
  });
  it("rejects when categoryGroups is not an array", () => {
    const r = parseBudgetMonth({ month: "2026-06", categoryGroups: {} });
    expect(r.ok).toBe(false);
  });
  it("warns on an income parent/child side mismatch without failing", () => {
    const r = parseBudgetMonth({
      month: "2026-06",
      categoryGroups: [
        {
          id: "g-income",
          name: "Income",
          is_income: true,
          categories: [{ id: "c-x", name: "X", is_income: false, received: 100 }],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.some((w) => /is_income .* ≠ group/.test(w))).toBe(true);
      // group side wins for aggregation
      expect(r.month.groups[0].categories[0].isIncome).toBe(true);
    }
  });
});
