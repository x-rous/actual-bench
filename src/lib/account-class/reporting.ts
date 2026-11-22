import { isAccountClassAllowed, type AccountClass } from "./index";

/**
 * Readiness for Financial Insights: every account needs a class, and a placement the class accepts. Safe to import from client and
 * server code (no I/O). How an account then counts is decided by its class and its access (see `access.ts`); earlier versions also
 * saved a Financial Reporting "treatment" per account, which migration v68 folded into the Fixed Deposit and Other Fixed Asset classes.
 */

// ─── Readiness ───────────────────────────────────────────────────────────────

export type AccountReadinessStatus = "ready" | "needs-class" | "incompatible-placement";

export type ReadinessAccount = { id: string; offBudget: boolean; closed: boolean };

/** Per account: how many transactions it has ever had, and their sum. Only needed for closed accounts. */
export type AccountActivity = { count: number; balanceMinor: number };

export type AccountReadiness = { accountId: string; status: AccountReadinessStatus };

export type ReadinessSummary = {
  accounts: AccountReadiness[];
  /** Accounts that are not ready. */
  attention: number;
  ready: boolean;
};

/**
 * Every account must have a class (its own, or its group's) and a placement the class accepts. An account that is excluded from
 * Financial Insights needs neither a class nor a choice, but it must be off budget: an excluded on-budget account would hide
 * spending, so it is not ready. A closed account with no transactions and a zero balance is exempt: nothing about it can
 * reach a report. Closed accounts with history must be classified.
 *
 * `classOf` holds each account's effective class (see `resolveAccountClass`) and `excluded` the effective excluded set (the
 * account's own flag or its group's). `closedActivity` should hold an entry for every closed account; a closed
 * account without one is treated as having history, so a missing read never unlocks.
 */
export function evaluateAccountReadiness(input: {
  accounts: readonly ReadinessAccount[];
  classOf: ReadonlyMap<string, AccountClass | null>;
  excluded: ReadonlySet<string>;
  closedActivity: ReadonlyMap<string, AccountActivity>;
}): ReadinessSummary {
  const accounts = input.accounts.map((account): AccountReadiness => {
    const status = (s: AccountReadinessStatus): AccountReadiness => ({ accountId: account.id, status: s });
    if (account.closed) {
      const activity = input.closedActivity.get(account.id);
      if (activity && activity.count === 0 && activity.balanceMinor === 0) return status("ready");
    }
    if (input.excluded.has(account.id)) return status(account.offBudget ? "ready" : "incompatible-placement");
    const accountClass = input.classOf.get(account.id) ?? null;
    if (!accountClass) return status("needs-class");
    if (!isAccountClassAllowed(accountClass, account.offBudget)) return status("incompatible-placement");
    return status("ready");
  });
  const attention = accounts.filter((a) => a.status !== "ready").length;
  return { accounts, attention, ready: attention === 0 };
}
