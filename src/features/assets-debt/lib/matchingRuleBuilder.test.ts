import { evaluateExpectedPeriod, parseMatchConditionsV1, type MatchCandidate } from "@/lib/financial-models/matching";
import { conditionsToSettings, describeSettings, recommendedSettings, settingsToConditions } from "./matchingRuleBuilder";

/** T280: matching without JSON; generated rules use the existing DSL v1 and evaluator unchanged. */

const accounts = [
  { id: "hsbc-current", name: "HSBC Current", offBudget: false, closed: false },
  { id: "hsbc-loan", name: "HSBC Home loan", offBudget: true, closed: false },
];
const hsbc = { purpose: "repayment" as const, paymentAccountId: "hsbc-current", liabilityAccountId: "hsbc-loan", signConvention: "negative-is-debt" as const, expectedPaymentMinor: 837_957, toleranceMinor: 100 };

const candidate = (date: string, amountMinor: number, extra: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: `t-${date}-${amountMinor}`, parentId: null, accountId: "hsbc-current", date, amountMinor, payeeId: null, importedPayee: "HSBC LOAN", notes: null,
  categoryId: null, cleared: true, reconciled: false, transferId: null, isParent: false, isChild: false, benchMarked: false, postingLinked: false, ...extra,
});

describe("matching rule builder", () => {
  it("HSBC: AED 8,379.57 around the 1st, up to 10 days early, is representable without JSON and matches through the existing evaluator", () => {
    // The suggestion is loose (10%): matching scores the amount itself (owner decision 2026-10-07).
    expect(recommendedSettings(hsbc).amount).toEqual({ mode: "approximate", amountMinor: 837_957, tolerance: { kind: "absolute", amountMinor: 83_796 } });
    const settings = { ...recommendedSettings(hsbc), daysEarly: 10, daysLate: 2, amount: { mode: "approximate" as const, amountMinor: 837_957, tolerance: { kind: "absolute" as const, amountMinor: 100 } } };
    const conditions = settingsToConditions(settings);
    expect(conditions.items).toEqual([
      { kind: "source-account", accountId: "hsbc-current" },
      { kind: "amount", operator: "approximate", amountMinor: 837_957, direction: "outflow", tolerance: { kind: "absolute", amountMinor: 100 } },
      { kind: "expected-date", daysBefore: 10, daysAfter: 2 },
      { kind: "bench-marker", value: "exclude" },
      { kind: "posting-link", value: "exclude" },
    ]);
    const expected = { periodKey: "2026-08-01", date: "2026-08-01", paymentMinor: 837_957 };
    expect(evaluateExpectedPeriod(conditions, [candidate("2026-07-22", -837_957)], expected).status).toBe("unique");
    expect(evaluateExpectedPeriod(conditions, [candidate("2026-07-21", -837_957)], expected).status).toBe("missing");
    // Amounts within tolerance on either side of the expected amount match as unique.
    expect(evaluateExpectedPeriod(conditions, [candidate("2026-07-25", -838_000)], expected).status).toBe("unique");
    expect(evaluateExpectedPeriod(conditions, [candidate("2026-07-25", -837_900)], expected).status).toBe("unique");
    expect(evaluateExpectedPeriod(conditions, [candidate("2026-07-25", -838_100)], expected).status).toBe("missing");
    expect(describeSettings(settings, accounts, [], 2, "AED")).toBe(
      "Matches money out in HSBC Current, 8,379.57 AED ± 1.00 AED; from 10 days early to 2 days late around each scheduled date. Rows Bench created or already posted are always excluded."
    );
  });

  it("recommends the loan account and the right direction for lender rows and lender interest charges", () => {
    expect(recommendedSettings({ ...hsbc, purpose: "lender-repayment-row" })).toMatchObject({ sourceAccountId: "hsbc-loan", direction: "inflow", amount: { mode: "any" }, daysEarly: 5, daysLate: 5 });
    expect(recommendedSettings({ ...hsbc, purpose: "interest-charge" })).toMatchObject({ sourceAccountId: "hsbc-loan", direction: "outflow" });
    expect(recommendedSettings({ ...hsbc, expectedPaymentMinor: null }).amount).toEqual({ mode: "any" });
  });

  it("round-trips every structured control through DSL v1, and always keeps the safety exclusions", () => {
    const settings = {
      ...recommendedSettings(hsbc),
      amount: { mode: "approximate" as const, amountMinor: 837_957, tolerance: { kind: "percent" as const, bps: 50 } },
      daysEarly: 10, daysLate: 0, dayOfMonth: 1, category: { mode: "exact" as const, categoryId: "cat-loan" }, transfer: "none" as const,
      split: "single" as const, reconciled: "unreconciled" as const, cleared: "cleared" as const, importedPayeeContains: "HSBC", notesContains: "loan",
    };
    const conditions = settingsToConditions(settings);
    expect(parseMatchConditionsV1(JSON.parse(JSON.stringify(conditions)))).toEqual(conditions);
    expect(conditionsToSettings(conditions)).toEqual({ ok: true, settings });
    expect(conditions.items.slice(-2)).toEqual([{ kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }]);
  });

  it("keeps conditions it cannot edit (a specific payee) verbatim, and refuses an any-of rule rather than misrepresenting it", () => {
    const withPayee = parseMatchConditionsV1({ format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [
      { kind: "source-account", accountId: "hsbc-current" }, { kind: "payee", operator: "exact", payeeId: "p-hsbc" }, { kind: "expected-date", daysBefore: 3, daysAfter: 3 },
      { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" },
    ] });
    const read = conditionsToSettings(withPayee);
    expect(read).toMatchObject({ ok: true, settings: { preserved: [{ kind: "payee", operator: "exact", payeeId: "p-hsbc" }] } });
    if (read.ok) expect(settingsToConditions(read.settings).items).toContainEqual({ kind: "payee", operator: "exact", payeeId: "p-hsbc" });
    expect(conditionsToSettings({ ...withPayee, operator: "any" })).toMatchObject({ ok: false });
  });

  it("any amount with a direction still filters money in or out through the existing amount condition", () => {
    const conditions = settingsToConditions(recommendedSettings({ ...hsbc, purpose: "lender-repayment-row" }));
    expect(conditions.items[1]).toEqual({ kind: "amount", operator: "between", minMinor: 0, maxMinor: Number.MAX_SAFE_INTEGER, direction: "inflow" });
    expect(conditionsToSettings(conditions)).toMatchObject({ ok: true, settings: { amount: { mode: "any" }, direction: "inflow" } });
  });
});
