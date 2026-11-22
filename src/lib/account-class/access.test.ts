import { accessFlagChanges, accessOf, classHasAccess, countsUncategorizedInAsIncome, defaultAccess, isCashEquivalentRung, rungOf } from "./access";
import { ACCOUNT_CLASSES } from "./index";

const none = { accessible: false, locked: false };

describe("access", () => {
  it("gives a default only to classes whose money can be available or locked", () => {
    expect(ACCOUNT_CLASSES.filter(classHasAccess)).toEqual(["bank", "cash", "savings", "fixed-deposit", "investment", "retirement", "other-asset"]);
    expect(ACCOUNT_CLASSES.filter((c) => defaultAccess(c, true) === "available")).toEqual(["bank", "cash", "savings"]);
    expect(ACCOUNT_CLASSES.filter((c) => defaultAccess(c, true) === "locked")).toEqual(["fixed-deposit", "investment", "retirement", "other-asset"]);
    expect(defaultAccess("property", true)).toBeNull();
    expect(defaultAccess(null, false)).toBeNull();
  });

  it("is always available on budget, whatever is saved", () => {
    expect(accessOf("other-asset", false, none)).toBe("available");
    expect(accessOf("savings", false, { accessible: false, locked: true })).toBe("available");
    expect(accessOf("credit-card", false, none)).toBeNull();
  });

  it("follows the user's choice off budget, and only the override against the default counts", () => {
    expect(accessOf("savings", true, none)).toBe("available");
    expect(accessOf("savings", true, { accessible: false, locked: true })).toBe("locked");
    expect(accessOf("savings", true, { accessible: true, locked: false })).toBe("available");
    expect(accessOf("retirement", true, none)).toBe("locked");
    expect(accessOf("retirement", true, { accessible: true, locked: false })).toBe("available");
    expect(accessOf("fixed-deposit", true, { accessible: false, locked: true })).toBe("locked");
  });

  it("writes the one override that differs from the default, and clears the other", () => {
    expect(accessFlagChanges("savings", "locked")).toEqual({ accessible: false, locked: true });
    expect(accessFlagChanges("savings", "available")).toEqual({ accessible: false, locked: false });
    expect(accessFlagChanges("investment", "available")).toEqual({ accessible: true, locked: false });
    expect(accessFlagChanges("investment", "locked")).toEqual({ accessible: false, locked: false });
  });

  it("puts every class on one rung", () => {
    expect(rungOf("bank", "available")).toBe("cash");
    expect(rungOf("cash", "locked")).toBe("locked");
    expect(rungOf("savings", "available")).toBe("savings");
    expect(rungOf("fixed-deposit", "locked")).toBe("locked");
    expect(rungOf("investment", "available")).toBe("reachable");
    expect(rungOf("other-asset", "locked")).toBe("locked");
    expect(rungOf("fixed-asset", null)).toBe("owned");
    expect(rungOf("credit-card", null)).toBe("card");
    expect(rungOf("other-liability", null)).toBe("debt");
    expect(["cash", "savings", "reachable", "locked"].filter((r) => isCashEquivalentRung(r as never))).toEqual(["cash", "savings"]);
  });

  it("counts uncategorized money in as income only in off-budget Savings and Fixed Deposits", () => {
    expect(ACCOUNT_CLASSES.filter((c) => countsUncategorizedInAsIncome(c, true))).toEqual(["savings", "fixed-deposit"]);
    expect(countsUncategorizedInAsIncome("savings", false)).toBe(false);
  });
});
