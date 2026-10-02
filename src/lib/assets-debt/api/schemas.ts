import { NextResponse } from "next/server";
import { z } from "zod";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { DebtConfigValidationError } from "../services/debtConfigService";

/**
 * Request schemas for `/api/assets-debt/**` (RD-084 P1.3).
 *
 * Handlers are thin: parse with these schemas, call a service, return JSON.
 * No SQL and no calculation in a handler. Decimal fields are strings here,
 * so a JS number never reaches the service; enum membership, identifier
 * support and every semantic rule are the service's to decide.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date (YYYY-MM-DD)");
const id = z.string().min(1).max(200);
const decimal = z.string().min(1).max(40);
const minor = z.number().int();

export const accountDirectorySchema = z.strictObject({
  budgetSyncId: id,
  accounts: z.array(z.strictObject({ id, name: z.string(), offBudget: z.boolean(), closed: z.boolean() })).max(5_000),
  categories: z.array(z.strictObject({ id, name: z.string(), groupName: z.string(), isIncome: z.boolean(), hidden: z.boolean() })).max(10_000),
});

const paymentCap = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absolute"), amountMinor: minor }),
  z.strictObject({ kind: z.literal("previous-payment-factor"), factor: decimal }),
]);

const rate = z.strictObject({
  id: id.nullish(),
  announcedAt: isoDate.nullable(),
  accrualEffectiveFrom: isoDate,
  annualRateDecimal: decimal,
  paymentRecalcPolicy: z.string().nullable(),
  paymentEffectiveFrom: isoDate.nullable(),
  rateCapDecimal: decimal.nullable(),
  rateFloorDecimal: decimal.nullable(),
  paymentCap: paymentCap.nullable(),
  source: z.string().max(500).nullable(),
  note: z.string().max(2_000).nullable(),
});

const offset = z.strictObject({
  id: id.nullish(),
  actualAccountId: id,
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable(),
  offsetPercentageBps: z.number().int(),
  balanceBasis: z.enum(["cleared", "total"]),
  capMinor: minor.nullable(),
  fundScheduledRepayments: z.boolean().default(false),
});

export const assumptionSchema = z.strictObject({
  id: id.nullish(),
  kind: z.enum(["extra-repayment", "draw", "fee", "payment-change", "offset-balance", "offset-deposit", "offset-withdrawal"]),
  effectiveFrom: isoDate,
  recurrence: z.strictObject({ frequency: z.string(), until: isoDate }).nullable(),
  amountMinor: minor,
  feeTreatment: z.enum(["cash-paid", "capitalized"]).nullable(),
  offsetAccountId: id.nullable(),
  note: z.string().max(2_000).nullable(),
});

export const debtSaveSchema = z.strictObject({
  budgetSyncId: id,
  name: z.string().max(200),
  debtType: z.enum(["mortgage", "personal-loan", "car-loan", "student-loan", "heloc", "loan-receivable", "other"]),
  behaviorClass: z.enum(["term-loan", "revolving-credit", "receivable-loan"]),
  currency: z.string(),
  currencyMinorDigits: z.number().int(),
  liabilityAccountId: id.nullable(),
  paymentAccountId: id.nullable(),
  signConvention: z.enum(["negative-is-debt", "positive-is-debt"]),
  lenderPattern: z.enum(["embedded-interest", "separate-interest"]).nullable(),
  executionStrategy: z.enum(["actual-formula-rule", "bench-periodic", "bench-daily"]),
  driftToleranceMinor: minor.nullish(),
  lenderChargeGraceDays: z.number().int(),
  onboardingDate: isoDate.nullable(),
  loanPaymentCategoryId: id.nullable(),
  drawCategoryId: id.nullable(),
  expectedObservationIntervalDays: z.number().int().nullable(),
  status: z.enum(["draft", "active"]),
  /** Validated strictly by the `rd084.debt-config` parser in the service. */
  config: z.unknown(),
  rates: z.array(rate).max(500),
  offsets: z.array(offset).max(50),
  assumptions: z.array(assumptionSchema).max(1_000),
  changeSummary: z.string().max(500).optional(),
});

export const debtSaveRequestSchema = z.strictObject({ debt: debtSaveSchema, accountDirectory: accountDirectorySchema });

export const scheduleRequestSchema = z.strictObject({
  from: isoDate,
  to: isoDate,
  resolution: z.enum(["events", "monthly", "yearly"]).optional(),
  overrides: z
    .strictObject({
      assumptions: z
        .array(
          z.union([
            z.strictObject({ kind: z.enum(["extra-repayment", "draw"]), date: isoDate, amountMinor: minor, recurrence: z.strictObject({ frequency: z.enum(["weekly", "fortnightly", "monthly", "quarterly", "annual"]), until: isoDate }).optional() }),
            z.strictObject({ kind: z.enum(["offset-deposit", "offset-withdrawal"]), date: isoDate, accountId: id, amountMinor: minor, recurrence: z.strictObject({ frequency: z.enum(["weekly", "fortnightly", "monthly", "quarterly", "annual"]), until: isoDate }).optional() }),
            z.strictObject({ kind: z.literal("payment-change"), date: isoDate, amountMinor: minor }),
          ])
        )
        .max(1_000)
        .optional(),
      rates: z.array(z.strictObject({ accrualEffectiveFrom: isoDate, annualRateDecimal: decimal })).max(500).optional(),
    })
    .optional(),
});

export const assumptionsRequestSchema = z.strictObject({ assumptions: z.array(assumptionSchema).max(1_000), changeSummary: z.string().max(500) });

/** Parse a body or throw a validation error naming the first problems. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new DebtConfigValidationError(result.error.issues.slice(0, 20).map((i) => ({ field: i.path.map(String).join(".") || "(body)", message: i.message })));
  }
  return result.data;
}

/** Validation issues come back field by field; everything else uses the app-DB mapping. */
export function assetsDebtErrorResponse(error: unknown): NextResponse {
  if (error instanceof DebtConfigValidationError) {
    return NextResponse.json({ error: "The debt configuration is not valid.", code: "DEBT_CONFIG_INVALID", issues: error.issues }, { status: 400 });
  }
  if (error instanceof AppDbValidationError && error.message === "Debt not found") {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  return appDbErrorResponse(error);
}
