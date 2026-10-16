import { z } from "zod";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";

const id = z.string().trim().min(1);
/** Actual money is signed integer minor units, not decimal display amounts. */
export const minorAmountSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const nonnegativeMinor = minorAmountSchema.nonnegative();
const date = z.string().refine(isIsoDate, "Enter a valid calendar date");
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timeZone = z.string().refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Enter a valid bank time zone");

export const cardSchema = z.strictObject({
  id, budgetSyncId: id, accountId: id,
  nickname: z.string().trim().min(1).max(100),
  issuer: z.string().trim().max(100),
  last4: z.string().regex(/^(?:\d{4})?$/, "Use four digits or leave blank"),
  /** Optional limit in minor units; APR is metadata in integer basis points. */
  creditLimitMinor: nonnegativeMinor.nullable(),
  purchaseAprBps: z.number().int().min(0).max(100_000).nullable(),
  bankTimeZone: timeZone,
  // Normalize legacy session labels while exposing only Active / Inactive.
  status: z.enum(["active", "inactive", "frozen", "closed", "lost-stolen"]).transform((value) => value === "active" ? "active" as const : "inactive" as const),
  network: z.enum(["unknown", "visa", "mastercard", "amex", "discover", "jcb", "unionpay", "diners-club", "other"]).default("unknown"),
  cashAdvanceAprBps: z.number().int().min(0).max(100_000).nullable().default(null),
  balanceTransferAprBps: z.number().int().min(0).max(100_000).nullable().default(null),
  closingDay: z.number().int().min(1).max(31).nullable().default(null),
  dueRule: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("days-after-close"), days: z.number().int().min(0).max(90) }),
    z.strictObject({ kind: z.literal("day-of-month"), day: z.number().int().min(1).max(31) }),
  ]).nullable().default(null),
  minimumPercentBps: z.number().int().min(0).max(10_000).nullable().default(null),
  minimumFloorMinor: nonnegativeMinor.nullable().default(null),
  annualFeeMinor: nonnegativeMinor.nullable().default(null),
  renewalDate: date.nullable().default(null),
  openedDate: date.nullable().default(null),
  /** Closing date of the first tracked billing statement; independent of the viewing range. */
  firstTrackedStatementDate: date.nullable().default(null),
  rewards: z.string().trim().max(500).default(""),
  authorizedUsers: z.string().trim().max(500).default(""),
  appearance: z.enum(["default", "blue", "green", "amber", "purple", "red", "teal", "navy", "gray"]).default("default"),
  customColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  autoPay: z.enum(["unknown", "off", "minimum", "full", "fixed"]).default("unknown"),
  /** New cards default to Actual/365 illustrations; callers may explicitly select off. */
  interestCategoryId: id.nullable().default(null),
  feeCategoryId: id.nullable().default(null),
  cashbackCategoryId: id.nullable().default(null),
  interestModel: z.enum(["off", "daily-simple-365", "daily-simple-360"]).default("daily-simple-365"),
  revision,
});
export type Card = z.infer<typeof cardSchema>;
export const cardInputSchema = cardSchema.omit({ id: true, revision: true }).superRefine((value, ctx) => {
  if (value.feeCategoryId && value.feeCategoryId === value.interestCategoryId) ctx.addIssue({ code: "custom", path: ["feeCategoryId"], message: "Use different fee and interest categories, or leave both unmapped and classify individually" });
});
export type CardInput = z.infer<typeof cardInputSchema>;

export const statementFactsSchema = z.strictObject({
  periodStart: date, closingDate: date, dueDate: date,
  /** Positive means owed to issuer; negative means issuer-reported card credit. */
  officialBalanceMinor: minorAmountSchema,
  /** Original monthly payment target in integer minor units; absent uses the statement balance. */
  totalPaymentDueMinor: nonnegativeMinor.optional(),
  minimumDueMinor: nonnegativeMinor,
  /** Signed integer minor units brought forward before the first tracked cycle; absent is unknown. */
  openingBalanceMinor: minorAmountSchema.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.periodStart > value.closingDate) ctx.addIssue({ code: "custom", message: "Period start must be on or before closing", path: ["periodStart"] });
  if (value.dueDate < value.closingDate) ctx.addIssue({ code: "custom", message: "Due date must be on or after closing", path: ["dueDate"] });
  if (value.totalPaymentDueMinor !== undefined && value.minimumDueMinor > value.totalPaymentDueMinor) ctx.addIssue({ code: "custom", message: "Minimum cannot exceed Total Payment Due", path: ["totalPaymentDueMinor"] });
  if (value.minimumDueMinor > Math.max(0, value.officialBalanceMinor)) ctx.addIssue({ code: "custom", message: "Minimum cannot exceed the amount owed", path: ["minimumDueMinor"] });
});
export type StatementFacts = z.infer<typeof statementFactsSchema>;
export const statementSchema = statementFactsSchema.safeExtend({
  id, cardId: id, revision,
  lifecycle: z.enum(["recorded", "finalized"]),
  verification: z.enum(["recorded", "membership-reviewed", "verified", "needs-review"]),
  coverage: z.enum(["complete", "bounded", "incomplete", "unknown"]),
  openingAnchor: z.boolean(),
  bankConfirmed: z.boolean().default(true),
  reviewedSnapshot: z.string().nullable().default(null),
});
export type Statement = z.infer<typeof statementSchema>;

