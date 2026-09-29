import { allocate, type AllocationInput } from "./allocation";

const base: AllocationInput = { paymentMinor: 120000, interestMinor: 20000, components: [], outstandingPrincipalMinor: 2500000, negativeAmortizationAllowed: false };
const sumLines = (r: ReturnType<typeof allocate>) => (r.ok ? r.lines.reduce((s, l) => s + l.amountMinor, 0) : NaN);

describe("allocate", () => {
  it("makes principal the residual (1,200 on 25,000 at 200 interest → 1,000 principal)", () => {
    const r = allocate(base);
    expect(r).toEqual({ ok: true, principalMinor: 100000, capitalizedInterestMinor: 0, lines: [{ kind: "principal", amountMinor: 100000 }, { kind: "interest", amountMinor: 20000 }] });
  });

  it("takes components before principal and keeps their economic kind", () => {
    const r = allocate({ ...base, components: [{ kind: "insurance", amountMinor: 292 }, { kind: "fee", amountMinor: 1000 }] });
    expect(r.ok && r.principalMinor).toBe(98708);
    expect(r.ok && r.lines.map((l) => l.kind)).toEqual(["principal", "interest", "insurance", "fee"]);
    expect(sumLines(r)).toBe(120000);
  });

  it("capitalizes the shortfall only when negative amortization is permitted, never as negative principal", () => {
    const short = { ...base, paymentMinor: 61320, interestMinor: 64639 };
    expect(allocate(short)).toEqual({ ok: false, classification: "review", reason: "negative-amortization" });
    const r = allocate({ ...short, negativeAmortizationAllowed: true });
    expect(r).toEqual({ ok: true, principalMinor: 0, capitalizedInterestMinor: 3319, lines: [{ kind: "interest", amountMinor: 61320 }] });
  });

  it("caps principal at the balance: an overpayment needs review", () => {
    expect(allocate({ ...base, outstandingPrincipalMinor: 99999 })).toEqual({ ok: false, classification: "review", reason: "overpayment" });
    expect(allocate({ ...base, outstandingPrincipalMinor: 100000 }).ok).toBe(true);
  });

  it("blocks inconsistent inputs", () => {
    expect(allocate({ ...base, components: [{ kind: "fee", amountMinor: 130000 }] })).toMatchObject({ ok: false, classification: "blocked" });
    expect(allocate({ ...base, paymentMinor: -1 })).toMatchObject({ ok: false, reason: "inconsistent" });
    expect(allocate({ ...base, interestMinor: 1.5 })).toMatchObject({ ok: false, reason: "inconsistent" });
  });

  it("property: for random valid inputs the lines sum to the payment exactly", () => {
    // Deterministic pseudo-random inputs (a fixed LCG), so the test is reproducible.
    let seed = 20260929;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 5000; i++) {
      const input: AllocationInput = {
        paymentMinor: next(500000),
        interestMinor: next(100000),
        components: [{ kind: "fee", amountMinor: next(2000) }, { kind: "escrow", amountMinor: next(20000) }],
        outstandingPrincipalMinor: next(10000000),
        negativeAmortizationAllowed: next(2) === 1,
      };
      const r = allocate(input);
      if (!r.ok) continue;
      expect(sumLines(r)).toBe(input.paymentMinor);
      expect(r.principalMinor).toBeGreaterThanOrEqual(0);
      expect(r.lines.every((l) => l.amountMinor > 0)).toBe(true);
      expect(r.principalMinor).toBeLessThanOrEqual(input.outstandingPrincipalMinor);
    }
  });
});
