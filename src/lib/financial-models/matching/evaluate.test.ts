import { backtestMatchingRule } from "./backtest";
import { parseMatchActionsV1, parseMatchConditionsV1, type MatchConditionV1 } from "./dsl";
import { evaluateCandidate, evaluateExpectedPeriod, normalizeMatchText, type MatchCandidate } from "./evaluate";

const expected = { periodKey: "2026-01", date: "2026-01-15", paymentMinor: 100_000 };
const candidate = (patch: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: "txn-1",
  parentId: null,
  accountId: "cash",
  date: "2026-01-16",
  amountMinor: -100_500,
  payeeId: "bank",
  importedPayee: "  HSBC\u00a0 PAYMENT ",
  notes: " Loan   Payment January ",
  categoryId: null,
  cleared: true,
  reconciled: false,
  transferId: null,
  isParent: false,
  isChild: false,
  benchMarked: false,
  postingLinked: false,
  ...patch,
});

const conditions = (items: MatchConditionV1[], operator: "all" | "any" = "all") => parseMatchConditionsV1({
  format: "rd084.debt-match-conditions",
  version: 1,
  operator,
  items,
});

const matches = (condition: MatchConditionV1, patch: Partial<MatchCandidate> = {}) =>
  evaluateCandidate(conditions([condition]), candidate(patch), expected).matches;

