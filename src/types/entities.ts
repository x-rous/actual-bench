/**
 * Normalized internal entity types — camelCase, used throughout UI, store, and feature code.
 * Transformed from API types in lib/api/. Never use ApiXxx types outside of lib/api/.
 */

// ─── Base ────────────────────────────────────────────────────────────────────

export type BaseEntity = {
  id: string;
};

// ─── Account ─────────────────────────────────────────────────────────────────

export type Account = BaseEntity & {
  name: string;
  offBudget: boolean;
  closed: boolean;
};

// ─── Payee ───────────────────────────────────────────────────────────────────

export type Payee = BaseEntity & {
  name: string;
  /** ID of the default category to assign (from API: category) */
  categoryId?: string;
  /** ID of associated transfer account, if this is a transfer payee */
  transferAccountId?: string;
  /** Derived: count of rules referencing this payee — not from API */
  rulesCount?: number;
  /** Derived: flagged as a likely duplicate — not from API */
  duplicateFlag?: boolean;
};

// ─── Category Group ───────────────────────────────────────────────────────────

export type CategoryGroup = BaseEntity & {
  name: string;
  isIncome: boolean;
  hidden: boolean;
  /** Populated from nested categories array in GET /categorygroups */
  categoryIds: string[];
};

// ─── Category ─────────────────────────────────────────────────────────────────

export type Category = BaseEntity & {
  name: string;
  groupId: string;
  isIncome: boolean;
  hidden: boolean;
};

// ─── Rule ─────────────────────────────────────────────────────────────────────

export type RuleStage = "pre" | "default" | "post";
export type ConditionsOp = "and" | "or";

export type AmountRange = { num1: number; num2: number };

export type ConditionOrAction = {
  /** Absent for `delete-transaction` actions. */
  field?: string;
  op: string;
  value: string | number | boolean | null | string[] | AmountRange;
  type?: string;
  /** Present on actions when the user has enabled template (Handlebars) mode. */
  options?: { template?: string };
};

export type Rule = BaseEntity & {
  stage: RuleStage;
  conditionsOp: ConditionsOp;
  conditions: ConditionOrAction[];
  actions: ConditionOrAction[];
};

// ─── Schedule ─────────────────────────────────────────────────────────────────

export type ScheduleAmountOp = "is" | "isapprox" | "isbetween";

export type ScheduleAmountRange = {
  num1: number;
  num2: number;
};

export type RecurConfig = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  patterns?: { value: number; type: string }[];
  skipWeekend?: boolean;
  start: string;
  endMode: "never" | "after_n_occurrences" | "on_date";
  endOccurrences?: number;
  endDate?: string;
  weekendSolveMode?: "before" | "after";
};

export type Schedule = BaseEntity & {
  name?: string;
  /** ID of the underlying rule auto-created by the API */
  ruleId?: string;
  nextDate?: string;
  completed: boolean;
  postsTransaction: boolean;
  payeeId?: string | null;
  accountId?: string | null;
  amount?: number | ScheduleAmountRange;
  amountOp?: ScheduleAmountOp;
  date?: string | RecurConfig;
};

// ─── Tag ─────────────────────────────────────────────────────────────────────

export type Tag = BaseEntity & {
  /** Display label. API field: "tag" */
  name: string;
  /** Hex color string, e.g. "#FF5733". undefined = no color assigned. */
  color?: string;
  description?: string;
};

// ─── Normalized entity maps ───────────────────────────────────────────────────

export type EntityMap<T extends BaseEntity> = Record<string, T>;

export type EntityStore = {
  accounts: EntityMap<Account>;
  payees: EntityMap<Payee>;
  categoryGroups: EntityMap<CategoryGroup>;
  categories: EntityMap<Category>;
  rules: EntityMap<Rule>;
  schedules: EntityMap<Schedule>;
};
