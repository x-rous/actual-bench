import { ACCOUNT_FLAGS, flagAllowed, GROUP_FLAGS, hasFlag, isAccountFlag, isExcluded, type AccountFlagMaps } from "./flags";
import { ACCOUNT_CLASSES } from "./index";

describe("account flags", () => {
  it("knows exactly three flags, and only Excluded can be set on a group", () => {
    expect([...ACCOUNT_FLAGS]).toEqual(["excluded", "accessible", "offbudget-income"]);
    expect([...GROUP_FLAGS]).toEqual(["excluded"]);
    expect(isAccountFlag("accessible")).toBe(true);
    expect(isAccountFlag("nope")).toBe(false);
  });

  it("allows Excluded on any off-budget account and no on-budget one", () => {
    for (const c of ACCOUNT_CLASSES) {
      expect(flagAllowed("excluded", c, true, null)).toBe(true);
      expect(flagAllowed("excluded", c, false, null)).toBe(false);
    }
    expect(flagAllowed("excluded", null, true, null)).toBe(true);
  });

  it("allows Accessible money on Investment, and on an Other Asset that is not a fixed asset", () => {
    expect(flagAllowed("accessible", "investment", true, null)).toBe(true);
    expect(flagAllowed("accessible", "other-asset", true, null)).toBe(true);
    expect(flagAllowed("accessible", "other-asset", false, null)).toBe(true);
    expect(flagAllowed("accessible", "other-asset", true, "fixed-asset")).toBe(false);
    for (const c of ACCOUNT_CLASSES.filter((c) => c !== "investment" && c !== "other-asset")) expect(flagAllowed("accessible", c, true, null)).toBe(false);
  });

  it("allows the off-budget income flag on off-budget Cash and Bank only", () => {
    expect(flagAllowed("offbudget-income", "cash", true, null)).toBe(true);
    expect(flagAllowed("offbudget-income", "bank", true, "fixed-deposit")).toBe(true);
    expect(flagAllowed("offbudget-income", "bank", false, null)).toBe(false);
    expect(flagAllowed("offbudget-income", "investment", true, null)).toBe(false);
  });

  const maps = (accounts: Partial<Record<"excluded" | "accessible" | "offbudget-income", string[]>>, groups: string[] = []): AccountFlagMaps => ({
    accounts: new Map(Object.entries(accounts).map(([flag, ids]) => [flag as "excluded", new Set(ids)])),
    groups: new Set(groups),
  });

  it("excludes an account by its own flag or by its group's", () => {
    const m = maps({ excluded: ["a"] }, ["g"]);
    expect(isExcluded("a", null, m)).toBe(true);
    expect(isExcluded("b", "g", m)).toBe(true);
    expect(isExcluded("b", "other", m)).toBe(false);
    expect(isExcluded("b", null, m)).toBe(false);
  });

  it("counts a saved account flag only while it is still allowed, and never deletes it", () => {
    const m = maps({ accessible: ["a"], "offbudget-income": ["a"] });
    expect(hasFlag("accessible", "a", "investment", true, null, m)).toBe(true);
    // The class changed: the flag is still saved, but it no longer counts.
    expect(hasFlag("accessible", "a", "loan", true, null, m)).toBe(false);
    expect(hasFlag("accessible", "a", "other-asset", true, "fixed-asset", m)).toBe(false);
    expect(hasFlag("offbudget-income", "a", "bank", true, null, m)).toBe(true);
    expect(hasFlag("offbudget-income", "a", "bank", false, null, m)).toBe(false);
    expect(hasFlag("accessible", "b", "investment", true, null, m)).toBe(false);
  });
});