describe("matching DSL evaluation", () => {
  it.each<[string, MatchConditionV1, Partial<MatchCandidate>?]>([
    ["source account", { kind: "source-account", accountId: "cash" }],
    ["payee exact", { kind: "payee", operator: "exact", payeeId: "bank" }],
    ["payee one-of", { kind: "payee", operator: "one-of", payeeIds: ["other", "bank"] }],
    ["imported payee exact", { kind: "imported-payee", operator: "exact", value: "hsbc payment" }],
    ["imported payee contains", { kind: "imported-payee", operator: "contains", value: "payment" }],
    ["imported payee one-of", { kind: "imported-payee", operator: "one-of", values: ["x", "HSBC PAYMENT"] }],
    ["notes exact", { kind: "notes", operator: "exact", value: "loan payment january" }],
    ["notes contains", { kind: "notes", operator: "contains", value: "PAYMENT" }],
    ["amount exact", { kind: "amount", operator: "exact", amountMinor: 100_500, direction: "outflow" }],
    ["amount absolute", { kind: "amount", operator: "approximate", amountMinor: 100_000, direction: "outflow", tolerance: { kind: "absolute", amountMinor: 500 } }],
    ["amount bps", { kind: "amount", operator: "approximate", amountMinor: 100_000, direction: "outflow", tolerance: { kind: "basis-points", bps: 50 } }],
    ["amount between", { kind: "amount", operator: "between", minMinor: 100_000, maxMinor: 101_000, direction: "outflow" }],
    ["expected date", { kind: "expected-date", daysBefore: 0, daysAfter: 2 }],
    ["day of month", { kind: "day-of-month", day: 16 }],
    ["cleared", { kind: "cleared-state", value: "cleared" }],
    ["uncleared", { kind: "cleared-state", value: "uncleared" }, { cleared: false }],
    ["reconciled", { kind: "reconciled-state", value: "reconciled" }, { reconciled: true }],
    ["unreconciled", { kind: "reconciled-state", value: "unreconciled" }],
    ["category empty", { kind: "category", operator: "empty" }],
    ["category exact", { kind: "category", operator: "exact", categoryId: "loan" }, { categoryId: "loan" }],
    ["category one-of", { kind: "category", operator: "one-of", categoryIds: ["x", "loan"] }, { categoryId: "loan" }],
    ["transfer none", { kind: "transfer-state", value: "none" }],
    ["transfer present", { kind: "transfer-state", value: "present" }, { transferId: "other-leg" }],
    ["split single", { kind: "split-state", value: "single" }],
    ["split parent", { kind: "split-state", value: "parent" }, { isParent: true }],
    ["split child", { kind: "split-state", value: "child" }, { isChild: true, parentId: "parent" }],
    ["Bench marker exclusion", { kind: "bench-marker", value: "exclude" }],
    ["posting exclusion", { kind: "posting-link", value: "exclude" }],
  ])("evaluates %s", (...args) => {
    const [, condition, patch] = args as [string, MatchConditionV1, Partial<MatchCandidate>?];
    expect(matches(condition, patch)).toBe(true);
  });

  it("normalizes text deterministically and evaluates ALL/ANY", () => {
    expect(normalizeMatchText("  ＨＳＢＣ\u00a0  Payment ")).toBe("hsbc payment");
    expect(evaluateCandidate(conditions([
      { kind: "source-account", accountId: "wrong" },
      { kind: "notes", operator: "contains", value: "payment" },
    ], "any"), candidate(), expected).matches).toBe(true);
    expect(evaluateCandidate(conditions([
      { kind: "source-account", accountId: "wrong" },
      { kind: "notes", operator: "contains", value: "payment" },
    ]), candidate(), expected).matches).toBe(false);
  });

  it("uses integer arithmetic for large basis-point comparisons", () => {
    const amountMinor = Number.MAX_SAFE_INTEGER - 10_000;
    const actual = amountMinor - Math.floor(amountMinor / 10_000);
    expect(matches({ kind: "amount", operator: "approximate", amountMinor, direction: "outflow", tolerance: { kind: "basis-points", bps: 1 } }, { amountMinor: -actual })).toBe(true);
  });

  it("classifies missing, unique, multiple and structurally unsafe periods", () => {
    const rule = conditions([{ kind: "notes", operator: "contains", value: "payment" }]);
    expect(evaluateExpectedPeriod(rule, [], expected).status).toBe("missing");
    expect(evaluateExpectedPeriod(rule, [candidate()], expected).status).toBe("unique");
    expect(evaluateExpectedPeriod(rule, [candidate(), candidate({ id: "txn-2" })], expected).status).toBe("multiple");
    expect(evaluateExpectedPeriod(rule, [candidate({ isParent: true })], expected)).toMatchObject({ status: "unsafe", reviewReasons: ["split-parent-unclaimable"] });
    expect(evaluateExpectedPeriod(conditions([{ kind: "transfer-state", value: "none" }]), [candidate({ transferId: undefined })], expected)).toMatchObject({ status: "unsafe", reviewReasons: ["transfer-state-unavailable"] });
    expect(evaluateExpectedPeriod(rule, [candidate({ parentId: "parent", isChild: undefined })], expected)).toMatchObject({ status: "unsafe", reviewReasons: ["missing-child-structure"] });
  });

  it("keeps partial and offset-funded evidence in Review and never groups rows", () => {
    const broad = conditions([{ kind: "source-account", accountId: "cash" }]);
    const funded = { ...expected, fromOffsetMinor: 40_000, otherFundsMinor: 60_000 };
    expect(evaluateExpectedPeriod(broad, [candidate({ amountMinor: -60_000 })], funded)).toMatchObject({ status: "unsafe", reviewReasons: ["partial-offset-funding"] });
    expect(evaluateExpectedPeriod(broad, [candidate({ id: "a", amountMinor: -60_000 }), candidate({ id: "b", amountMinor: -40_000 })], expected).status).toBe("unsafe");
  });

  it("does not mark an underpayment within the matched amount tolerance unsafe", () => {
    const rule = conditions([
      { kind: "amount", operator: "approximate", amountMinor: 100_000, direction: "outflow", tolerance: { kind: "absolute", amountMinor: 1_000 } },
    ]);
    expect(evaluateExpectedPeriod(rule, [candidate({ amountMinor: -99_999 })], expected)).toMatchObject({ status: "unique", reviewReasons: [] });
  });

  it("reports bounded backtest summaries, deviations, flags and projected variance", () => {
    const rule = conditions([
      { kind: "source-account", accountId: "cash" },
      { kind: "amount", operator: "approximate", amountMinor: 100_000, direction: "outflow", tolerance: { kind: "absolute", amountMinor: 1_000 } },
      { kind: "expected-date", daysBefore: 2, daysAfter: 2 },
    ]);
    const result = backtestMatchingRule({
      conditions: rule,
      actions: parseMatchActionsV1({ format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] }),
      expectedPeriods: [expected, { ...expected, periodKey: "2026-02", date: "2026-02-15", balanceAfterMinor: 800_000 }],
      candidates: [candidate({ categoryId: "existing", transferId: "other", reconciled: true })],
      accountsRead: 1,
      from: "2026-01-01",
      to: "2026-02-28",
      generatedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(result.summary).toEqual({ expectedPeriods: 2, unique: 1, missing: 1, multiple: 0, unsafe: 0 });
    expect(result.periods[0]).toMatchObject({ projectedBalanceVarianceMinor: 500, flags: ["reconciled", "transferred", "categorized"] });
    expect(result.periods[1].projectedBalanceVarianceMinor).toBeNull();
  });
});
