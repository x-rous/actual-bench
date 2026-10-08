import type { BusinessDayConvention } from "../calendar/businessDays";
import type { IsoDate } from "../calendar/dates";
import type { ScheduleFrequency } from "../calendar/schedule";
import type { DebtConfig } from "./configSchema";
import type { CalculationProfile, RecastPolicy } from "./profile";
import type { RatePeriod } from "./rates";
import type { EngineVersions } from "./versions";
import type { FeeTreatment } from "./fees";
import type { LenderStatementSettings } from "./lenderStatement";

/**
 * Engine inputs and outputs (contracts/engine-and-projection.md).
 *
 * Money crosses this boundary as integer minor units; decimal quantities
 * (rates, carried remainders) as exact decimal strings. Every amount is a
 * positive magnitude of debt unless a field says it is signed.
 */

export type Currency = { code: string; minorDigits: number };

export type DebtTerms = DebtConfig["terms"];
export type PaymentComponent = DebtConfig["components"][number];
export type RevolvingModel = NonNullable<DebtConfig["revolving"]>;

/** An interest-only window, the only representation of interest-only (FR-036, FR-058). */
export type DebtPhase = { kind: "interest-only"; from: IsoDate; to: IsoDate; recastAtEnd: RecastPolicy };

export type OffsetLink = {
  id: string;
  accountId: string;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  percentageBps: number;
  basis: "cleared" | "total";
  capMinor: number | null;
  /** Simulated funding rule; absent in historical snapshots and therefore false. */
  fundScheduledRepayments?: boolean;
  /** Optional first date that generated repayments may draw cash; absent means the link start. */
  fundScheduledRepaymentsFrom?: IsoDate | null;
  /** Read-only Actual history source; absent in historical snapshots means false. */
  useActualBalance?: boolean;
};

/** Baseline future assumptions (data-model `debt_future_assumptions`); never a scenario. */
export type FutureAssumption =
  | { kind: "extra-repayment"; date: IsoDate; amountMinor: number; recurrence?: Recurrence }
  | { kind: "draw"; date: IsoDate; amountMinor: number; recurrence?: Recurrence }
  | { kind: "fee"; date: IsoDate; amountMinor: number; treatment: FeeTreatment; recurrence?: Recurrence }
  | { kind: "payment-change"; date: IsoDate; amountMinor: number }
  | { kind: "offset-balance"; date: IsoDate; accountId: string; balanceMinor: number }
  | { kind: "offset-deposit"; date: IsoDate; accountId: string; amountMinor: number; recurrence?: Recurrence }
  | { kind: "offset-withdrawal"; date: IsoDate; accountId: string; amountMinor: number; recurrence?: Recurrence };

export type Recurrence = { frequency: Exclude<ScheduleFrequency, "custom-dated" | "semi-monthly">; until: IsoDate };

export type LoanModelSnapshot = {
  debtId: string;
  revision: number;
  currency: Currency;
  behaviorClass: "term-loan" | "revolving-credit" | "receivable-loan";
  lenderPattern: "embedded-interest" | "separate-interest" | null;
  terms: DebtTerms;
  profile: CalculationProfile;
  rates: RatePeriod[];
  phases: DebtPhase[];
  offsets: OffsetLink[];
  components: PaymentComponent[];
  /** Contractual dates on which the payment is recalculated, independent of rate changes. */
  paymentRecasts: { date: IsoDate }[];
  assumptions: FutureAssumption[];
  revolving: RevolvingModel | null;
  /** Scheduled-date business-day adjustment (config v3); absent or `none` leaves dates as generated. */
  businessDays?: BusinessDayConvention | null;
  /** How lender statements allocate interest (config v3); reporting only, never the accrual. */
  lenderStatement?: LenderStatementSettings | null;
};

/** Modelled starting state (FR-060): the closing state of `date`. */
export type Anchor = {
  date: IsoDate;
  principalMinor: number;
  /** Interest accrued but not yet charged at the anchor. */
  accruedInterestMinor: number | null;
  /** Accrued interest exactly (from a closing state); overrides `accruedInterestMinor`. */
  accruedInterestExact?: string | null;
  /** Sub-minor remainder carried under `carry-full-precision`, as a decimal string. */
  carriedRemainder?: string | null;
  /** The scheduled payment in force at the anchor, if known (needed for payment caps). */
  scheduledPaymentMinor?: number | null;
  source: string;
};

export type EventRef = { source: "actual" | "assumption" | "observation"; id: string };

