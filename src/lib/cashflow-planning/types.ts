/**
 * Cashflow Planning: the stored plan document. Everything here is Bench-owned and saved in the app database as one
 * JSON document per plan; nothing is written to Actual. Figures read from Actual (past months, balances, budgets,
 * schedules, loans) are never stored in a plan: they are read again each time and laid over it by the engine.
 *
 * Money is integer minor units. Row amounts are **natural**: positive in the section's usual direction (money in for
 * Income; money out for Expenses, Savings & investments and Loans & debt). A negative amount is the reverse (a refund,
 * a withdrawal from savings, new borrowing). The cash effect of an amount is `amount * SECTION_SIGN[section]`.
 */

/** `YYYY-MM`. */
export type Month = string;

export const SECTIONS = ["income", "expenses", "savings", "debt"] as const;
export type SectionId = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<SectionId, string> = {
  income: "Income",
  expenses: "Expenses",
  savings: "Savings & investments",
  debt: "Loans & debt",
};

/** How a natural amount of the section moves cash. */
export const SECTION_SIGN: Record<SectionId, 1 | -1> = { income: 1, expenses: -1, savings: -1, debt: -1 };

/**
 * An Actual account a row follows. For an account outside the plan's cash, the row takes the transfers between cash and
 * it; for an account inside the plan's cash, the row takes that account's uncategorized entries (interest, for example).
 * `flow` narrows it to money coming into cash or money leaving it.
 */
export type AccountLink = { id: string; flow?: "in" | "out" };

/** What a row follows in Actual. A category group covers every category currently in it. */
export type RowLinks = { categories: string[]; categoryGroups: string[]; accounts: AccountLink[] };

/** An amount that repeats: every `every` months from `start` to `end` (inclusive; open when absent), growing `growthPct` percent a year. */
export type RepeatRule = { id: string; /** Natural minor units. */ amount: number; start: Month; end?: Month; every: number; growthPct?: number };

export const AVERAGE_WINDOWS = [3, 6, 12, 24] as const;
export type AverageWindow = (typeof AVERAGE_WINDOWS)[number];

/** Where a row's forecast comes from. A typed cell always wins over it. */
export type Basis =
  /** Repeating amounts and typed cells only. */
  | { kind: "manual" }
  /** The monthly average of the row's own actuals over the last complete months, optionally growing each year. */
  | { kind: "average"; months: AverageWindow; growthPct?: number }
  /** What Actual's budget holds for the linked categories; months past the last budgeted one repeat it. */
  | { kind: "budget" }
  /** The upcoming dates of Actual schedules. */
  | { kind: "schedule"; scheduleIds: string[] }
  /**
   * The repayments the Loans page projects for the linked loan accounts: the whole instalment, or (`count: "principal"`) only the
   * part that reaches the loan account. With the whole instalment, the interest and fee lines of recorded repayments count in
   * this row too, not in their category's.
   */
  | { kind: "loan"; count?: "principal" };

export type BasisKind = Basis["kind"];

export type PlanRow = {
  id: string;
  name: string;
  section: SectionId;
  /** The group it sits in, or null for a row directly under its section. */
  groupId: string | null;
  notes?: string;
  links: RowLinks;
  basis: Basis;
  rules: RepeatRule[];
  /** Typed amounts by month (natural minor units). Sparse: a month without one follows the basis. */
  cells: Record<Month, number>;
};

/** A group's colour as `#rrggbb`; its rows follow it, fainter. */
export type GroupColor = string;
export const isGroupColor = (value: unknown): value is GroupColor => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export type PlanGroup = { id: string; name: string; section: SectionId; color?: GroupColor };

/** A balance to reach by a month: of the plan's cash, or of cash and savings together. */
export type Goal = { id: string; name: string; month: Month; /** Minor units. */ amount: number; basis: "cash" | "total" };

/** How an account counts in a plan: part of its cash, part of its savings, or outside both. */
export type PlanAccountRole = "cash" | "savings" | "outside";

export const MIN_YEARS = 1;
export const MAX_YEARS = 50;
export const SCHEMA_VERSION = 1;

export type PlanDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  name: string;
  /** First month of the plan. */
  startMonth: Month;
  /** Length in years, 1 to 50. */
  years: number;
  /** Past months and balances come from Actual. When false the plan is a plain worksheet that starts from `openingBalance`. */
  useActuals: boolean;
  /** Opening cash (minor units) of a plan that does not use Actual. */
  openingBalance: number;
  /** The user's own choice per Actual account id; an account without one follows its class. */
  accountRoles: Record<string, PlanAccountRole>;
  /** The cash balance the plan should not go below (minor units), or null for none. */
  minimumCash: number | null;
  /** Expected yearly growth of the savings balance, in percent. Only used for the savings estimate. */
  savingsGrowthPct: number;
  groups: PlanGroup[];
  rows: PlanRow[];
  goals: Goal[];
  /** Actual transactions this plan counts in another month than their date, by transaction id. A transaction's own month here cancels a `#YYYY-MM` tag in its note. */
  moves: Record<string, Month>;
};

/** A saved plan as the app database returns it. */
/** A stored plan this build cannot read, and why. It is reported, never repaired or rewritten. */
export type UnreadablePlan = { id: string; name: string; why: string };

export type PlanRecord = { id: string; budgetSyncId: string; name: string; revision: number; document: PlanDocument; createdAt: string; updatedAt: string };

export const EMPTY_LINKS: RowLinks = { categories: [], categoryGroups: [], accounts: [] };
