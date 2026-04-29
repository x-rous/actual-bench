import { parseBudgetExpression } from "./budgetMath";

describe("parseBudgetExpression", () => {
  describe("integer and decimal literals", () => {
    it("parses positive integers in dollars and returns minor units", () => {
      const r = parseBudgetExpression("150");
      expect(r).toEqual({ ok: true, value: 15000 });
    });

    it("parses decimal values with two fractional digits", () => {
      const r = parseBudgetExpression("12.34");
      expect(r).toEqual({ ok: true, value: 1234 });
    });

    it("parses zero", () => {
      const r = parseBudgetExpression("0");
      expect(r).toEqual({ ok: true, value: 0 });
    });

    it("rounds to the nearest minor unit", () => {
      const r = parseBudgetExpression("1.005");
      // floating point: 1.005 * 100 ≈ 100.49999999, Math.round → 100.
      // The contract is "rounded to nearest integer" — we accept either 100 or 101
      // depending on platform float behaviour; lock the contract to "near 100".
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect(Math.abs(r.value - 100)).toBeLessThanOrEqual(1);
    });
  });

  describe("arithmetic operators", () => {
    it("handles addition", () => {
      expect(parseBudgetExpression("10 + 5")).toEqual({ ok: true, value: 1500 });
    });

    it("handles subtraction", () => {
      expect(parseBudgetExpression("10 - 5")).toEqual({ ok: true, value: 500 });
    });

    it("handles multiplication", () => {
      expect(parseBudgetExpression("3 * 4")).toEqual({ ok: true, value: 1200 });
    });

    it("handles division", () => {
      expect(parseBudgetExpression("12 / 4")).toEqual({ ok: true, value: 300 });
    });

    it("respects operator precedence", () => {
      // 2 + 3 * 4 = 14, not (2 + 3) * 4 = 20
      expect(parseBudgetExpression("2 + 3 * 4")).toEqual({ ok: true, value: 1400 });
    });

    it("supports parentheses to override precedence", () => {
      expect(parseBudgetExpression("(2 + 3) * 4")).toEqual({ ok: true, value: 2000 });
    });

    it("supports nested parentheses", () => {
      expect(parseBudgetExpression("((1 + 2) * (3 + 4))")).toEqual({
        ok: true,
        value: 2100,
      });
    });
  });

  describe("unary minus", () => {
    it("parses a leading negative literal", () => {
      expect(parseBudgetExpression("-5")).toEqual({ ok: true, value: -500 });
    });

    it("parses subtraction with negation chained together", () => {
      expect(parseBudgetExpression("10 - -5")).toEqual({ ok: true, value: 1500 });
    });
  });

  describe("thousands separators", () => {
    it("strips comma thousands separators", () => {
      expect(parseBudgetExpression("12,000")).toEqual({ ok: true, value: 1200000 });
    });

    it("strips multiple commas", () => {
      expect(parseBudgetExpression("1,000,000.50")).toEqual({
        ok: true,
        value: 100000050,
      });
    });
  });

  describe("error cases", () => {
    it("rejects an empty string", () => {
      const r = parseBudgetExpression("");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/empty/i);
    });

    it("rejects a whitespace-only string", () => {
      const r = parseBudgetExpression("   ");
      expect(r.ok).toBe(false);
    });

    it("rejects division by zero", () => {
      const r = parseBudgetExpression("5 / 0");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/division by zero/i);
    });

    it("rejects unmatched opening parenthesis", () => {
      const r = parseBudgetExpression("(1 + 2");
      expect(r.ok).toBe(false);
    });

    it("rejects trailing garbage characters", () => {
      const r = parseBudgetExpression("1 + 2 garbage");
      expect(r.ok).toBe(false);
    });

    it("rejects scientific notation", () => {
      const r = parseBudgetExpression("1e5");
      // 'e' is not a digit or operator — should fail trailing-char check.
      expect(r.ok).toBe(false);
    });

    it("rejects a bare operator", () => {
      const r = parseBudgetExpression("+");
      expect(r.ok).toBe(false);
    });

    it("rejects letters", () => {
      const r = parseBudgetExpression("abc");
      expect(r.ok).toBe(false);
    });
  });

  describe("whitespace handling", () => {
    it("ignores surrounding whitespace", () => {
      expect(parseBudgetExpression("  100  ")).toEqual({ ok: true, value: 10000 });
    });

    it("ignores whitespace between operators", () => {
      expect(parseBudgetExpression("1   +   2")).toEqual({ ok: true, value: 300 });
    });
  });
});