/** Dated facts loaded once from Actual or observations (FR-051); never fetched per day. */
export type LedgerEvent =
  | { kind: "repayment"; date: IsoDate; amountMinor: number; ref: EventRef }
  | { kind: "extra-repayment"; date: IsoDate; amountMinor: number; ref: EventRef }
  | { kind: "draw"; date: IsoDate; amountMinor: number; ref: EventRef }
  | { kind: "fee"; date: IsoDate; amountMinor: number; treatment: FeeTreatment; ref: EventRef }
  | { kind: "offset-balance"; date: IsoDate; accountId: string; balanceMinor: number; clearedBalanceMinor: number }
  | { kind: "offset-deposit"; date: IsoDate; accountId: string; amountMinor: number; ref: EventRef }
  | { kind: "offset-withdrawal"; date: IsoDate; accountId: string; amountMinor: number; ref: EventRef }
  | { kind: "lender-interest-charge"; date: IsoDate; amountMinor: number; ref: EventRef };

export type SimulationOptions = {
  /**
   * Generate the contract's scheduled repayments (projection). Off when the
   * request's `repayment` events are the complete, observed history.
   */
  generateScheduledRepayments?: boolean;
  /** Apply baseline `model.assumptions` (projection); off for pure history. */
  applyAssumptions?: boolean;
};

export type SimulationRequest = {
  model: LoanModelSnapshot;
  anchor: Anchor;
  events: LedgerEvent[];
  /** Inclusive; the first simulated day is the day after the anchor. */
  from?: IsoDate;
  to: IsoDate;
  options?: SimulationOptions;
};

export type Certainty = "observed" | "contractual" | "scheduled" | "modelled" | "assumed";

export type ModelEventType =
  | "repayment"
  | "extra-repayment"
  | "draw"
  | "fee"
  | "interest-charge"
  | "negative-amortization"
  | "rate-change"
  | "recast"
  | "final-payment"
  | "balloon"
  | "residual";

/** One financial event with its full explanation (FR-111, and diagnostics for audit). */
export type ModelEvent = {
  date: IsoDate;
  type: ModelEventType;
  certainty: Certainty;
  ref: EventRef | null;
  /** Signed, household cash perspective: money out is negative. 0 for charges and capitalization. */
  cashMovementMinor: number;
  /**
   * Signed change in the outstanding debt caused by this event: always
   * `balanceAfterMinor − balanceBeforeMinor`. Interest charged by the event
   * is also in `interestMinor`; each unit of interest appears in exactly one
   * event.
   */
  principalMovementMinor: number;
  interestMinor: number;
  feesMinor: number;
  balanceBeforeMinor: number;
  balanceAfterMinor: number;
  /** Economic-kind split of a payment (FR-011, FR-066); Σ lines = |cash|. */
  lines: { kind: ComponentKind; amountMinor: number }[];
  diagnostics: Record<string, string | number | boolean | null>;
};

export type ComponentKind = "principal" | "interest" | "fee" | "escrow" | "insurance" | "tax" | "draw" | "other";

export type ClosingState = {
  date: IsoDate;
  principalMinor: number;
  accruedInterestMinor: number;
  /** Accrued interest exactly, so a later run resumes without rounding it. */
  accruedInterestExact: string;
  carriedRemainder: string | null;
  scheduledPaymentMinor: number | null;
  paidOff: boolean;
};

/** Authoritative offset state after every effective dated offset transition. */
export type OffsetStatePoint = {
  date: IsoDate;
  accountId: string;
  balanceMinor: number;
  clearedBalanceMinor: number;
  /** Sum of non-negative balances for offset accounts whose links are in force on this date. */
  totalBalanceMinor: number;
};

export type PeriodSummary = {
  period: string;
  from: IsoDate;
  to: IsoDate;
  openingMinor: number;
  interestMinor: number;
  feesMinor: number;
  repaidMinor: number;
  drawnMinor: number;
  closingMinor: number;
};

export type BlockReason = {
  code:
    | "rate-gap"
    | "inconsistent-profile"
    | "unsupported-profile"
    | "irregular-first-period"
    | "mid-period-rate-change"
    | "irregular-event"
    | "offsets-need-daily-engine"
    | "negative-amortization"
    | "negative-repayment"
    | "credit-balance"
    | "offset-withdrawal-exceeds-balance"
    | "conflicting-offset-snapshot"
    | "conflicting-offset-funding-source"
    | "missing-payment"
    | "credit-limit-exceeded";
  classification: "review" | "blocked";
  date: IsoDate | null;
  message: string;
  diagnostics?: Record<string, string | number | boolean | null>;
};

export type SimulationResult =
  | { ok: true; events: ModelEvent[]; offsetStates: OffsetStatePoint[]; periods: PeriodSummary[]; closing: ClosingState; versions: EngineVersions }
  | { ok: false; blocked: BlockReason[]; versions: EngineVersions };

export function blocked(reason: BlockReason, versions: EngineVersions): SimulationResult {
  return { ok: false, blocked: [reason], versions };
}
