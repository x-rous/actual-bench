import { validSavedTreatment, type ReportingTreatment } from "./reporting";
import type { AccountClass } from "./index";

/**
 * Account flags: yes/no choices Bench saves next to an account's class, never written to Actual. Safe to import from client and server code (no I/O).
 *  - `excluded`: leave the account out of Financial Insights (off-budget accounts only; also settable on a group).
 *  - `accessible`: count the account's balance as money you can reach (Investment, or an Other Asset that is not a fixed asset).
 *  - `offbudget-income`: count uncategorized money in, in an off-budget Cash or Bank account, as income (interest, for example).
 */
export const ACCOUNT_FLAGS = ["excluded", "accessible", "offbudget-income"] as const;
export type AccountFlag = (typeof ACCOUNT_FLAGS)[number];

/** The flags that can be set on a group of accounts; the others are about one account's own balance and entries. */
export const GROUP_FLAGS = ["excluded"] as const satisfies readonly AccountFlag[];

export function isAccountFlag(value: unknown): value is AccountFlag {
  return typeof value === "string" && (ACCOUNT_FLAGS as readonly string[]).includes(value);
}

export type AccountFlagScope = "account" | "group";

/** Whether `flag` can apply to an account of this class and placement. A saved flag counts only while this holds; it is never deleted automatically. */
export function flagAllowed(flag: AccountFlag, accountClass: AccountClass | null | undefined, offBudget: boolean, treatment: ReportingTreatment | null | undefined): boolean {
  switch (flag) {
    case "excluded": return offBudget;
    case "accessible": return accountClass === "investment" || (accountClass === "other-asset" && validSavedTreatment(accountClass, treatment) !== "fixed-asset");
    case "offbudget-income": return offBudget && (accountClass === "cash" || accountClass === "bank");
  }
}

export type AccountFlagMaps = {
  /** Account ids with a saved flag, per flag. */
  accounts: ReadonlyMap<AccountFlag, ReadonlySet<string>>;
  /** Group ids with the `excluded` flag. */
  groups: ReadonlySet<string>;
};

/** Excluded when the account's own flag is on, or the flag of its group (a live group, if the account is in one). Whether it is allowed is the gate's business. */
export function isExcluded(accountId: string, groupId: string | null | undefined, maps: AccountFlagMaps): boolean {
  return !!(groupId && maps.groups.has(groupId)) || !!maps.accounts.get("excluded")?.has(accountId);
}

/** An account-only flag counts when saved and still allowed for the account's class, placement and treatment. */
export function hasFlag(flag: Exclude<AccountFlag, "excluded">, accountId: string, accountClass: AccountClass | null | undefined, offBudget: boolean, treatment: ReportingTreatment | null | undefined, maps: AccountFlagMaps): boolean {
  return !!maps.accounts.get(flag)?.has(accountId) && flagAllowed(flag, accountClass, offBudget, treatment);
}

/** One saved flag change. */
export type AccountFlagChange = { scope: AccountFlagScope; id: string; flag: AccountFlag; on: boolean };
