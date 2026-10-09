import { ACCOUNT_CLASSES } from "@/lib/account-class";
import type { StagedMap } from "@/types/staged";
import type { Account } from "@/types/entities";
import { ACCOUNT_CLASS_ICONS } from "./accountClassIcons";
import { effectiveAccountClasses } from "./accountClasses";

const entry = (entity: Account) => ({ entity, original: entity, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} });
const staged: StagedMap<Account> = {
  a1: entry({ id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" }),
  a2: entry({ id: "a2", name: "Wallet", offBudget: false, closed: false, groupId: null }),
  a3: entry({ id: "a3", name: "Old", offBudget: false, closed: false, groupId: "deleted-group" }),
};
const maps = { accounts: new Map([["a2", "cash" as const], ["a3", "loan" as const]]), groups: new Map([["g1", "bank" as const], ["deleted-group", "credit-card" as const]]) };

describe("effectiveAccountClasses", () => {
  it("inherits a live group's class and uses an account's own class otherwise", () => {
    const result = effectiveAccountClasses(staged, [{ id: "g1", name: "Everyday" }], maps);
    expect(result.get("a1")).toEqual({ accountClass: "bank", source: "group" });
    expect(result.get("a2")).toEqual({ accountClass: "cash", source: "account" });
  });

  it("ignores the class of a group that no longer exists", () => {
    const result = effectiveAccountClasses(staged, [{ id: "g1", name: "Everyday" }], maps);
    expect(result.get("a3")).toEqual({ accountClass: "loan", source: "account" });
  });

  it("inherits nothing on a server without account groups", () => {
    const result = effectiveAccountClasses(staged, undefined, maps);
    expect(result.get("a1")).toEqual({ accountClass: null, source: "none" });
  });
});

describe("account class icons", () => {
  it("has an icon for every class", () => {
    for (const accountClass of ACCOUNT_CLASSES) expect(ACCOUNT_CLASS_ICONS[accountClass]).toBeDefined();
  });
});
