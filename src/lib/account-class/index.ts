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
  "cash",
  "bank",
  "investment",
  "property",
  "vehicle",
  "receivable",
  "other-asset",
  "credit-card",
  "loan",
  "payable",
  "other-liability",
] as const;

export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export type AccountClassSide = "asset" | "liability";

export type AccountClassInfo = {
  value: AccountClass;
  label: string;
  description: string;
  side: AccountClassSide;
};

export const ACCOUNT_CLASS_INFO: readonly AccountClassInfo[] = [
  { value: "cash", label: "Cash", description: "Notes, coins, cash wallets", side: "asset" },
  { value: "bank", label: "Bank", description: "Checking, savings, deposits, offset accounts", side: "asset" },
  { value: "investment", label: "Investment", description: "Stocks, ETFs, crypto, retirement, superannuation", side: "asset" },
  { value: "property", label: "Property", description: "Homes, land, real estate", side: "asset" },
  { value: "vehicle", label: "Vehicle", description: "Cars, motorcycles, boats", side: "asset" },
  { value: "receivable", label: "Receivable", description: "Money others owe you", side: "asset" },
  { value: "other-asset", label: "Other Asset", description: "Gold, insurance value, collectibles", side: "asset" },
  { value: "credit-card", label: "Credit Card", description: "Credit cards, revolving credit", side: "liability" },
  { value: "loan", label: "Loan", description: "Mortgages, personal, auto, student loans", side: "liability" },
  { value: "payable", label: "Payable", description: "Money you owe to others", side: "liability" },
  { value: "other-liability", label: "Other Liability", description: "Taxes, other obligations", side: "liability" },
];

const INFO_BY_CLASS = new Map<AccountClass, AccountClassInfo>(ACCOUNT_CLASS_INFO.map((info) => [info.value, info]));

export function isAccountClass(value: unknown): value is AccountClass {
  return typeof value === "string" && (ACCOUNT_CLASSES as readonly string[]).includes(value);
}

export function accountClassLabel(accountClass: AccountClass): string {
  return INFO_BY_CLASS.get(accountClass)?.label ?? accountClass;
}

/** Spendable-cash classes: the default scope for cashflow planning (together with budget mode). */
export function isCashLike(accountClass: AccountClass | null | undefined): boolean {
  return accountClass === "cash" || accountClass === "bank";
}

export function isLiability(accountClass: AccountClass | null | undefined): boolean {
  return !!accountClass && INFO_BY_CLASS.get(accountClass)?.side === "liability";
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
 * but unused while the account is in that group. Otherwise the account's own
 * class applies; otherwise it has none.
 */
export function resolveAccountClass(
  accountId: string,
  groupId: string | null | undefined,
  maps: AccountClassMaps
): EffectiveAccountClass {
  const groupClass = groupId ? maps.groups.get(groupId) : undefined;
  if (groupClass) return { accountClass: groupClass, source: "group" };
  const own = maps.accounts.get(accountId);
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
 * the group's value is the only one that applies. Removing a group class
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
      if (own) cleared.push({ id, accountClass: own });
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
