/**
 * Account class: Bench-owned metadata that says what kind of account something
 * is. It is separate from the `type` and `subtype` columns Actual keeps on its
 * own accounts (bank-sync metadata), and it never changes Actual's balances,
 * transactions, budget mode or transfers. Nothing here is written to Actual.
 *
 * A class is set on one account, or on an account group. A group's class wins:
 * its members show it as inherited and cannot change it. Safe to import from
 * client and server code (no I/O).
 */

export const ACCOUNT_CLASSES = [
  "bank",
  "cash",
  "savings",
  "fixed-deposit",
  "credit-card",
  "investment",
  "retirement",
  "property",
  "vehicle",
  "fixed-asset",
  "other-asset",
  "loan",
  "other-liability",
] as const;

export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export type AccountClassSide = "asset" | "liability";

/** The heading a class is listed under in the class picker, in this order. */
export const ACCOUNT_CLASS_HEADINGS = ["Everyday money", "Savings", "Credit", "Investments", "Things you own", "Debts"] as const;
export type AccountClassHeading = (typeof ACCOUNT_CLASS_HEADINGS)[number];

export type AccountClassInfo = {
  value: AccountClass;
  label: string;
  description: string;
  side: AccountClassSide;
  heading: AccountClassHeading;
};

export const ACCOUNT_CLASS_INFO: readonly AccountClassInfo[] = [
  { value: "bank", label: "Checking", description: "Checking, current, everyday and offset accounts", side: "asset", heading: "Everyday money" },
  { value: "cash", label: "Cash", description: "Notes, coins, cash wallets", side: "asset", heading: "Everyday money" },
  { value: "savings", label: "Savings", description: "Savings, high-yield, money market and notice accounts", side: "asset", heading: "Savings" },
  { value: "fixed-deposit", label: "Fixed Deposit", description: "Term deposits, CDs, restricted or pledged deposits", side: "asset", heading: "Savings" },
  { value: "credit-card", label: "Credit Card", description: "Credit cards, revolving credit used for spending", side: "liability", heading: "Credit" },
  { value: "investment", label: "Investment", description: "Stocks, ETFs, funds, crypto, brokerage accounts", side: "asset", heading: "Investments" },
  { value: "retirement", label: "Retirement", description: "Retirement accounts, pension funds, superannuation", side: "asset", heading: "Investments" },
  { value: "property", label: "Property", description: "Homes, land, real estate", side: "asset", heading: "Things you own" },
  { value: "vehicle", label: "Vehicle", description: "Cars, motorcycles, boats", side: "asset", heading: "Things you own" },
  { value: "fixed-asset", label: "Other Fixed Asset", description: "Gold, collectibles, jewellery, equipment: things you value in Assets", side: "asset", heading: "Things you own" },
  { value: "other-asset", label: "Other Asset", description: "Money owed to you, rental bonds, prepaid balances", side: "asset", heading: "Things you own" },
  { value: "loan", label: "Loan", description: "Mortgages, personal, auto, student loans, lines of credit", side: "liability", heading: "Debts" },
  { value: "other-liability", label: "Other Liability", description: "Taxes, other obligations", side: "liability", heading: "Debts" },
];

const INFO_BY_CLASS = new Map<AccountClass, AccountClassInfo>(ACCOUNT_CLASS_INFO.map((info) => [info.value, info]));

export function isAccountClass(value: unknown): value is AccountClass {
  return typeof value === "string" && (ACCOUNT_CLASSES as readonly string[]).includes(value);
}

/**
 * These balances belong outside Actual's spending budget. A Fixed deposit is locked money, which an on-budget account cannot be:
 * Actual would let you assign it. The Assets module accepts only off-budget accounts, so every fixed asset is off budget too.
 */
export function accountClassRequiresOffBudget(accountClass: AccountClass | null | undefined): boolean {
  return accountClass === "vehicle" || accountClass === "property" || accountClass === "fixed-asset" || accountClass === "fixed-deposit"
    || accountClass === "investment" || accountClass === "retirement" || accountClass === "loan";
}

/** A credit card's purchases must count as spending, so it belongs in the budget. */
export function accountClassRequiresOnBudget(accountClass: AccountClass | null | undefined): boolean {
  return accountClass === "credit-card";
}

/** Clearing a class is always allowed; Checking, Cash, Savings, Other Asset and Other Liability support either placement. */
export function isAccountClassAllowed(accountClass: AccountClass | null | undefined, offBudget: boolean): boolean {
  return !(offBudget ? accountClassRequiresOnBudget(accountClass) : accountClassRequiresOffBudget(accountClass));
}

