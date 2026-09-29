import { AppDbValidationError } from "@/lib/app-db/errors";
import { listDebtAssumptions, replaceDebtAssumptions, type AssumptionInput } from "@/lib/app-db/debtAssumptionRepository";
import { listDebtOffsetLinks, replaceDebtOffsetLinks, type OffsetLinkInput } from "@/lib/app-db/debtOffsetLinkRepository";
import { listDebtRates, replaceDebtRates, type RatePeriodInput } from "@/lib/app-db/debtRateRepository";
import {
  archiveDebt,
  deleteDraftDebt,
  getDebt,
  insertDebt,
  listDebts,
  listLiveLiabilityAccountIds,
  setDebtCurrentRevision,
  updateDebt,
  type DebtFields,
} from "@/lib/app-db/debtRepository";
import { getLatestModelRevision, insertModelRevision, revisionHash } from "@/lib/app-db/modelRevisionRepository";
import {
  BEHAVIOR_CLASSES,
  DEBT_ASSUMPTION_KINDS,
  DEBT_TYPES,
  EXECUTION_STRATEGIES,
  FEE_TREATMENT_VALUES,
  LENDER_PATTERNS,
  OFFSET_BALANCE_BASES,
  PER_RATE_RECAST_POLICIES,
  SIGN_CONVENTIONS,
  isKnownEnum,
  type DebtAssumptionRecord,
  type DebtOffsetLinkRecord,
  type DebtRatePeriodRecord,
  type DebtRecord,
  type SqliteDatabase,
} from "@/lib/app-db/types";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { parseDebtConfig, type DebtConfigParse, type DebtConfigV1 } from "@/lib/financial-models/loan/configSchema";
import { cmp, dec, sign, toPlainString } from "@/lib/financial-models/money/kernel";
import { recastPolicyFor } from "@/lib/financial-models/loan/recast";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";
import { crossesBudgetBoundary, type AccountDirectory } from "../actual/ledgerPort";
import { buildDebtRevisionSnapshot, DEBT_REVISION_FORMAT, DEBT_REVISION_VERSION } from "./materialChange";

/**
 * Debt configuration (RD-084 P1.3; FR-001, FR-002, FR-010, FR-011a, FR-020–FR-025,
 * FR-043, FR-055, FR-110, FR-151).
 *
 * Saving validates, persists Bench configuration and writes a model revision
 * in one transaction. It performs **no** Actual write: this module takes no
 * transport, only an account directory the caller read through the ledger
 * port, and nothing it imports can post to Actual (FR-002).
 *
 * The database checks structure; the semantic rules live here: supported
 * config identifiers, canonical decimals, floor ≤ cap, per-rate recast
 * overrides, rate/recast consistency, same-budget offsets, and Actual account
 * and category existence.
 */

export type ValidationIssue = { field: string; message: string };

