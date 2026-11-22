import { ACCOUNT_FLAGS, accessOverrides, flagAllowed, GROUP_FLAGS, hasFlag, isAccountFlag, isExcluded, type AccountFlagMaps } from "./flags";
import { ACCOUNT_CLASSES } from "./index";

describe("account flags", () => {
  it("knows exactly three flags, and only Excluded can be set on a group; the retired off-budget income flag is unknown", () => {
    expect([...ACCOUNT_FLAGS]).toEqual(["excluded", "accessible", "locked"]);
    expect([...GROUP_FLAGS]).toEqual(["excluded"]);
    expect(isAccountFlag("locked")).toBe(true);
    expect(isAccountFlag("offbudget-income")).toBe(false);
  });

  it("allows Excluded on any off-budget account and no on-budget one", () => {
    for (const c of ACCOUNT_CLASSES) {
      expect(flagAllowed("excluded", c, true)).toBe(true);
      expect(flagAllowed("excluded", c, false)).toBe(false);
    }
    expect(flagAllowed("excluded", null, true)).toBe(true);
  });

  it("allows Accessible only against a locked default, and Locked only against an available one, off budget", () => {
    expect(ACCOUNT_CLASSES.filter((c) => flagAllowed("accessible", c, true))).toEqual(["fixed-deposit", "investment", "retirement", "other-asset"]);
    expect(ACCOUNT_CLASSES.filter((c) => flagAllowed("locked", c, true))).toEqual(["bank", "cash", "savings"]);
    for (const c of ACCOUNT_CLASSES) {
      expect(flagAllowed("accessible", c, false)).toBe(false);
      expect(flagAllowed("locked", c, false)).toBe(false);
    }
  });

  const maps = (accounts: Partial<Record<"excluded" | "accessible" | "locked", string[]>>, groups: string[] = []): AccountFlagMaps => ({
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
    const m = maps({ accessible: ["a"], locked: ["a"] });
    expect(hasFlag("accessible", "a", "investment", true, m)).toBe(true);
    // The class or the placement changed: the flag is still saved, but it no longer counts.
    expect(hasFlag("accessible", "a", "loan", true, m)).toBe(false);
    expect(hasFlag("accessible", "a", "investment", false, m)).toBe(false);
    expect(accessOverrides("a", "savings", true, m)).toEqual({ accessible: false, locked: true });
    expect(accessOverrides("a", "fixed-deposit", true, m)).toEqual({ accessible: true, locked: false });
    expect(hasFlag("accessible", "b", "investment", true, m)).toBe(false);
  });
});

describe("isExcluded when the class comes from the group", () => {
  const maps = { accounts: new Map([["excluded" as const, new Set(["a"])]]), groups: new Set(["g"]) };
  it("ignores the account's own flag but not the group's", () => {
    expect(isExcluded("a", "x", maps)).toBe(true);
    expect(isExcluded("a", "x", maps, true)).toBe(false);
    expect(isExcluded("a", "g", maps, true)).toBe(true);
  });
});
