import { isAccountClassAllowed, type AccountClass } from "./index";

/**
 * Financial Reporting: how an account counts in Financial Insights, next to its
 * class. Bench-owned metadata, like the class: it never changes Actual's
 * balances, transactions, budget placement or transfers. Safe to import from
 * client and server code (no I/O).
 *
 * Most classes have one fixed treatment. Three need the user to choose, because
 * the class alone does not say whether the account is short-term or long-term.
 * A Bank account is a cash equivalent unless the user marks it as a fixed or
 * restricted deposit.
 */

export const REPORTING_TREATMENTS = [
  "current-investment",
  "non-current-investment",
  "current-asset",
  "non-current-asset",
  "current-liability",
  "non-current-liability",
  /** A Bank deposit that cannot readily be withdrawn: still an asset and in net worth, but not cash. */
  "fixed-deposit",
] as const;

export type ReportingTreatment = (typeof REPORTING_TREATMENTS)[number];

export function isReportingTreatment(value: unknown): value is ReportingTreatment {
  return typeof value === "string" && (REPORTING_TREATMENTS as readonly string[]).includes(value);
}

export const REPORTING_LABELS: Record<ReportingTreatment | "cash-equivalent" | "loan-liability", string> = {
  "current-investment": "Current investment",
  "non-current-investment": "Non-current investment",
  "current-asset": "Current asset",
  "non-current-asset": "Non-current asset",
  "current-liability": "Current liability",
  "non-current-liability": "Non-current liability",
  "fixed-deposit": "Fixed / restricted deposit",
  "cash-equivalent": "Cash & cash equivalents",
  "loan-liability": "Loan liability",
};

/** What the user is asked for, per class. */
export type ReportingRequirement =
  | { kind: "automatic"; label: string }
  /** The user must pick one of `options` before the account counts as ready. */
  | { kind: "required"; options: readonly ReportingTreatment[] }
  /** Cash equivalent by default; the user may mark the account as a fixed / restricted deposit. */
  | { kind: "bank-default"; label: string };

const NON_CURRENT_ASSET: ReportingRequirement = { kind: "automatic", label: REPORTING_LABELS["non-current-asset"] };

const REQUIREMENTS: Record<AccountClass, ReportingRequirement> = {
  cash: { kind: "automatic", label: REPORTING_LABELS["cash-equivalent"] },
  bank: { kind: "bank-default", label: REPORTING_LABELS["cash-equivalent"] },
  vehicle: NON_CURRENT_ASSET,
  property: NON_CURRENT_ASSET,
  investment: { kind: "required", options: ["current-investment", "non-current-investment"] },
  retirement: NON_CURRENT_ASSET,
  "other-asset": { kind: "required", options: ["current-asset", "non-current-asset"] },
  "credit-card": { kind: "automatic", label: REPORTING_LABELS["current-liability"] },
  loan: { kind: "automatic", label: REPORTING_LABELS["loan-liability"] },
  "other-liability": { kind: "required", options: ["current-liability", "non-current-liability"] },
  excluded: { kind: "automatic", label: "Excluded from Financial Insights" },
};

export function reportingRequirement(accountClass: AccountClass): ReportingRequirement {
  return REQUIREMENTS[accountClass];
}

/** The treatments the class accepts as a saved choice. */
function acceptedTreatments(accountClass: AccountClass): readonly ReportingTreatment[] {
  const requirement = REQUIREMENTS[accountClass];
  if (requirement.kind === "required") return requirement.options;
  if (requirement.kind === "bank-default") return ["fixed-deposit"];
  return [];
}

/** A saved choice counts only while the account's class still accepts it. */
export function validSavedTreatment(accountClass: AccountClass, saved: ReportingTreatment | null | undefined): ReportingTreatment | null {
  return saved && acceptedTreatments(accountClass).includes(saved) ? saved : null;
}

/**
 * Cash and Bank count as cash equivalents, on or off budget; a Bank account marked as a fixed / restricted
 * deposit does not. Nothing else does, however quickly it can be sold.
 */
export function isCashEquivalent(accountClass: AccountClass, saved: ReportingTreatment | null | undefined): boolean {
  if (accountClass === "cash") return true;
  return accountClass === "bank" && validSavedTreatment(accountClass, saved) !== "fixed-deposit";
}

// ─── Readiness ───────────────────────────────────────────────────────────────

export type AccountReadinessStatus = "ready" | "needs-class" | "needs-choice" | "incompatible-placement";

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
 * Every account must have a class (its own, or its group's) and, for Investment,
 * Other Asset and Other Liability, a saved choice the class still accepts. A
 * closed account with no transactions and a zero balance is exempt: nothing about
 * it can reach a report. Closed accounts with history must be classified.
 *
 * `classOf` holds each account's effective class (see `resolveAccountClass`).
 * `closedActivity` should hold an entry for every closed account; a closed
 * account without one is treated as having history, so a missing read never unlocks.
 */
export function evaluateAccountReadiness(input: {
  accounts: readonly ReadinessAccount[];
  classOf: ReadonlyMap<string, AccountClass | null>;
  reporting: ReadonlyMap<string, ReportingTreatment>;
  closedActivity: ReadonlyMap<string, AccountActivity>;
}): ReadinessSummary {
  const accounts = input.accounts.map((account): AccountReadiness => {
    const status = (s: AccountReadinessStatus): AccountReadiness => ({ accountId: account.id, status: s });
    if (account.closed) {
      const activity = input.closedActivity.get(account.id);
      if (activity && activity.count === 0 && activity.balanceMinor === 0) return status("ready");
    }
    const accountClass = input.classOf.get(account.id) ?? null;
    if (!accountClass) return status("needs-class");
    if (!isAccountClassAllowed(accountClass, account.offBudget)) return status("incompatible-placement");
    if (REQUIREMENTS[accountClass].kind === "required" && !validSavedTreatment(accountClass, input.reporting.get(account.id))) {
      return status("needs-choice");
    }
    return status("ready");
  });
  const attention = accounts.filter((a) => a.status !== "ready").length;
  return { accounts, attention, ready: attention === 0 };
}
