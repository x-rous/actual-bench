import { isAccountClassAllowed, type AccountClass } from "./index";

/**
 * Financial Reporting: how an account counts in Financial Insights, next to its
 * class. Bench-owned metadata, like the class: it never changes Actual's
 * balances, transactions, budget placement or transfers. Safe to import from
 * client and server code (no I/O).
 *
 * Every class has an automatic label. The user can make two optional choices: a Bank account can be marked as a fixed or
 * restricted deposit, and an Other Asset can be marked as a fixed asset. Nothing here is required: the gate needs only a
 * class and a placement the class accepts. Further choices (accessible money, income in off-budget accounts, including an
 * account in Financial Insights) are flags, see `flags.ts`.
 */

export const REPORTING_TREATMENTS = [
  /** A tangible asset that is held and revalued or depreciated (gold, a collectible); the only Other Asset treatment the Assets module accepts. */
  "fixed-asset",
  /** A Bank deposit that cannot readily be withdrawn: still an asset and in net worth, but not cash. */
  "fixed-deposit",
] as const;

export type ReportingTreatment = (typeof REPORTING_TREATMENTS)[number];

export function isReportingTreatment(value: unknown): value is ReportingTreatment {
  return typeof value === "string" && (REPORTING_TREATMENTS as readonly string[]).includes(value);
}

export const REPORTING_LABELS: Record<ReportingTreatment | "cash-equivalent" | "loan-liability" | "investment" | "retirement-holding" | "other-asset-holding" | "credit-card-liability" | "liability", string> = {
  "fixed-asset": "Fixed asset",
  "fixed-deposit": "Fixed / restricted deposit",
  "cash-equivalent": "Cash & cash equivalents",
  "loan-liability": "Loan liability",
  investment: "Investment",
  "retirement-holding": "Retirement holding",
  "other-asset-holding": "Holding",
  "credit-card-liability": "Credit card liability",
  liability: "Liability",
};

/** What the user can choose, per class. */
export type ReportingRequirement =
  | { kind: "automatic"; label: string }
  /** Counted under `label` unless the user picks one of `options`. */
  | { kind: "optional"; label: string; options: readonly ReportingTreatment[] }
  /** Cash equivalent by default; the user may mark the account as a fixed / restricted deposit. */
  | { kind: "bank-default"; label: string };

const REQUIREMENTS: Record<AccountClass, ReportingRequirement> = {
  cash: { kind: "automatic", label: REPORTING_LABELS["cash-equivalent"] },
  bank: { kind: "bank-default", label: REPORTING_LABELS["cash-equivalent"] },
  vehicle: { kind: "automatic", label: REPORTING_LABELS["fixed-asset"] },
  property: { kind: "automatic", label: REPORTING_LABELS["fixed-asset"] },
  investment: { kind: "automatic", label: REPORTING_LABELS.investment },
  retirement: { kind: "automatic", label: REPORTING_LABELS["retirement-holding"] },
  "other-asset": { kind: "optional", label: REPORTING_LABELS["other-asset-holding"], options: ["fixed-asset"] },
  "credit-card": { kind: "automatic", label: REPORTING_LABELS["credit-card-liability"] },
  loan: { kind: "automatic", label: REPORTING_LABELS["loan-liability"] },
  "other-liability": { kind: "automatic", label: REPORTING_LABELS.liability },
};

export function reportingRequirement(accountClass: AccountClass): ReportingRequirement {
  return REQUIREMENTS[accountClass];
}

/** The treatments the class accepts as a saved choice. */
function acceptedTreatments(accountClass: AccountClass): readonly ReportingTreatment[] {
  const requirement = REQUIREMENTS[accountClass];
  if (requirement.kind === "optional") return requirement.options;
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
