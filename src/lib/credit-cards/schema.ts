import { z } from "zod";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";

/**
 * The durable credit-card model (review §12.1), shared by the app-DB repository and the client.
 * Money is signed integer minor units with Actual's sign; rates are integer basis points. Only
 * Actual ids, opaque hashes and the user's own figures are stored: never transaction text,
 * credentials or Actual balances.
 */
const id = z.string().trim().min(1);
/** Actual money is signed integer minor units, not decimal display amounts. */
export const minorAmountSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const nonnegativeMinor = minorAmountSchema.nonnegative();
const date = z.string().refine(isIsoDate, "Enter a valid calendar date");
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** 0–100% in basis points. */
const percentBps = z.number().int().min(0).max(10_000);
const note = (max: number) => z.string().trim().max(max).nullable().default(null);
const timeZone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Enter a valid bank time zone");

export const CARD_NETWORKS = [
  "unknown", "visa", "mastercard", "amex", "discover", "jcb", "unionpay", "diners-club", "other",
] as const;

/** Where the closing day and due rule came from (D18). Only `default` is replaced by a statement. */
export const BILLING_DAYS_SOURCES = ["default", "user", "statement"] as const;

const dueRuleSchema = z.strictObject({
  kind: z.enum(["days-after-close", "day-of-month"]),
  value: z.number().int().min(0).max(90),
}).refine((rule) => rule.kind === "days-after-close" || (rule.value >= 1 && rule.value <= 31), {
  message: "Choose a due day from 1 to 31",
  path: ["value"],
});
export type DueRule = z.infer<typeof dueRuleSchema>;