/** A class for a set of accounts (a group, a bulk selection) must suit every placement among them. An empty set has no placement to disagree with. */
export function isAccountClassAllowedForSet(accountClass: AccountClass | null | undefined, set: { onBudget: boolean; offBudget: boolean }): boolean {
  return (!set.onBudget || isAccountClassAllowed(accountClass, false)) && (!set.offBudget || isAccountClassAllowed(accountClass, true));
}

export function accountClassLabel(accountClass: AccountClass): string {
  return INFO_BY_CLASS.get(accountClass)?.label ?? accountClass;
}

export function isLiability(accountClass: AccountClass | null | undefined): boolean {
  return !!accountClass && INFO_BY_CLASS.get(accountClass)?.side === "liability";
}

/** A thing you own, valued in the Assets module: Property, Vehicle or Other fixed asset. */
export function isFixedAssetClass(accountClass: AccountClass | null | undefined): boolean {
  return accountClass === "property" || accountClass === "vehicle" || accountClass === "fixed-asset";
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export type AccountClassScope = "account" | "group";

/** Where an account's effective class comes from. */
export type AccountClassSource = "account" | "group" | "none";

export type EffectiveAccountClass = { accountClass: AccountClass | null; source: AccountClassSource };

export type AccountClassMaps = {
  /** Explicit class per Actual account id. */
  accounts: ReadonlyMap<string, AccountClass>;
  /** Class per Actual account group id. */
  groups: ReadonlyMap<string, AccountClass>;
};

/**
 * A group with a class wins over the account's own class, which stays stored
 * but unused while the account is in that group, unless the own class is a
 * narrower kind of the group's (`refinesClass`). Otherwise the account's own
 * class applies; otherwise it has none.
 */
/**
 * Classes that are a narrower kind of another: a Savings or Fixed Deposit account is still a bank account, and an Other Fixed Asset
 * is still an Other Asset. An account's own narrower class applies inside a group of the broader class, as the Fixed / restricted
 * deposit and Fixed asset choices did before they became classes.
 */
const REFINES: Partial<Record<AccountClass, readonly AccountClass[]>> = {
  bank: ["savings", "fixed-deposit"],
  cash: ["savings"],
  "other-asset": ["fixed-asset"],
};

/** Whether `own` is a narrower kind of `group` (see `REFINES`). */
export function refinesClass(own: AccountClass | null | undefined, group: AccountClass | null | undefined): boolean {
  return !!own && !!group && (REFINES[group]?.includes(own) ?? false);
}

export function resolveAccountClass(
  accountId: string,
  groupId: string | null | undefined,
  maps: AccountClassMaps
): EffectiveAccountClass {
  const groupClass = groupId ? maps.groups.get(groupId) : undefined;
  const own = maps.accounts.get(accountId);
  if (groupClass && !refinesClass(own, groupClass)) return { accountClass: groupClass, source: "group" };
  if (own) return { accountClass: own, source: "account" };
  return { accountClass: null, source: "none" };
}

// ─── Changes ─────────────────────────────────────────────────────────────────

/** `accountClass: null` removes the class. */
export type AccountClassChange = { scope: AccountClassScope; id: string; accountClass: AccountClass | null };

export type GroupAccountClassPlan = {
  changes: AccountClassChange[];
  /** Members whose own class is cleared because the group class overrides it. */
  cleared: { id: string; accountClass: AccountClass }[];
};

/**
 * Setting a group class clears the explicit classes of its current members, so
 * the group's value is the only one that applies, except an own class that is a
 * narrower kind of it, which keeps applying. Removing a group class
 * changes nothing else. The caller shows `cleared` as a preview before applying.
 */
export function planGroupAccountClass(
  groupId: string,
  accountClass: AccountClass | null,
  memberIds: readonly string[],
  maps: AccountClassMaps
): GroupAccountClassPlan {
  const cleared: GroupAccountClassPlan["cleared"] = [];
  if (accountClass) {
    for (const id of memberIds) {
      const own = maps.accounts.get(id);
      // A narrower kind of the group's class (a Fixed Deposit in a Checking group) still applies, so it is kept.
      if (own && !refinesClass(own, accountClass)) cleared.push({ id, accountClass: own });
    }
  }
  return {
    changes: [
      { scope: "group", id: groupId, accountClass },
      ...cleared.map((c): AccountClassChange => ({ scope: "account", id: c.id, accountClass: null })),
    ],
    cleared,
  };
}