export class DebtConfigValidationError extends AppDbValidationError {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.field}: ${i.message}`).join("; "));
    this.name = "DebtConfigValidationError";
    this.issues = issues;
  }
}

/** Decimal inputs arrive as strings in any exact form ("0.06120"); they are stored canonical ("0.0612"). */
export type RatePeriodSaveInput = Omit<RatePeriodInput, "paymentRecalcPolicy"> & { paymentRecalcPolicy: string | null };

export type DebtSaveInput = Omit<DebtFields, "currentConfigJson"> & {
  status: "draft" | "active";
  config: unknown;
  rates: RatePeriodSaveInput[];
  offsets: OffsetLinkInput[];
  assumptions: AssumptionInput[];
  changeSummary?: string;
};

export type DebtBlock = { code: "unsupported-value" | "unsupported-config" | "invalid-config"; message: string };

export type DebtDetail = {
  debt: DebtRecord;
  config: DebtConfigParse;
  rates: DebtRatePeriodRecord[];
  offsets: DebtOffsetLinkRecord[];
  assumptions: DebtAssumptionRecord[];
  revision: { number: number; hash: string | null; createdAt: string | null };
  /** Non-null: this debt is Blocked; other debts are unaffected (schema-review A-2). */
  blocked: DebtBlock | null;
};

const NEWER_VERSION = "Configured by a newer version of Actual Bench. Update Actual Bench to use this debt.";

// ── Validation ───────────────────────────────────────────────────────────────

function canonicalDecimal(value: unknown, field: string, issues: ValidationIssue[], opts: { positive?: boolean } = {}): string | null {
  if (typeof value === "number") {
    issues.push({ field, message: "must be an exact decimal string, not a number" });
    return null;
  }
  let parsed;
  try {
    parsed = dec(String(value));
  } catch {
    issues.push({ field, message: "must be a decimal such as 0.0612" });
    return null;
  }
  if (typeof value !== "string" || /e/i.test(value)) {
    issues.push({ field, message: "must be a decimal such as 0.0612" });
    return null;
  }
  if (sign(parsed) < 0) {
    issues.push({ field, message: "negative values are not supported in configuration version 1" });
    return null;
  }
  if (opts.positive && sign(parsed) === 0) {
    issues.push({ field, message: "must be greater than zero" });
    return null;
  }
  return toPlainString(parsed);
}

type Normalized = { fields: DebtFields; config: DebtConfigV1; rates: RatePeriodInput[]; offsets: OffsetLinkInput[]; assumptions: AssumptionInput[] };

export function validateDebtSave(
  db: SqliteDatabase,
  input: DebtSaveInput,
  directory: AccountDirectory,
  existingDebtId?: string
): { ok: true; value: Normalized } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const active = input.status === "active";

  if (directory.budgetSyncId !== input.budgetSyncId) {
    add("accountDirectory", "The accounts were read from a different budget than this debt belongs to.");
  }
  const accounts = new Map(directory.accounts.map((a) => [a.id, a]));
  const categories = new Map(directory.categories.map((c) => [c.id, c]));

  // Enum fields: known identifiers only.
  const oneOf = <T extends string>(values: readonly T[], value: unknown, field: string) => {
    if (typeof value !== "string" || !(values as readonly string[]).includes(value)) add(field, `must be one of ${values.join(", ")}`);
  };
  oneOf(DEBT_TYPES, input.debtType, "debtType");
  oneOf(BEHAVIOR_CLASSES, input.behaviorClass, "behaviorClass");
  oneOf(SIGN_CONVENTIONS, input.signConvention, "signConvention");
  oneOf(EXECUTION_STRATEGIES, input.executionStrategy, "executionStrategy");
  if (typeof input.name !== "string" || !input.name.trim()) add("name", "is required");
  if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) add("currency", "must be a three-letter code such as AUD");
  if (!Number.isInteger(input.currencyMinorDigits) || input.currencyMinorDigits < 0 || input.currencyMinorDigits > 4) add("currencyMinorDigits", "must be 0 to 4");
  if (!Number.isInteger(input.lenderChargeGraceDays) || input.lenderChargeGraceDays < 0) add("lenderChargeGraceDays", "must be zero or more days");
  if (input.driftToleranceMinor != null && (!Number.isInteger(input.driftToleranceMinor) || input.driftToleranceMinor < 0)) add("driftToleranceMinor", "must be zero or more");
  if (input.expectedObservationIntervalDays != null && (!Number.isInteger(input.expectedObservationIntervalDays) || input.expectedObservationIntervalDays < 1)) {
    add("expectedObservationIntervalDays", "must be at least one day, or empty");
  }
  if (input.onboardingDate != null && !isIsoDate(input.onboardingDate)) add("onboardingDate", "must be a date");

  // Lender pattern: required for a term loan once active; not used by revolving credit or receivables.
  if (input.behaviorClass === "term-loan") {
    if (input.lenderPattern !== null) oneOf(LENDER_PATTERNS, input.lenderPattern, "lenderPattern");
    else if (active) add("lenderPattern", "choose how the lender records interest");
  } else if (input.lenderPattern !== null) {
    add("lenderPattern", "applies only to term loans");
  }

  // The calculation contract: strict, versioned, supported identifiers only.
  const parsed = parseDebtConfig(input.config);
  let config: DebtConfigV1 | null = null;
  if (!parsed.ok) for (const issue of parsed.issues) add(`config.${issue}`.replace(/^config\.\(root\)/, "config"), parsed.code);
  else config = parsed.config;

  // Accounts in this budget.
  const liability = input.liabilityAccountId ? accounts.get(input.liabilityAccountId) : undefined;
  const payment = input.paymentAccountId ? accounts.get(input.paymentAccountId) : undefined;
  if (input.liabilityAccountId && !liability) add("liabilityAccountId", "is not an account in this budget");
  if (input.paymentAccountId && !payment) add("paymentAccountId", "is not an account in this budget");
  if (active && !input.liabilityAccountId) add("liabilityAccountId", "is required before the debt can be active");
  if (active && liability?.closed) add("liabilityAccountId", "is a closed account");
  if (input.liabilityAccountId && input.liabilityAccountId === input.paymentAccountId) add("paymentAccountId", "must differ from the liability account");
  const otherLiabilities = new Set(listLiveLiabilityAccountIds(db, input.budgetSyncId, existingDebtId));
  if (input.liabilityAccountId && otherLiabilities.has(input.liabilityAccountId)) add("liabilityAccountId", "is already the liability account of another debt");

  // Budget-boundary categories (FR-011a): existing categories only, required only when crossing.
  const checkCategory = (id: string | null, field: string) => {
    if (!id) return;
    const category = categories.get(id);
    if (!category) add(field, "is not a category in this budget");
    else if (category.isIncome) add(field, "must be an expense category");
  };
  checkCategory(input.loanPaymentCategoryId, "loanPaymentCategoryId");
  checkCategory(input.drawCategoryId, "drawCategoryId");
  const crosses = !!(liability && payment && crossesBudgetBoundary(liability, payment));
  if (active && crosses && !input.loanPaymentCategoryId) {
    add("loanPaymentCategoryId", "is required: repayments cross the budget boundary, so the on-budget side needs a category");
  }
  const draws = input.behaviorClass === "revolving-credit" || input.assumptions.some((a) => a.kind === "draw");
  if (active && crosses && draws && !input.drawCategoryId) {
    add("drawCategoryId", "is required: draws cross the budget boundary, so the on-budget side needs a category");
  }
  if (config) {
    config.components.forEach((c, i) => {
      if (c.categoryId && !categories.has(c.categoryId)) add(`config.components.${i}.categoryId`, "is not a category in this budget");
    });
  }

  // Rate periods (FR-043; G1 D-5, D-15, per-rate override subset).
  const rates: RatePeriodInput[] = [];
  const accrualDates = new Set<string>();
  input.rates.forEach((r, i) => {
    const f = (name: string) => `rates.${i}.${name}`;
    if (!isIsoDate(r.accrualEffectiveFrom)) add(f("accrualEffectiveFrom"), "must be a date");
    else if (accrualDates.has(r.accrualEffectiveFrom)) add(f("accrualEffectiveFrom"), "another rate period starts on the same date");
    else accrualDates.add(r.accrualEffectiveFrom);
    if (r.paymentEffectiveFrom != null && !isIsoDate(r.paymentEffectiveFrom)) add(f("paymentEffectiveFrom"), "must be a date");
    if (r.announcedAt != null && !isIsoDate(r.announcedAt)) add(f("announcedAt"), "must be a date");
    const annual = canonicalDecimal(r.annualRateDecimal, f("annualRateDecimal"), issues);
    const capRate = r.rateCapDecimal == null ? null : canonicalDecimal(r.rateCapDecimal, f("rateCapDecimal"), issues);
    const floor = r.rateFloorDecimal == null ? null : canonicalDecimal(r.rateFloorDecimal, f("rateFloorDecimal"), issues);
    if (capRate !== null && floor !== null && cmp(dec(floor), dec(capRate)) > 0) add(f("rateFloorDecimal"), "must not be above the rate cap");
    let policy: RatePeriodInput["paymentRecalcPolicy"] = null;
    if (r.paymentRecalcPolicy != null) {
      if ((PER_RATE_RECAST_POLICIES as readonly string[]).includes(r.paymentRecalcPolicy)) policy = r.paymentRecalcPolicy as RatePeriodInput["paymentRecalcPolicy"];
      else add(f("paymentRecalcPolicy"), `must be ${PER_RATE_RECAST_POLICIES.join(", ")}; annual and contract-date recasts are set on the contract, not on a rate`);
    }
    let paymentCap: RatePeriodInput["paymentCap"] = null;
    if (r.paymentCap) {
      if (r.paymentCap.kind === "absolute") {
        if (!Number.isSafeInteger(r.paymentCap.amountMinor) || r.paymentCap.amountMinor < 1) add(f("paymentCap.amountMinor"), "must be a positive whole amount");
        else paymentCap = { kind: "absolute", amountMinor: r.paymentCap.amountMinor };
      } else if (r.paymentCap.kind === "previous-payment-factor") {
        const factor = canonicalDecimal(r.paymentCap.factor, f("paymentCap.factor"), issues, { positive: true });
        if (factor !== null) paymentCap = { kind: "previous-payment-factor", factor };
      } else {
        add(f("paymentCap.kind"), "must be absolute or previous-payment-factor");
      }
    }
    // Rate/recast consistency: a payment date or a payment cap only matter when this change recasts.
    if (config && (r.paymentEffectiveFrom || paymentCap)) {
      const effective = recastPolicyFor({ accrualEffectiveFrom: r.accrualEffectiveFrom, annualRateDecimal: annual ?? "0", paymentRecalcPolicy: policy }, config.profile as CalculationProfile);
      if (effective !== "on-rate-change") {
        add(f(r.paymentEffectiveFrom ? "paymentEffectiveFrom" : "paymentCap"), "applies only when this rate change recalculates the payment (on-rate-change)");
      }
    }
    if (annual !== null) {
      rates.push({
        id: r.id ?? null,
        announcedAt: r.announcedAt ?? null,
        accrualEffectiveFrom: r.accrualEffectiveFrom,
        annualRateDecimal: annual,
        paymentRecalcPolicy: policy,
        paymentEffectiveFrom: r.paymentEffectiveFrom ?? null,
        rateCapDecimal: capRate,
        rateFloorDecimal: floor,
        paymentCap,
        source: r.source ?? null,
        note: r.note ?? null,
      });
    }
  });
  if (active && config) {
    const opening = config.terms.openingDate;
    if (input.rates.length === 0) add("rates", "an active debt needs at least one rate period");
    else if (!input.rates.some((r) => r.accrualEffectiveFrom <= opening)) add("rates", `no rate applies on the opening date ${opening}`);
  }

  // Offset links (FR-055): same budget, open, not a liability account.
  input.offsets.forEach((o, i) => {
    const f = (name: string) => `offsets.${i}.${name}`;
    const account = accounts.get(o.actualAccountId);
    if (!account) add(f("actualAccountId"), "is not an account in this budget (offset accounts must be in the debt's own budget)");
    else if (account.closed) add(f("actualAccountId"), "is a closed account");
    if (o.actualAccountId === input.liabilityAccountId) add(f("actualAccountId"), "cannot be the debt's own liability account");
    else if (otherLiabilities.has(o.actualAccountId)) add(f("actualAccountId"), "is another debt's liability account, not a cash account");
    if (!isIsoDate(o.effectiveFrom)) add(f("effectiveFrom"), "must be a date");
    if (o.effectiveTo != null && (!isIsoDate(o.effectiveTo) || o.effectiveTo <= o.effectiveFrom)) add(f("effectiveTo"), "must be a date after the start");
    if (!Number.isInteger(o.offsetPercentageBps) || o.offsetPercentageBps < 1 || o.offsetPercentageBps > 10_000) add(f("offsetPercentageBps"), "must be between 0.01% and 100%");
    oneOf(OFFSET_BALANCE_BASES, o.balanceBasis, f("balanceBasis"));
    if (o.capMinor != null && (!Number.isSafeInteger(o.capMinor) || o.capMinor < 1)) add(f("capMinor"), "must be a positive amount, or empty");
    input.offsets.slice(0, i).forEach((prev) => {
      const overlaps = prev.actualAccountId === o.actualAccountId && (prev.effectiveTo == null || prev.effectiveTo > o.effectiveFrom) && (o.effectiveTo == null || o.effectiveTo > prev.effectiveFrom);
      if (overlaps) add(f("effectiveFrom"), "overlaps another link for the same account");
    });
  });

  // Baseline assumptions (FR-110): each kind's required and forbidden fields.
  const offsetAccounts = new Set(input.offsets.map((o) => o.actualAccountId));
  input.assumptions.forEach((a, i) => {
    const f = (name: string) => `assumptions.${i}.${name}`;
    oneOf(DEBT_ASSUMPTION_KINDS, a.kind, f("kind"));
    if (!isIsoDate(a.effectiveFrom)) add(f("effectiveFrom"), "must be a date");
    const positive = a.kind === "extra-repayment" || a.kind === "draw" || a.kind === "fee";
    if (!Number.isSafeInteger(a.amountMinor) || a.amountMinor < (positive ? 1 : 0)) add(f("amountMinor"), positive ? "must be a positive amount" : "must be zero or more");
    if (a.kind === "fee") oneOf(FEE_TREATMENT_VALUES, a.feeTreatment, f("feeTreatment"));
    else if (a.feeTreatment) add(f("feeTreatment"), "only a fee has a treatment");
    if (a.kind === "offset-balance") {
      if (!a.offsetAccountId || !offsetAccounts.has(a.offsetAccountId)) add(f("offsetAccountId"), "must be one of this debt's offset accounts");
    } else if (a.offsetAccountId) {
      add(f("offsetAccountId"), "only an offset-balance assumption names an account");
    }
    if (a.recurrence) {
      if (!["extra-repayment", "draw", "fee"].includes(a.kind)) add(f("recurrence"), "only extra repayments, draws and fees can recur");
      if (!["weekly", "fortnightly", "monthly", "quarterly", "annual"].includes(a.recurrence.frequency)) add(f("recurrence.frequency"), "must be weekly, fortnightly, monthly, quarterly or annual");
      if (!isIsoDate(a.recurrence.until) || a.recurrence.until < a.effectiveFrom) add(f("recurrence.until"), "must be a date on or after the first date");
    }
  });

  if (issues.length > 0 || !config) return { ok: false, issues };
  return {
    ok: true,
    value: {
      fields: {
        budgetSyncId: input.budgetSyncId,
        name: input.name.trim(),
        debtType: input.debtType,
        behaviorClass: input.behaviorClass,
        currency: input.currency,
        currencyMinorDigits: input.currencyMinorDigits,
        liabilityAccountId: input.liabilityAccountId || null,
        paymentAccountId: input.paymentAccountId || null,
        signConvention: input.signConvention,
        lenderPattern: input.lenderPattern,
        executionStrategy: input.executionStrategy,
        driftToleranceMinor: input.driftToleranceMinor ?? null,
        lenderChargeGraceDays: input.lenderChargeGraceDays,
        onboardingDate: input.onboardingDate ?? null,
        loanPaymentCategoryId: input.loanPaymentCategoryId || null,
        drawCategoryId: input.drawCategoryId || null,
        expectedObservationIntervalDays: input.expectedObservationIntervalDays ?? null,
        currentConfigJson: JSON.stringify(config),
      },
      config,
      rates,
      offsets: input.offsets.map((o) => ({ ...o, effectiveTo: o.effectiveTo ?? null, capMinor: o.capMinor ?? null })),
      assumptions: input.assumptions.map((a) => ({ ...a, recurrence: a.recurrence ?? null, feeTreatment: a.feeTreatment ?? null, offsetAccountId: a.offsetAccountId ?? null, note: a.note ?? null })),
    },
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

function blockFor(debt: DebtRecord, config: DebtConfigParse, rates: DebtRatePeriodRecord[], offsets: DebtOffsetLinkRecord[], assumptions: DebtAssumptionRecord[]): DebtBlock | null {
  const unknown = [
    ...debt.unknownValues,
    ...rates.flatMap((r) => [r.paymentRecalcPolicy, r.paymentCap?.kind].filter((v) => v !== null && v !== undefined && !isKnownEnum(v as never)).map(() => "rate period")),
    ...offsets.filter((o) => !isKnownEnum(o.balanceBasis)).map(() => "offset link"),
    ...assumptions.filter((a) => !isKnownEnum(a.assumptionKind) || (a.feeTreatment !== null && !isKnownEnum(a.feeTreatment)) || (a.recurrence !== null && "unknown" in a.recurrence)).map(() => "assumption"),
  ];
  if (unknown.length > 0) return { code: "unsupported-value", message: NEWER_VERSION };
  if (!config.ok) return config.code === "unsupported-config" ? { code: "unsupported-config", message: NEWER_VERSION } : { code: "invalid-config", message: `The saved configuration cannot be used: ${config.issues.join("; ")}` };
  return null;
}

export function getDebtDetail(db: SqliteDatabase, id: string): DebtDetail | null {
  const debt = getDebt(db, id);
  if (!debt) return null;
  const config = parseDebtConfig(debt.currentConfigJson);
  const rates = listDebtRates(db, id);
  const offsets = listDebtOffsetLinks(db, id);
  const assumptions = listDebtAssumptions(db, id);
  const latest = getLatestModelRevision(db, "debt", id);
  return {
    debt,
    config,
    rates,
    offsets,
    assumptions,
    revision: { number: debt.currentRevision, hash: latest?.configHash ?? null, createdAt: latest?.createdAt ?? null },
    blocked: blockFor(debt, config, rates, offsets, assumptions),
  };
}

export type DebtSummary = {
  id: string;
  name: string;
  debtType: DebtRecord["debtType"];
  behaviorClass: DebtRecord["behaviorClass"];
  status: DebtRecord["status"];
  currency: string;
  currencyMinorDigits: number;
  liabilityAccountId: string | null;
  executionStrategy: DebtRecord["executionStrategy"];
  openingPrincipalMinor: number | null;
  currentRevision: number;
  blocked: DebtBlock | null;
};

/** Every debt in a budget. One debt Blocked for an unsupported config never hides the others. */
export function listDebtSummaries(db: SqliteDatabase, budgetSyncId: string, includeArchived = false): DebtSummary[] {
  return listDebts(db, { budgetSyncId, includeArchived }).map((debt) => {
    const detail = getDebtDetail(db, debt.id)!;
    return {
      id: debt.id,
      name: debt.name,
      debtType: debt.debtType,
      behaviorClass: debt.behaviorClass,
      status: debt.status,
      currency: debt.currency,
      currencyMinorDigits: debt.currencyMinorDigits,
      liabilityAccountId: debt.liabilityAccountId,
      executionStrategy: debt.executionStrategy,
      openingPrincipalMinor: detail.config.ok ? detail.config.config.terms.openingPrincipalMinor : null,
      currentRevision: debt.currentRevision,
      blocked: detail.blocked,
    };
  });
}

// ── Writes (configuration only; never Actual) ────────────────────────────────

function writeRevisionIfMaterial(db: SqliteDatabase, id: string, changeSummary: string | undefined, now: string): number {
  const detail = getDebtDetail(db, id)!;
  if (!detail.config.ok) throw new AppDbValidationError("The saved configuration no longer parses");
  const snapshot = buildDebtRevisionSnapshot({ debt: detail.debt, config: detail.config.config, rates: detail.rates, offsets: detail.offsets, assumptions: detail.assumptions });
  const latest = getLatestModelRevision(db, "debt", id);
  if (latest && latest.configHash === revisionHash(snapshot)) return latest.revision;
  const revision = (latest?.revision ?? 0) + 1;
  insertModelRevision(db, { subjectKind: "debt", subjectId: id, revision, configFormat: DEBT_REVISION_FORMAT, configVersion: DEBT_REVISION_VERSION, snapshot, changeSummary }, now);
  setDebtCurrentRevision(db, id, revision);
  return revision;
}

function saveChildren(db: SqliteDatabase, id: string, value: Normalized, now: string) {
  replaceDebtRates(db, id, value.rates, now);
  replaceDebtOffsetLinks(db, id, value.offsets, now);
  replaceDebtAssumptions(db, id, value.assumptions, now);
}

export function createDebtConfiguration(db: SqliteDatabase, input: DebtSaveInput, directory: AccountDirectory, now = new Date().toISOString()): DebtDetail {
  const result = validateDebtSave(db, input, directory);
  if (!result.ok) throw new DebtConfigValidationError(result.issues);
  const value = result.value;
  const id = db.transaction(() => {
    const debt = insertDebt(db, { ...value.fields, status: input.status, currentRevision: 1 }, now);
    saveChildren(db, debt.id, value, now);
    writeRevisionIfMaterial(db, debt.id, input.changeSummary ?? "Created", now);
    return debt.id;
  })() as string;
  return getDebtDetail(db, id)!;
}

/**
 * Save an edited debt. A new revision is written only when the material
 * snapshot changed; renaming or editing a note updates the rows and keeps the
 * current revision.
 */
export function updateDebtConfiguration(db: SqliteDatabase, id: string, input: DebtSaveInput, directory: AccountDirectory, now = new Date().toISOString()): DebtDetail {
  const existing = getDebt(db, id);
  if (!existing) throw new AppDbValidationError("Debt not found");
  if (existing.status === "archived") throw new AppDbValidationError("An archived debt cannot be edited");
  if (existing.status === "active" && input.status === "draft") throw new DebtConfigValidationError([{ field: "status", message: "an active debt cannot return to draft" }]);
  const result = validateDebtSave(db, input, directory, id);
  if (!result.ok) throw new DebtConfigValidationError(result.issues);
  db.transaction(() => {
    updateDebt(db, id, { ...result.value.fields, status: input.status, currentRevision: existing.currentRevision }, now);
    saveChildren(db, id, result.value, now);
    writeRevisionIfMaterial(db, id, input.changeSummary, now);
  })();
  return getDebtDetail(db, id)!;
}

/**
 * Replace only the baseline assumptions (the calculator's "apply as baseline",
 * FR-110). Writes `debt_future_assumptions` and, when that changes the
 * snapshot, one new revision; nothing else.
 */
export function saveBaselineAssumptions(db: SqliteDatabase, id: string, assumptions: AssumptionInput[], changeSummary: string, now = new Date().toISOString()): DebtDetail {
  const detail = getDebtDetail(db, id);
  if (!detail) throw new AppDbValidationError("Debt not found");
  if (detail.blocked) throw new AppDbValidationError(detail.blocked.message);
  if (detail.debt.status === "archived") throw new AppDbValidationError("An archived debt cannot be edited");
  const issues: ValidationIssue[] = [];
  const offsetAccounts = new Set(detail.offsets.map((o) => o.actualAccountId));
  assumptions.forEach((a, i) => {
    if (!(DEBT_ASSUMPTION_KINDS as readonly string[]).includes(a.kind)) issues.push({ field: `assumptions.${i}.kind`, message: "is not a known assumption kind" });
    if (a.kind === "offset-balance" && (!a.offsetAccountId || !offsetAccounts.has(a.offsetAccountId))) issues.push({ field: `assumptions.${i}.offsetAccountId`, message: "must be one of this debt's offset accounts" });
    const positive = a.kind === "extra-repayment" || a.kind === "draw" || a.kind === "fee";
    if (!Number.isSafeInteger(a.amountMinor) || a.amountMinor < (positive ? 1 : 0)) issues.push({ field: `assumptions.${i}.amountMinor`, message: "must be a valid amount" });
  });
  if (issues.length) throw new DebtConfigValidationError(issues);
  db.transaction(() => {
    replaceDebtAssumptions(db, id, assumptions, now);
    writeRevisionIfMaterial(db, id, changeSummary, now);
  })();
  return getDebtDetail(db, id)!;
}

/** Archive: keeps every revision and frees the liability account. The status change is material, so it is a revision. */
export function archiveDebtConfiguration(db: SqliteDatabase, id: string, now = new Date().toISOString()): DebtDetail {
  const existing = getDebt(db, id);
  if (!existing) throw new AppDbValidationError("Debt not found");
  if (existing.status !== "archived") {
    db.transaction(() => {
      archiveDebt(db, id, existing.currentRevision, now);
      writeRevisionIfMaterial(db, id, "Archived", now);
    })();
  }
  return getDebtDetail(db, id)!;
}

/** Discard a draft entirely (children cascade; the delete trigger removes its revisions). */
export function discardDraftDebt(db: SqliteDatabase, id: string): boolean {
  return deleteDraftDebt(db, id);
}