export const cardSchema = z.strictObject({
  id,
  budgetSyncId: id,
  accountId: id,
  revision,
  status: z.enum(["active", "inactive"]).default("active"),
  network: z.enum(CARD_NETWORKS).default("unknown"),
  /** `#rrggbb`; null uses the default card colour. */
  color: z.string().regex(/^#[0-9a-f]{6}$/i).transform((value) => value.toLowerCase()).nullable().default(null),
  bankTimeZone: timeZone,
  /** Optional limit in minor units. */
  creditLimitMinor: nonnegativeMinor.nullable().default(null),
  purchaseAprBps: percentBps.nullable().default(null),
  interestModel: z.enum(["off", "daily-simple-365", "daily-simple-360"]).default("daily-simple-365"),
  /** 1–31; 31 means the last day of the month. */
  closingDay: z.number().int().min(1).max(31).nullable().default(null),
  dueRule: dueRuleSchema.nullable().default(null),
  billingDaysSource: z.enum(BILLING_DAYS_SOURCES).default("user"),
  minimumPercentBps: percentBps.nullable().default(null),
  minimumFloorMinor: nonnegativeMinor.nullable().default(null),
  interestCategoryId: id.nullable().default(null),
  feeCategoryId: id.nullable().default(null),
  cashbackCategoryId: id.nullable().default(null),
  /** The bank's statement balance includes principal held in plan accounts (D15). */
  statementsIncludePlanBalances: z.boolean().default(false),
  /** Closing date of the first tracked statement; independent of the viewing range. Clearable. */
  firstTrackedStatementDate: date.nullable().default(null),
  openedDate: date.nullable().default(null),
  autoPay: z.enum(["unknown", "off", "minimum", "full", "fixed"]).default("unknown"),
  annualFeeMinor: nonnegativeMinor.nullable().default(null),
  annualFeeRenewalDate: date.nullable().default(null),
});
export type Card = z.infer<typeof cardSchema>;

export const cardInputSchema = cardSchema.omit({ id: true, revision: true }).superRefine((value, ctx) => {
  if (value.feeCategoryId && value.feeCategoryId === value.interestCategoryId) {
    ctx.addIssue({
      code: "custom",
      path: ["feeCategoryId"],
      message: "Use different fee and interest categories, or leave both unmapped",
    });
  }
});
export type CardInput = z.input<typeof cardInputSchema>;

/** New cards start on the 10th / due on the 3rd with a 5% / 100.00 minimum estimate (D18). */
export const NEW_CARD_DEFAULTS = {
  closingDay: 10,
  dueRule: { kind: "day-of-month", value: 3 } satisfies DueRule,
  billingDaysSource: "default",
  minimumPercentBps: 500,
  minimumFloorMinor: 10_000,
} as const;

export const statementFactsSchema = z.strictObject({
  periodStart: date,
  closingDate: date,
  dueDate: date,
  /** Positive means owed to the bank; negative means card credit. */
  balanceMinor: minorAmountSchema,
  /** Required (D1); 0 means no minimum. */
  minimumDueMinor: nonnegativeMinor,
  /** What the bank asks you to pay; null uses the statement balance (D2). */
  amountDueMinor: nonnegativeMinor.nullable().default(null),
  /** Balance brought forward when the previous statement is not saved (D3); signed. */
  previousBalanceMinor: minorAmountSchema.nullable().default(null),
}).superRefine((value, ctx) => {
  const owed = Math.max(0, value.balanceMinor);
  if (value.periodStart > value.closingDate) {
    ctx.addIssue({ code: "custom", message: "Period start must be on or before closing", path: ["periodStart"] });
  }
  if (value.dueDate < value.closingDate) {
    ctx.addIssue({ code: "custom", message: "Due date must be on or after closing", path: ["dueDate"] });
  }
  if (value.minimumDueMinor > owed) {
    ctx.addIssue({ code: "custom", message: "Minimum due cannot exceed the statement balance", path: ["minimumDueMinor"] });
  }
  if (value.amountDueMinor !== null && value.amountDueMinor > owed) {
    ctx.addIssue({ code: "custom", message: "Amount due cannot exceed the statement balance", path: ["amountDueMinor"] });
  }
  if (value.amountDueMinor !== null && value.minimumDueMinor > value.amountDueMinor) {
    ctx.addIssue({ code: "custom", message: "Minimum due cannot exceed the amount due", path: ["amountDueMinor"] });
  }
});
export type StatementFacts = z.infer<typeof statementFactsSchema>;
export type StatementFactsInput = z.input<typeof statementFactsSchema>;

export const REVIEW_STATES = ["not_reviewed", "reviewed", "verified"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const statementSchema = statementFactsSchema.safeExtend({
  id,
  cardId: id,
  revision,
  reviewState: z.enum(REVIEW_STATES).default("not_reviewed"),
  /** Evidence signature frozen at the last review (D20); null when never reviewed. */
  reviewHash: z.string().min(8).max(64).nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
  /** A bank difference the user accepted as plan-scope (A4); valid only while it is unchanged. */
  scopeAcceptedDifferenceMinor: minorAmountSchema.nullable().default(null),
});
/** Saved bank statements only. `estimate` marks a derived, never-stored preview. */
export type Statement = z.infer<typeof statementSchema> & { readonly estimate?: true };

export const decisionSchema = z.strictObject({
  statementId: id,
  cardId: id,
  transactionId: id,
  /** Only answers are stored; "undecided" is the absence of a row. */
  decision: z.enum(["included", "excluded"]),
  origin: z.enum(["user", "verification"]),
  /** The bank's posting date, when it differs from Actual's; also used by Rule P. */
  bankPostingDate: date.nullable().default(null),
  /** Full financial fingerprint at decision time; a changed date or amount reopens the row. */
  sourceHash: id,
  note: note(500),
});
export type Decision = z.infer<typeof decisionSchema>;

/** The 11 sign-agnostic types (D7): the amount's sign decides charge or credit. */
export const TRANSACTION_TYPES = [
  "purchase", "cash-advance", "balance-transfer", "interest", "fee", "instalment",
  "payment", "refund", "cashback", "adjustment", "transfer",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const typeCorrectionSchema = z.strictObject({
  cardId: id,
  transactionId: id,
  kind: z.enum(TRANSACTION_TYPES),
  /** Narrow identity (account, sign, transfer, parent): a mismatch drops the correction (D21). */
  identityHash: id,
  /** Full fingerprint at confirmation: a mismatch keeps it and flags "changed since you confirmed". */
  sourceHash: id,
  note: note(500),
});
export type TypeCorrection = z.infer<typeof typeCorrectionSchema>;

export const PLAN_RECORDED_AS = ["plan-account", "card-instalments", "card-balance"] as const;
export const PLAN_SCHEDULE_KINDS = ["fixed", "minimum-deadline", "promotional"] as const;
const planTag = z.string().trim().regex(/^#[\p{L}\p{N}_-]+$/u, "Use one hashtag, for example #laptop-plan");

export const planSchema = z.strictObject({
  id,
  cardId: id,
  revision,
  name: z.string().trim().min(1, "Enter a plan name").max(200),
  recordedAs: z.enum(PLAN_RECORDED_AS),
  /** Off-budget Actual account holding the principal (D4). */
  planAccountId: id.nullable().default(null),
  /** Set only when the account is shared with other plans. */
  planAccountTag: planTag.nullable().default(null),
  status: z.enum(["active", "completed", "cancelled"]).default("active"),
  endedOn: date.nullable().default(null),
  /** Original converted principal; null means unknown, never the remaining principal. */
  originalAmountMinor: nonnegativeMinor.positive().nullable().default(null),
  /** Null for "already running, start unknown" (R10). */
  startDate: date.nullable().default(null),
  /** Principal at the end of `date`, for card modes or untagged shared-account history. */
  opening: z.strictObject({ date, principalMinor: nonnegativeMinor }).nullable().default(null),
  /** Null means balance only, no schedule. */
  scheduleKind: z.enum(PLAN_SCHEDULE_KINDS).nullable().default(null),
  firstDueDate: date.nullable().default(null),
  instalmentCount: z.number().int().min(1).max(360).nullable().default(null),
  instalmentMinor: nonnegativeMinor.positive().nullable().default(null),
  aprBps: percentBps.default(0),
  upfrontFeeMinor: nonnegativeMinor.default(0),
  monthlyFeeMinor: nonnegativeMinor.default(0),
  /** The instalment amount already includes interest and monthly fees. */
  includesCosts: z.boolean().default(true),
  minimumPercentBps: percentBps.nullable().default(null),
  minimumFloorMinor: nonnegativeMinor.nullable().default(null),
  expiryDate: date.nullable().default(null),
  /** Conditions, after-promotion rate and other free text. */
  note: z.string().trim().max(2000).default(""),
}).superRefine((plan, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if ((plan.recordedAs === "plan-account") !== (plan.planAccountId !== null)) {
    issue("planAccountId", "Choose the plan account, or record the plan on the card");
  }
  if (plan.planAccountTag && !plan.planAccountId) issue("planAccountTag", "A tag needs a plan account");
  if (plan.originalAmountMinor === null && !plan.opening && plan.recordedAs !== "plan-account") {
    issue("originalAmountMinor", "Enter the original amount or the remaining principal");
  }
  if (plan.scheduleKind === null && (plan.firstDueDate || plan.instalmentCount || plan.instalmentMinor)) {
    issue("scheduleKind", "Choose a schedule for the instalment terms");
  }
  if (plan.scheduleKind === "fixed" && (!plan.firstDueDate || !plan.instalmentCount || !plan.instalmentMinor)) {
    issue("instalmentMinor", "Enter the first due date, number of instalments and monthly amount");
  }
  if (plan.scheduleKind === "minimum-deadline"
    && (!plan.firstDueDate || !plan.instalmentCount || plan.minimumPercentBps === null)) {
    issue("minimumPercentBps", "Enter the first due date, number of months and the monthly minimum %");
  }
  if (plan.startDate && plan.firstDueDate && plan.firstDueDate <= plan.startDate) {
    issue("firstDueDate", "First due date must be after the plan start");
  }
  if (plan.endedOn && plan.status === "active") issue("endedOn", "An active plan has no end date");
  if (plan.endedOn && plan.startDate && plan.endedOn < plan.startDate) issue("endedOn", "The end date precedes the start");
  if (plan.expiryDate && plan.startDate && plan.expiryDate < plan.startDate) issue("expiryDate", "Expiry precedes the start");
  if (plan.scheduleKind === "fixed" && plan.includesCosts && plan.instalmentMinor !== null
    && plan.monthlyFeeMinor >= plan.instalmentMinor) {
    issue("monthlyFeeMinor", "The included monthly fee must be less than the monthly instalment");
  }
});
export type RepaymentPlan = z.infer<typeof planSchema>;
export type RepaymentPlanInput = z.input<typeof planSchema>;

export const PLAN_ENTRY_ROLES = [
  "original", "instalment", "conversion", "settlement", "cost", "refund", "adjustment",
] as const;
export type PlanEntryRole = (typeof PLAN_ENTRY_ROLES)[number];

export const planEntrySchema = z.strictObject({
  planId: id,
  transactionId: id,
  role: z.enum(PLAN_ENTRY_ROLES),
  instalmentNumber: z.number().int().min(1).max(360).nullable().default(null),
  /** Sorted "legA:legB" for transfers, so both legs can never sit on different plans. */
  transferPairKey: z.string().min(1).max(401).nullable().default(null),
  identityHash: id,
  sourceHash: id,
}).refine((entry) => entry.role === "instalment" || entry.instalmentNumber === null, {
  message: "Only instalments have an instalment number",
  path: ["instalmentNumber"],
});
export type PlanEntry = z.infer<typeof planEntrySchema>;

/**
 * A change to a card's credit limit, effective from a date (any day, not only a closing date). The
 * card's `creditLimitMinor` is the limit before its first change.
 */
export const limitChangeSchema = z.strictObject({
  cardId: id,
  effectiveDate: date,
  limitMinor: nonnegativeMinor,
});
export type LimitChange = z.infer<typeof limitChangeSchema>;

/** Everything Bench stores for one budget. Immutable: every write replaces the arrays it changes. */
export type Workspace = {
  cards: Card[];
  statements: Statement[];
  decisions: Decision[];
  typeCorrections: TypeCorrection[];
  plans: RepaymentPlan[];
  planEntries: PlanEntry[];
  /** Off-budget accounts that hold plan principal (D6); transfers with them are never payments. */
  planAccounts: string[];
  /** Credit-limit changes, per card, by effective date. */
  limitChanges: LimitChange[];
};

export const EMPTY_WORKSPACE: Workspace = {
  cards: [],
  statements: [],
  decisions: [],
  typeCorrections: [],
  plans: [],
  planEntries: [],
  planAccounts: [],
  limitChanges: [],
};
