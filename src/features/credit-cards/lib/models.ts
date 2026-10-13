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
  status: z.enum(["active", "frozen", "closed", "lost-stolen"]),
  network: z.enum(["unknown", "visa", "mastercard", "amex", "other"]).default("unknown"),
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
  appearance: z.enum(["default", "blue", "green", "amber", "purple"]).default("default"),
  autoPay: z.enum(["unknown", "off", "minimum", "full", "fixed"]).default("unknown"),
  /** New cards default to Actual/365 illustrations; callers may explicitly select off. */
  interestCategoryId: id.nullable().default(null),
  feeCategoryId: id.nullable().default(null),
  interestModel: z.enum(["off", "daily-simple-365", "daily-simple-360"]).default("daily-simple-365"),
  revision,
});
export type Card = z.infer<typeof cardSchema>;
export const cardInputSchema = cardSchema.omit({ id: true, revision: true });
export type CardInput = z.infer<typeof cardInputSchema>;

export const statementFactsSchema = z.strictObject({
  periodStart: date, closingDate: date, dueDate: date,
  /** Positive means owed to issuer; negative means issuer-reported card credit. */
  officialBalanceMinor: minorAmountSchema,
  minimumDueMinor: nonnegativeMinor,
}).superRefine((value, ctx) => {
  if (value.periodStart > value.closingDate) ctx.addIssue({ code: "custom", message: "Period start must be on or before closing", path: ["periodStart"] });
  if (value.dueDate < value.closingDate) ctx.addIssue({ code: "custom", message: "Due date must be on or after closing", path: ["dueDate"] });
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
export type StatementCorrection = {
  id: string; statementId: string; before: Statement; after: Statement; reason: string; recordedAt: string;
};
export const activityClassificationSchema = z.strictObject({
  cardId: id, transactionId: id, fingerprint: id,
  kind: z.enum(["purchase", "cash-advance", "interest", "fee", "refund", "other"]),
  reason: z.string().trim().min(1).max(500),
});
export type ActivityClassification = z.infer<typeof activityClassificationSchema>;
export type Workspace = {
  cards: Card[]; statements: Statement[]; corrections: StatementCorrection[];
  memberships: Membership[]; allocations: PaymentAllocation[]; classifications: ActivityClassification[];
};
