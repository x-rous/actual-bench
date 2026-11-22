import type { AccountClass } from "./index";

/**
 * Access: whether the user can use an account's money now. Bench-owned, like the class; it never changes Actual. Safe to import from
 * client and server code (no I/O).
 *
 * An on-budget account is always available: Actual lets you assign its money. An off-budget account takes its class's default,
 * unless the user chose otherwise (the `accessible` and `locked` flags, see `flags.ts`). Cards, things you own and debts have no
 * access: a card's owed amount comes off cash, a thing you own is used by selling it, and a debt is not money you hold.
 */
export type Access = "available" | "locked";

const DEFAULT_ACCESS: Partial<Record<AccountClass, Access>> = {
  bank: "available",
  cash: "available",
  savings: "available",
  "fixed-deposit": "locked",
  investment: "locked",
  retirement: "locked",
  "other-asset": "locked",
};

/** Whether the class's money can be available or locked at all. */
export function classHasAccess(accountClass: AccountClass | null | undefined): accountClass is AccountClass {
  return !!accountClass && accountClass in DEFAULT_ACCESS;
}

/** The access an account of this class has when the user has not chosen; null when the class has no access. */
export function defaultAccess(accountClass: AccountClass | null | undefined, offBudget: boolean): Access | null {
  if (!classHasAccess(accountClass)) return null;
  return offBudget ? DEFAULT_ACCESS[accountClass]! : "available";
}

/** The user's saved overrides: `accessible` turns a locked default available, `locked` turns an available default locked. */
export type AccessOverrides = { accessible: boolean; locked: boolean };

/** Whether the user can change the access of this account: off budget, and a class that has access. */
export function accessChoosable(accountClass: AccountClass | null | undefined, offBudget: boolean): boolean {
  return offBudget && classHasAccess(accountClass);
}

/** The access that applies. A saved override counts only while the account is off budget; on budget it is kept but not applied. */
export function accessOf(accountClass: AccountClass | null | undefined, offBudget: boolean, overrides: AccessOverrides): Access | null {
  const fallback = defaultAccess(accountClass, offBudget);
  if (!fallback || !offBudget) return fallback;
  if (fallback === "available") return overrides.locked ? "locked" : "available";
  return overrides.accessible ? "available" : "locked";
}

/**
 * The flag changes that make an account's access `next`: the override that differs from the class default is set, the other is
 * cleared. Both flags are always written, so a stale override from an earlier class cannot linger.
 */
export function accessFlagChanges(accountClass: AccountClass, next: Access): { accessible: boolean; locked: boolean } {
  const fallback = DEFAULT_ACCESS[accountClass] ?? "available";
  return { accessible: next === "available" && fallback === "locked", locked: next === "locked" && fallback === "available" };
}

// ─── Rungs ───────────────────────────────────────────────────────────────────

/**
 * How an account's balance counts as money, in one place for every feature:
 *  - `cash`: Checking and Cash you can use now;
 *  - `savings`: Savings and Fixed Deposits you can use now;
 *  - `reachable`: Investment, Retirement and Other Asset accounts you can use now (the cash buffer's second figure, never its headline);
 *  - `locked`: any of the above that you cannot use now;
 *  - `owned`: things you own (Property, Vehicle, Other Fixed Asset), used only by selling them;
 *  - `card`: credit cards, whose owed amount comes off cash;
 *  - `debt`: loans and other liabilities.
 */
export type Rung = "cash" | "savings" | "reachable" | "locked" | "owned" | "card" | "debt";

export function rungOf(accountClass: AccountClass, access: Access | null): Rung {
  switch (accountClass) {
    case "bank":
    case "cash": return access === "locked" ? "locked" : "cash";
    case "savings":
    case "fixed-deposit": return access === "available" ? "savings" : "locked";
    case "investment":
    case "retirement":
    case "other-asset": return access === "available" ? "reachable" : "locked";
    case "property":
    case "vehicle":
    case "fixed-asset": return "owned";
    case "credit-card": return "card";
    case "loan":
    case "other-liability": return "debt";
  }
}

/** Cash and cash equivalents: Checking, Cash, Savings and Fixed Deposits you can use now. */
export const isCashEquivalentRung = (rung: Rung): boolean => rung === "cash" || rung === "savings";

/** In an off-budget Savings or Fixed Deposit account, uncategorized money in is income: interest, in practice. */
export function countsUncategorizedInAsIncome(accountClass: AccountClass | null | undefined, offBudget: boolean): boolean {
  return offBudget && (accountClass === "savings" || accountClass === "fixed-deposit");
}

/** Plain words for an access, for tables and tooltips. */
export const ACCESS_LABEL: Record<Access, string> = { available: "Available now", locked: "Locked" };
