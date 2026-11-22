import { classHasAccess, defaultAccess } from "./access";
import type { AccountClass } from "./index";

/**
 * Account flags: yes/no choices Bench saves next to an account's class, never written to Actual. Safe to import from client and server code (no I/O).
 *  - `excluded`: leave the account out of reports (Financial Insights, and Cashflow's automatic roles). Off-budget accounts only; also settable on a group.
 *  - `accessible`: an off-budget account whose class is locked by default (Fixed Deposit, Investment, Retirement, Other Asset) is available now.
 *  - `locked`: an off-budget account whose class is available by default (Checking, Cash, Savings) is locked.
 *
 * Earlier versions also saved `offbudget-income`. An off-budget Savings or Fixed Deposit account now counts uncategorized money in as
 * income by itself, and migration v68 moved the accounts that had the flag to Savings; old rows are left in place and skipped on read.
 */
export const ACCOUNT_FLAGS = ["excluded", "accessible", "locked"] as const;
export type AccountFlag = (typeof ACCOUNT_FLAGS)[number];

/** The flags that can be set on a group of accounts; the others are about one account's own balance. */
export const GROUP_FLAGS = ["excluded"] as const satisfies readonly AccountFlag[];

export function isAccountFlag(value: unknown): value is AccountFlag {
  return typeof value === "string" && (ACCOUNT_FLAGS as readonly string[]).includes(value);
}

export type AccountFlagScope = "account" | "group";

/** Whether `flag` can apply to an account of this class and placement. A saved flag counts only while this holds; it is never deleted automatically. */
export function flagAllowed(flag: AccountFlag, accountClass: AccountClass | null | undefined, offBudget: boolean): boolean {
  switch (flag) {
    case "excluded": return offBudget;
    case "accessible": return offBudget && classHasAccess(accountClass) && defaultAccess(accountClass, true) === "locked";
    case "locked": return offBudget && classHasAccess(accountClass) && defaultAccess(accountClass, true) === "available";
  }
}

export type AccountFlagMaps = {
  /** Account ids with a saved flag, per flag. */
  accounts: ReadonlyMap<AccountFlag, ReadonlySet<string>>;
  /** Group ids with the `excluded` flag. */
  groups: ReadonlySet<string>;
};

/**
 * Excluded when the flag of the account's group is on (a live group, if the account is in one), or its own flag is. When the account takes
 * its class from its group (`classFromGroup`), its own flag is kept but does not apply, as its own class never did: the group decides.
 * Whether it is allowed is the gate's business.
 */
export function isExcluded(accountId: string, groupId: string | null | undefined, maps: AccountFlagMaps, classFromGroup = false): boolean {
  if (groupId && maps.groups.has(groupId)) return true;
  return !classFromGroup && !!maps.accounts.get("excluded")?.has(accountId);
}

/** An account-only flag counts when saved and still allowed for the account's class and placement. */
export function hasFlag(flag: Exclude<AccountFlag, "excluded">, accountId: string, accountClass: AccountClass | null | undefined, offBudget: boolean, maps: AccountFlagMaps): boolean {
  return !!maps.accounts.get(flag)?.has(accountId) && flagAllowed(flag, accountClass, offBudget);
}

/** The saved access overrides of one account, as `accessOf` takes them. */
export function accessOverrides(accountId: string, accountClass: AccountClass | null | undefined, offBudget: boolean, maps: AccountFlagMaps) {
  return { accessible: hasFlag("accessible", accountId, accountClass, offBudget, maps), locked: hasFlag("locked", accountId, accountClass, offBudget, maps) };
}

/** One saved flag change. */
export type AccountFlagChange = { scope: AccountFlagScope; id: string; flag: AccountFlag; on: boolean };