export const membershipSchema = z.strictObject({
  statementId: id, cardId: id, transactionId: id,
  decision: z.enum(["included", "excluded", "review"]),
  provenance: z.enum(["suggested", "manual"]),
  bankPostingDate: date.nullable(), fingerprint: id,
  reason: z.string().trim().max(500),
});
export type Membership = z.infer<typeof membershipSchema>;
export const allocationSchema = z.strictObject({
  cardId: id, transactionId: id, originId: id,
  amountMinor: nonnegativeMinor.positive(),
  provenance: z.enum(["automatic", "manual"]),
  fingerprint: id, reason: z.string().trim().max(500),
});
export type PaymentAllocation = z.infer<typeof allocationSchema>;

/** Logical anchor; derived from one official statement, never an Actual transaction. */
export type OpeningPosition = { cardId: string; statementId: string; date: string; balanceMinor: number };
export const activityClassificationSchema = z.strictObject({
  cardId: id, transactionId: id, fingerprint: id,
  kind: z.enum(["purchase", "cash-advance", "money-transfer", "balance-transfer", "interest", "fee", "interest-refund", "fee-refund", "refund", "cashback", "payment", "transfer", "plan-instalment", "plan-conversion", "plan-adjustment", "dispute-credit", "dispute-adjustment", "adjustment", "other-charge", "other-credit", "other"]),
  feeSubtype: z.enum(["annual", "late", "over-limit", "cash-advance", "foreign-exchange", "plan-processing", "plan-monthly", "vat", "other"]).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});
export type ActivityClassification = z.infer<typeof activityClassificationSchema>;
export type Workspace = {
  cards: Card[]; statements: Statement[];
  memberships: Membership[]; allocations: PaymentAllocation[]; classifications: ActivityClassification[];
  plans?: RepaymentPlan[]; planLinks?: PlanLink[];
};

/** Expected arrangement metadata; never an additional Actual balance or scheduled transaction. */
export const repaymentPlanSchema = z.strictObject({
  id, cardId: id, transactionId: id.nullable(), fingerprint: id.nullable(), revision,
  sourceMode: z.enum(["new", "existing"]).optional(),
  sourceTransactions: z.array(z.strictObject({ transactionId: id, fingerprint: id })).max(500).optional(),
  reference: z.string().trim().max(200).optional(),
  balanceOnly: z.boolean().optional(),
  recording: z.enum(["tracking", "instalments", "retained"]).optional(),
  /** Dated principal context in integer minor units; never an additional Actual balance. */
  opening: z.strictObject({ date, principalMinor: nonnegativeMinor }).optional(),
  arrangement: z.enum(["fixed", "minimum-deadline", "promotional", "deferred", "revolving"]),
  status: z.enum(["active", "completed", "cancelled"]).default("active"),
  amountMinor: nonnegativeMinor.positive(), startDate: date, firstDueDate: date,
  months: z.number().int().min(1).max(360),
  monthlyMinor: nonnegativeMinor.nullable(),
  aprBps: z.number().int().min(0).max(100_000),
  upfrontFeeMinor: nonnegativeMinor, monthlyFeeMinor: nonnegativeMinor,
  includesCosts: z.boolean(),
  minimumPercentBps: z.number().int().min(0).max(10_000).nullable(),
  minimumFloorMinor: nonnegativeMinor.nullable(),
  expiryDate: date.nullable(), afterAprBps: z.number().int().min(0).max(100_000).nullable(),
  conditions: z.string().trim().max(2000),
  /** Optional Actual liability account and exact, budget-unique plan hashtag. No balance is created. */
  tracking: z.strictObject({ accountId: id, tag: z.string().trim().regex(/^(?:#[\p{L}\p{N}_-]+)?$/u, "Use one optional hashtag, for example #laptop-plan"),
    /** Confirmed principal in the tracking account at end of this date, for mid-plan starts; minor units. */
    opening: z.strictObject({ date, principalMinor: nonnegativeMinor }).optional(),
  }).optional(),
  /** Session metadata: confirmation is tied to exact refund evidence, not a balance adjustment. */
  refundReview: z.strictObject({
    treatment: z.enum(["unchanged", "revised", "cancelled"]),
    signature: z.string().min(1),
    remaining: z.array(z.strictObject({ index: z.number().int().min(1).max(360), date, amountMinor: nonnegativeMinor })).max(360),
  }).optional(),
}).superRefine((value, ctx) => {
  if (!value.balanceOnly && value.firstDueDate <= value.startDate) ctx.addIssue({ code: "custom", message: "First due date must be after plan start", path: ["firstDueDate"] });
  if (!value.balanceOnly && value.arrangement === "fixed" && (value.monthlyMinor === null || value.monthlyMinor <= 0)) ctx.addIssue({ code: "custom", message: "Enter the contractual monthly instalment", path: ["monthlyMinor"] });
  if (!value.balanceOnly && value.arrangement === "minimum-deadline" && value.minimumPercentBps === null) ctx.addIssue({ code: "custom", message: "Enter the monthly minimum percentage", path: ["minimumPercentBps"] });
  if (!value.balanceOnly && value.arrangement === "fixed" && value.includesCosts && value.monthlyMinor !== null && value.monthlyFeeMinor >= value.monthlyMinor) ctx.addIssue({ code: "custom", message: "The included monthly fee must be less than the monthly instalment", path: ["monthlyFeeMinor"] });
  if (value.expiryDate && value.expiryDate < value.startDate) ctx.addIssue({ code: "custom", message: "Expiry must not precede plan start", path: ["expiryDate"] });
});
export type RepaymentPlan = z.infer<typeof repaymentPlanSchema>;
export const planLinkSchema = z.strictObject({
  planId: id, transactionId: id, fingerprint: id,
  role: z.enum(["conversion-credit", "instalment-billed", "combined-instalment", "principal-release", "plan-fee", "plan-interest", "adjustment", "refund"]),
  instalment: z.number().int().min(1).max(360).nullable(),
});
export type PlanLink = z.infer<typeof planLinkSchema>;
