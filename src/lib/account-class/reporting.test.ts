import { evaluateAccountReadiness, isCashEquivalent, reportingRequirement, validSavedTreatment, type ReportingTreatment } from "./reporting";
import { ACCOUNT_CLASSES, type AccountClass } from "./index";

const none = new Map<string, ReportingTreatment>();

function ready(
  accounts: { id: string; offBudget?: boolean; closed?: boolean }[],
  classOf: Record<string, AccountClass | null>,
  reporting: Record<string, ReportingTreatment> = {},
  closedActivity: Record<string, { count: number; balanceMinor: number }> = {}
) {
  const result = evaluateAccountReadiness({
    accounts: accounts.map((a) => ({ id: a.id, offBudget: a.offBudget ?? true, closed: a.closed ?? false })),
    classOf: new Map(Object.entries(classOf)),
    reporting: new Map(Object.entries(reporting)),
    closedActivity: new Map(Object.entries(closedActivity)),
  });
  return Object.fromEntries(result.accounts.map((a) => [a.accountId, a.status]));
}

describe("Fixed asset treatment", () => {
  it("is automatic for Property and Vehicle, and a third choice for Other Asset", () => {
    expect(reportingRequirement("property")).toEqual({ kind: "automatic", label: "Fixed asset" });
    expect(reportingRequirement("vehicle")).toEqual({ kind: "automatic", label: "Fixed asset" });
    expect(reportingRequirement("other-asset")).toEqual({ kind: "required", options: ["current-asset", "non-current-asset", "fixed-asset"] });
    expect(validSavedTreatment("other-asset", "fixed-asset")).toBe("fixed-asset");
    expect(validSavedTreatment("investment", "fixed-asset")).toBeNull();
  });
});

describe("Financial Reporting requirements", () => {
  it("asks only Investment, Other Asset and Other Liability for a choice", () => {
    const required = ACCOUNT_CLASSES.filter((c) => reportingRequirement(c).kind === "required");
    expect(required).toEqual(["investment", "other-asset", "other-liability"]);
  });

  it("treats Cash and Bank as cash equivalents unless a Bank account is a fixed / restricted deposit", () => {
    expect(isCashEquivalent("cash", undefined)).toBe(true);
    expect(isCashEquivalent("bank", undefined)).toBe(true);
    expect(isCashEquivalent("bank", "fixed-deposit")).toBe(false);
    // A current investment is never cash, however quickly it can be sold.
    expect(isCashEquivalent("investment", "current-investment")).toBe(false);
    expect(isCashEquivalent("other-asset", undefined)).toBe(false);
  });

  it("accepts a saved choice only while the class still takes it", () => {
    expect(validSavedTreatment("investment", "current-investment")).toBe("current-investment");
    expect(validSavedTreatment("other-asset", "current-investment")).toBeNull();
    expect(validSavedTreatment("property", "non-current-asset")).toBeNull();
    expect(validSavedTreatment("bank", "fixed-deposit")).toBe("fixed-deposit");
    expect(validSavedTreatment("cash", "fixed-deposit")).toBeNull();
  });
});

describe("account readiness", () => {
  it("is ready when every account has a class and a needed choice", () => {
    const status = ready(
      [{ id: "bank", offBudget: false }, { id: "inv" }, { id: "loan" }],
      { bank: "bank", inv: "investment", loan: "loan" },
      { inv: "non-current-investment" }
    );
    expect(status).toEqual({ bank: "ready", inv: "ready", loan: "ready" });
  });

  it("flags a missing class, a missing choice and a stale choice", () => {
    const status = ready(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      { a: null, b: "investment", c: "other-asset" },
      { c: "current-investment" }
    );
    expect(status).toEqual({ a: "needs-class", b: "needs-choice", c: "needs-choice" });
  });

  it("flags a class that does not fit the account's budget placement", () => {
    expect(ready([{ id: "a", offBudget: false }], { a: "property" })).toEqual({ a: "incompatible-placement" });
  });

  it("treats Excluded as classified for an off-budget account, and as a wrong placement on-budget", () => {
    expect(ready([{ id: "a", offBudget: true }], { a: "excluded" })).toEqual({ a: "ready" });
    expect(ready([{ id: "a", offBudget: false }], { a: "excluded" })).toEqual({ a: "incompatible-placement" });
  });

  it("exempts a closed account with no history, but not one with history or unknown history", () => {
    const classOf = { empty: null, used: null, unknown: null };
    const accounts = [{ id: "empty", closed: true }, { id: "used", closed: true }, { id: "unknown", closed: true }];
    const status = ready(accounts, classOf, {}, { empty: { count: 0, balanceMinor: 0 }, used: { count: 3, balanceMinor: 0 } });
    expect(status).toEqual({ empty: "ready", used: "needs-class", unknown: "needs-class" });
  });

  it("counts attention accounts", () => {
    const result = evaluateAccountReadiness({
      accounts: [{ id: "a", offBudget: true, closed: false }, { id: "b", offBudget: true, closed: false }],
      classOf: new Map([["a", "cash" as AccountClass], ["b", null]]), reporting: none, closedActivity: new Map(),
    });
    expect(result).toMatchObject({ attention: 1, ready: false });
  });
});
