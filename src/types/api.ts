/**
 * Raw API response/request types — match the Actual HTTP API Swagger schema exactly.
 * Field names use snake_case as returned by the server.
 * These types are used only inside lib/api/. Do not use them in UI or store code.
 */

// ─── Shared ───────────────────────────────────────────────────────────────────

/**
 * Wire shape of a rule condition/action `options` bag. Structurally identical to `RuleOptions`
 * in `types/entities.ts`; duplicated rather than imported so this file stays a standalone
 * transcription of the API schema. Keep the two in step.
 */
export type ApiRuleOptions = {
  template?: string;
  formula?: string;
  splitIndex?: number;
  method?: "fixed-amount" | "fixed-percent" | "formula" | "remainder";
  inflow?: boolean;
  outflow?: boolean;
};

export type ApiConditionOrAction = {
  /** Absent for `delete-transaction`, `set-split-amount` and `link-schedule` actions. */
  field?: string;
  op: string;
  /**
   * Amounts arrive as integer minor units; converted at the boundary in `lib/api/rules.ts`.
   * A schedule-generated rule's date condition carries a recurrence config rather than a scalar.
   */
  value:
    | string
    | number
    | boolean
    | null
    | string[]
    | { num1: number; num2: number }
    | ApiRecurConfig;
  type?: string;
  options?: ApiRuleOptions;
};

// ─── Account ─────────────────────────────────────────────────────────────────

export type ApiAccount = {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
};

export type ApiAccountInput = Omit<ApiAccount, "id">;

/** POST /accounts body shape — initialBalance is a one-time creation param, in cents. */
export type ApiAccountCreateInput = Pick<ApiAccountInput, "name" | "offbudget"> & {
  initialBalance?: number;
};

// ─── Payee ───────────────────────────────────────────────────────────────────

export type ApiPayee = {
  id?: string;
  name: string;
  category?: string;
  transfer_acct?: string;
};

export type ApiPayeeInput = Omit<ApiPayee, "id">;

// ─── Category ─────────────────────────────────────────────────────────────────

export type ApiCategory = {
  id?: string;
  name: string;
  is_income?: boolean;
  hidden?: boolean;
  group_id: string;
};

export type ApiCategoryInput = Omit<ApiCategory, "id">;

// ─── Category Group ───────────────────────────────────────────────────────────

export type ApiCategoryGroup = {
  id?: string;
  name: string;
  is_income?: boolean;
  hidden?: boolean;
  /** Only present in GET responses — not valid for create/update */
  categories?: ApiCategory[];
};

export type ApiCategoryGroupInput = Omit<ApiCategoryGroup, "id" | "categories">;

// ─── Rule ─────────────────────────────────────────────────────────────────────

export type ApiRuleStage = "pre" | "default" | "post";
export type ApiConditionsOp = "and" | "or";

export type ApiRule = {
  id?: string;
  stage: ApiRuleStage;
  conditionsOp?: ApiConditionsOp;
  conditions?: ApiConditionOrAction[];
  actions?: ApiConditionOrAction[];
};

export type ApiRuleInput = Omit<ApiRule, "id">;

// ─── Schedule ─────────────────────────────────────────────────────────────────

export type ApiRecurPattern = {
  value: number;
  type: string;
};

export type ApiRecurConfig = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  patterns?: ApiRecurPattern[];
  skipWeekend?: boolean;
  start: string;
  endMode: "never" | "after_n_occurrences" | "on_date";
  endOccurrences?: number;
  endDate?: string;
  weekendSolveMode?: "before" | "after";
};

export type ApiAmountOp = "is" | "isapprox" | "isbetween";

export type ApiAmountRange = {
  num1: number;
  num2: number;
};

export type ApiSchedule = {
  id?: string;
  name?: string;
  rule?: string;
  next_date?: string;
  completed?: boolean;
  posts_transaction?: boolean;
  payee?: string | null;
  account?: string | null;
  amount?: number | ApiAmountRange | null;
  amountOp?: ApiAmountOp;
  date?: string | ApiRecurConfig;
};

export type ApiScheduleInput = {
  name?: string;
  posts_transaction?: boolean;
  payee?: string | null;
  account?: string | null;
  amount?: number | ApiAmountRange;
  amountOp?: ApiAmountOp;
  date: string | ApiRecurConfig;
};

// ─── Tag ─────────────────────────────────────────────────────────────────────

export type ApiTag = {
  id: string;
  /** The tag label — named "tag" (not "name") in the API response. */
  tag: string;
  color: string | null;
  description: string | null;
};

export type ApiTagInput = {
  tag: string;
  color?: string | null;
  description?: string | null;
};

// ─── API Response envelope ────────────────────────────────────────────────────

export type ApiListResponse<T> = {
  data: T[];
};

export type ApiSingleResponse<T> = {
  data: T;
};

export type ApiErrorResponse = {
  error: string;
  message?: string;
};
