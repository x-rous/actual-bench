import {
  ACCOUNT_CLASSES,
  ACCOUNT_CLASS_INFO,
  isAccountClass,
  isCashLike,
  isLiability,
  planGroupAccountClass,
  resolveAccountClass,
  type AccountClass,
  type AccountClassMaps,
} from "./index";

function maps(accounts: Record<string, AccountClass> = {}, groups: Record<string, AccountClass> = {}): AccountClassMaps {
  return { accounts: new Map(Object.entries(accounts)), groups: new Map(Object.entries(groups)) };
}

describe("account classes", () => {
  it("describes every class exactly once", () => {
    expect(ACCOUNT_CLASS_INFO.map((i) => i.value)).toEqual([...ACCOUNT_CLASSES]);
    expect(ACCOUNT_CLASSES).toHaveLength(11);
  });

  it("validates class strings", () => {
    expect(isAccountClass("bank")).toBe(true);
    expect(isAccountClass("offset")).toBe(false);
    expect(isAccountClass(null)).toBe(false);
  });

  it("treats only cash and bank as cash-like", () => {
    expect(ACCOUNT_CLASSES.filter((t) => isCashLike(t))).toEqual(["cash", "bank"]);
    expect(isCashLike(null)).toBe(false);
  });

  it("treats card, loan, payable and other liability as liabilities", () => {
    expect(ACCOUNT_CLASSES.filter((t) => isLiability(t))).toEqual(["credit-card", "loan", "payable", "other-liability"]);
    expect(isLiability(undefined)).toBe(false);
  });
});

describe("resolveAccountClass", () => {
  it("has no class with no entries", () => {
    expect(resolveAccountClass("a1", null, maps())).toEqual({ accountClass: null, source: "none" });
  });

  it("uses the account's own class", () => {
    expect(resolveAccountClass("a1", "g1", maps({ a1: "bank" }))).toEqual({ accountClass: "bank", source: "account" });
  });

  it("inherits the group class when the group has a class", () => {
    expect(resolveAccountClass("a1", "g1", maps({}, { g1: "credit-card" }))).toEqual({ accountClass: "credit-card", source: "group" });
  });

  it("lets a group with a class win over a stored account class", () => {
    expect(resolveAccountClass("a1", "g1", maps({ a1: "bank" }, { g1: "loan" }))).toEqual({ accountClass: "loan", source: "group" });
  });

  it("falls back to the account class when it leaves the typed group", () => {
    expect(resolveAccountClass("a1", null, maps({ a1: "bank" }, { g1: "loan" }))).toEqual({ accountClass: "bank", source: "account" });
  });

  it("ignores a group with no class", () => {
    expect(resolveAccountClass("a1", "g2", maps({}, { g1: "loan" }))).toEqual({ accountClass: null, source: "none" });
  });
});

describe("planGroupAccountClass", () => {
  it("sets the group and clears members that have their own class", () => {
    const plan = planGroupAccountClass("g1", "bank", ["a1", "a2", "a3"], maps({ a1: "cash", a3: "bank" }));
    expect(plan.cleared).toEqual([
      { id: "a1", accountClass: "cash" },
      { id: "a3", accountClass: "bank" },
    ]);
    expect(plan.changes).toEqual([
      { scope: "group", id: "g1", accountClass: "bank" },
      { scope: "account", id: "a1", accountClass: null },
      { scope: "account", id: "a3", accountClass: null },
    ]);
  });

  it("changes only the group when no member has its own class", () => {
    const plan = planGroupAccountClass("g1", "loan", ["a1"], maps());
    expect(plan.cleared).toEqual([]);
    expect(plan.changes).toEqual([{ scope: "group", id: "g1", accountClass: "loan" }]);
  });

  it("removing a group class clears nothing else", () => {
    const plan = planGroupAccountClass("g1", null, ["a1"], maps({ a1: "cash" }, { g1: "bank" }));
    expect(plan.cleared).toEqual([]);
    expect(plan.changes).toEqual([{ scope: "group", id: "g1", accountClass: null }]);
  });
});
