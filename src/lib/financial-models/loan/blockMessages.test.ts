import { explainBlock, explainBlocks } from "./blockMessages";

const reason = (code: Parameters<typeof explainBlock>[0]["code"], message: string, date: string | null = null) => ({ code, message, date });

describe("explainBlock", () => {
  it("says in plain words what a once-per-period calculation cannot follow, and offers day by day", () => {
    const cases = [
      reason("irregular-event", "A extra-repayment on 2026-06-29 falls between payment dates; use bench-daily.", "2026-06-29"),
      reason("mid-period-rate-change", "A rate takes effect on 2025-03-15, inside a payment period; use bench-daily or rates effective from the next period.", "2025-03-15"),
      reason("offsets-need-daily-engine", "Offsets change interest day by day; use bench-daily."),
      reason("irregular-first-period", "The anchor 2024-03-10 is not a payment date or the start of the first period (2024-01-01); an irregular first period needs bench-daily.", "2024-03-10"),
    ];
    for (const c of cases) {
      const plain = explainBlock(c);
      expect(plain.category).toBe("switch");
      expect(plain.text).not.toMatch(/bench-|@\d|anchor/i);
    }
    expect(explainBlock(cases[0]).text).toContain("2026-06-29");
    expect(explainBlock(cases[3]).text).toMatch(/real history/);
  });

  it("separates what the person can fix from what is not supported", () => {
    expect(explainBlock(reason("negative-amortization", "Payment on 2024-03-01: negative-amortization.", "2024-03-01"))).toMatchObject({ category: "fix", text: expect.stringContaining("does not cover the interest") });
    expect(explainBlock(reason("rate-gap", "No rate applies on 2024-01-01.", "2024-01-01")).category).toBe("fix");
    expect(explainBlock(reason("unsupported-profile", "Generated semi-monthly repayments are not supported in configuration version 1; supply the dates as repayment events.")).category).toBe("unsupported");
    expect(explainBlock(reason("unsupported-profile", "Business-day adjustment of scheduled dates needs daily accrual.")).category).toBe("switch");
  });

  it("never shows an engine's internal names, even for a reason it has no wording for", () => {
    const plain = explainBlock(reason("credit-limit-exceeded", "bench-daily@1 does not support this; projection@1 stops."));
    expect(plain.text).not.toMatch(/bench-|@\d/);
  });

  it("lists each distinct reason once and says whether switching could help", () => {
    const same = reason("irregular-event", "A draw on 2024-03-10 falls between payment dates; use bench-daily.", "2024-03-10");
    expect(explainBlocks([same, same])).toEqual({ texts: [expect.stringContaining("2024-03-10")], canSwitch: true });
    expect(explainBlocks([reason("rate-gap", "x", "2024-01-01")]).canSwitch).toBe(false);
  });
});
