import {
  ACCOUNT_CLASSES,
  ACCOUNT_CLASS_HEADINGS,
  ACCOUNT_CLASS_INFO,
  accountClassRequiresOnBudget,
  isAccountClass,
  isAccountClassAllowed,
  isLiability,
  planGroupAccountClass,
  refinesClass,
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
    expect(ACCOUNT_CLASSES).toEqual([
      "bank", "cash", "savings", "fixed-deposit", "credit-card", "investment", "retirement",
      "property", "vehicle", "fixed-asset", "other-asset", "loan", "other-liability",
    ]);
    // Every class sits under one of the picker's headings, in heading order.
    const order = ACCOUNT_CLASS_INFO.map((i) => ACCOUNT_CLASS_HEADINGS.indexOf(i.heading));
    expect(order.every((h, i) => h >= 0 && (i === 0 || h >= order[i - 1]))).toBe(true);
    // Excluded is a flag now, not a class.
    expect(isAccountClass("excluded")).toBe(false);
  });

  it("validates class strings", () => {
    expect(isAccountClass("bank")).toBe(true);
    expect(isAccountClass("retirement")).toBe(true);
    expect(isAccountClass("offset")).toBe(false);
    expect(isAccountClass(null)).toBe(false);
    expect(isAccountClass("receivable")).toBe(false);
    expect(isAccountClass("payable")).toBe(false);
  });

  it("treats card, loan and other liability as liabilities", () => {
    expect(ACCOUNT_CLASSES.filter((t) => isLiability(t))).toEqual(["credit-card", "loan", "other-liability"]);
    expect(isLiability(undefined)).toBe(false);
  });

  it("requires off-budget placement for fixed deposits, investments, retirement, fixed assets and loans, and on-budget placement for a credit card", () => {
    expect(ACCOUNT_CLASSES.filter((t) => !isAccountClassAllowed(t, false)))
      .toEqual(["fixed-deposit", "investment", "retirement", "property", "vehicle", "fixed-asset", "loan"]);
    expect(ACCOUNT_CLASSES.filter((t) => !isAccountClassAllowed(t, true))).toEqual(["credit-card"]);
    expect(accountClassRequiresOnBudget("credit-card")).toBe(true);
    expect(accountClassRequiresOnBudget("bank")).toBe(false);
    expect(isAccountClassAllowed(null, false)).toBe(true);
    expect(isAccountClassAllowed(null, true)).toBe(true);
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

  it("keeps an account's own narrower class inside a group of the broader class, and only then", () => {
    const m = maps({ dep: "fixed-deposit", sav: "savings", gold: "fixed-asset", inv: "investment" }, { banks: "bank", wallets: "cash", things: "other-asset" });
    expect(resolveAccountClass("dep", "banks", m)).toEqual({ accountClass: "fixed-deposit", source: "account" });
    expect(resolveAccountClass("sav", "wallets", m)).toEqual({ accountClass: "savings", source: "account" });
    expect(resolveAccountClass("gold", "things", m)).toEqual({ accountClass: "fixed-asset", source: "account" });
    // Not a narrower kind of the group's class: the group wins.
    expect(resolveAccountClass("inv", "banks", m)).toEqual({ accountClass: "bank", source: "group" });
    expect(resolveAccountClass("dep", "things", m)).toEqual({ accountClass: "other-asset", source: "group" });
    expect(refinesClass("savings", "bank")).toBe(true);
    expect(refinesClass("bank", "savings")).toBe(false);
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

  it("keeps a member's own class that is a narrower kind of the group's", () => {
    const plan = planGroupAccountClass("g1", "bank", ["a1", "a2"], maps({ a1: "fixed-deposit", a2: "investment" }));
    expect(plan.cleared).toEqual([{ id: "a2", accountClass: "investment" }]);
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
