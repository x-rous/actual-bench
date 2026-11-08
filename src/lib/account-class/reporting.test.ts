import { evaluateAccountReadiness, isCashEquivalent, reportingRequirement, REPORTING_TREATMENTS, validSavedTreatment, isReportingTreatment } from "./reporting";
import { ACCOUNT_CLASSES, type AccountClass } from "./index";

function ready(
  accounts: { id: string; offBudget?: boolean; closed?: boolean }[],
  classOf: Record<string, AccountClass | null>,
  excluded: string[] = [],
  closedActivity: Record<string, { count: number; balanceMinor: number }> = {}
) {
  const result = evaluateAccountReadiness({
    accounts: accounts.map((a) => ({ id: a.id, offBudget: a.offBudget ?? true, closed: a.closed ?? false })),
    classOf: new Map(Object.entries(classOf)),
    excluded: new Set(excluded),
    closedActivity: new Map(Object.entries(closedActivity)),
  });
  return Object.fromEntries(result.accounts.map((a) => [a.accountId, a.status]));
}

describe("Financial Reporting treatments", () => {
  it("are only Fixed asset and Fixed / restricted deposit; current and non-current are retired", () => {
    expect([...REPORTING_TREATMENTS]).toEqual(["fixed-asset", "fixed-deposit"]);
    for (const retired of ["current-investment", "non-current-investment", "current-asset", "non-current-asset", "current-liability", "non-current-liability"]) {
      expect(isReportingTreatment(retired)).toBe(false);
    }
  });

  it("is automatic for Property and Vehicle, and an optional choice for Other Asset", () => {
    expect(reportingRequirement("property")).toEqual({ kind: "automatic", label: "Fixed asset" });
    expect(reportingRequirement("vehicle")).toEqual({ kind: "automatic", label: "Fixed asset" });
    expect(reportingRequirement("other-asset")).toEqual({ kind: "optional", label: "Holding", options: ["fixed-asset"] });
    expect(validSavedTreatment("other-asset", "fixed-asset")).toBe("fixed-asset");
    expect(validSavedTreatment("investment", "fixed-asset")).toBeNull();
  });

  it("asks nothing of anyone: every class has a label, and only Bank and Other Asset have a choice", () => {
    for (const c of ACCOUNT_CLASSES) expect(reportingRequirement(c)).toBeDefined();
    expect(ACCOUNT_CLASSES.filter((c) => reportingRequirement(c).kind !== "automatic")).toEqual(["bank", "other-asset"]);
    expect(reportingRequirement("investment")).toEqual({ kind: "automatic", label: "Investment" });
    expect(reportingRequirement("retirement")).toEqual({ kind: "automatic", label: "Retirement holding" });
    expect(reportingRequirement("other-liability")).toEqual({ kind: "automatic", label: "Liability" });
  });

  it("treats Cash and Bank as cash equivalents unless a Bank account is a fixed / restricted deposit", () => {
    expect(isCashEquivalent("cash", undefined)).toBe(true);
    expect(isCashEquivalent("bank", undefined)).toBe(true);
    expect(isCashEquivalent("bank", "fixed-deposit")).toBe(false);
    expect(isCashEquivalent("investment", undefined)).toBe(false);
    expect(isCashEquivalent("other-asset", undefined)).toBe(false);
  });

  it("accepts a saved choice only while the class still takes it", () => {
    expect(validSavedTreatment("bank", "fixed-deposit")).toBe("fixed-deposit");
    expect(validSavedTreatment("cash", "fixed-deposit")).toBeNull();
    expect(validSavedTreatment("bank", "fixed-asset")).toBeNull();
    expect(validSavedTreatment("property", "fixed-asset")).toBeNull();
  });
});

describe("account readiness", () => {
  it("is ready when every account has a class, with no choice needed (Investment included)", () => {
    expect(ready([{ id: "bank", offBudget: false }, { id: "inv" }, { id: "loan" }, { id: "oa" }, { id: "ol" }], { bank: "bank", inv: "investment", loan: "loan", oa: "other-asset", ol: "other-liability" }))
      .toEqual({ bank: "ready", inv: "ready", loan: "ready", oa: "ready", ol: "ready" });
  });

  it("flags only a missing class", () => {
    expect(ready([{ id: "a" }, { id: "b" }], { a: null, b: "investment" })).toEqual({ a: "needs-class", b: "ready" });
  });

  it("flags a class that does not fit the account's budget placement", () => {
    expect(ready([{ id: "a", offBudget: false }], { a: "property" })).toEqual({ a: "incompatible-placement" });
  });

  it("flags an off-budget credit card, and accepts an on-budget one", () => {
    expect(ready([{ id: "a", offBudget: true }, { id: "b", offBudget: false }], { a: "credit-card", b: "credit-card" })).toEqual({ a: "incompatible-placement", b: "ready" });
  });

  it("treats an excluded off-budget account as ready whatever its class, and an excluded on-budget account as a wrong placement", () => {
    expect(ready([{ id: "a", offBudget: true }], { a: null }, ["a"])).toEqual({ a: "ready" });
    expect(ready([{ id: "a", offBudget: true }], { a: "credit-card" }, ["a"])).toEqual({ a: "ready" });
    expect(ready([{ id: "a", offBudget: false }], { a: "bank" }, ["a"])).toEqual({ a: "incompatible-placement" });
    expect(ready([{ id: "a", offBudget: false }], { a: null }, ["a"])).toEqual({ a: "incompatible-placement" });
  });

  it("exempts a closed account with no history, but not one with history or unknown history", () => {
    const classOf = { empty: null, used: null, unknown: null };
    const accounts = [{ id: "empty", closed: true }, { id: "used", closed: true }, { id: "unknown", closed: true }];
    const status = ready(accounts, classOf, [], { empty: { count: 0, balanceMinor: 0 }, used: { count: 3, balanceMinor: 0 } });
    expect(status).toEqual({ empty: "ready", used: "needs-class", unknown: "needs-class" });
  });

  it("counts attention accounts", () => {
    const result = evaluateAccountReadiness({
      accounts: [{ id: "a", offBudget: true, closed: false }, { id: "b", offBudget: true, closed: false }],
      classOf: new Map([["a", "cash" as AccountClass], ["b", null]]), excluded: new Set(), closedActivity: new Map(),
    });
    expect(result).toMatchObject({ attention: 1, ready: false });
  });
});
