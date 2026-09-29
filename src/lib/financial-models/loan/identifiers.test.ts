import { SHORT_MONTH_POLICIES } from "../calendar/dates";
import { SCHEDULE_FREQUENCIES } from "../calendar/schedule";
import { ROUNDING_MODES } from "../money/rounding";
import {
  COMPONENT_AMOUNT_RULES,
  COMPONENT_DESTINATIONS,
  ECONOMIC_KINDS,
  PHASE_KINDS,
  REVOLVING_PAYMENT_MODELS,
} from "./configSchema";
import { DAY_COUNT_IDS } from "./daycount/types";
import { EVENT_ORDER_PLACEMENT_KEYS, PLACEMENTS, SAME_DAY_TIMINGS } from "./events";
import {
  ACCRUAL_METHODS,
  AMORTIZATION_METHODS,
  BALANCE_PRECISIONS,
  CAPITALIZATIONS,
  CHARGE_FREQUENCIES,
  FEE_CAPITALIZATIONS,
  FINAL_PAYMENT_POLICIES,
  RATE_EFFECTIVE_TIMINGS,
  RECAST_POLICIES,
  REPAYMENT_EFFECTIVE_TIMINGS,
} from "./profile";
import { PAYMENT_LIMIT_KINDS, RATE_QUOTES } from "./rates";
import { REPAYMENT_DERIVATIONS } from "./repayment";
import { CALENDAR_VERSION } from "../calendar/dates";
import { SCHEDULE_VERSION } from "../calendar/schedule";
import { MONEY_KERNEL_VERSION } from "../money/kernel";
import { ACT360_VERSION } from "./daycount/act360";
import { ACT365F_VERSION } from "./daycount/act365f";
import { ACTACT_VERSION } from "./daycount/actact";
import { MONTHLY_ALLOC_VERSION } from "./daycount/monthly-30-360-alloc";
import { EVENT_ORDER_VERSION } from "./events";
import { PROFILE_VERSION } from "./profile";
import { RATE_QUOTE_VERSION, RATES_VERSION } from "./rates";
import { REPAYMENT_VERSION } from "./repayment";
import { ACCRUAL_VERSION } from "./accrual";
import { CHARGE_VERSION } from "./charge";
import { DAILY_PRECISION_VERSION } from "./dailyPrecision";
import { OFFSETS_VERSION } from "./offsets";
import { RECAST_VERSION } from "./recast";
import { PHASES_VERSION } from "./phases";
import { FEES_VERSION } from "./fees";
import { ALLOCATION_VERSION } from "./allocation";
import { FINAL_PAYMENT_VERSION } from "./finalPayment";
import { PERIODIC_ENGINE_VERSION } from "./periodic-engine";
import { DAILY_ENGINE_VERSION } from "./daily-engine";
import { REVOLVING_VERSION } from "./revolving";
import { RECEIVABLE_VERSION } from "./receivable";
import { ELIGIBILITY_VERSION } from "./eligibility";
import { DIAGNOSTICS_VERSION } from "./diagnostics";
import { PROJECTION_VERSION } from "./projection";
import { CURRENT_COMPONENT_VERSIONS, DEBT_CONFIG_V1_IDENTIFIERS as FROZEN } from "./versions";

/*
 * The freeze. If this fails, an identifier accepted by config version 1
 * changed. Do not edit the frozen list to make it pass: add a new config
 * version (research R-12) and keep version 1 as it was.
 */
describe("rd084.debt-config v1 identifiers are frozen", () => {
  it.each([
    ["amortization", AMORTIZATION_METHODS],
    ["rateQuote", RATE_QUOTES],
    ["dayCount", DAY_COUNT_IDS],
    ["accrual", ACCRUAL_METHODS],
    ["chargeFrequency", CHARGE_FREQUENCIES],
    ["capitalization", CAPITALIZATIONS],
    ["repaymentFrequency", SCHEDULE_FREQUENCIES],
    ["repaymentDerivation", REPAYMENT_DERIVATIONS],
    ["recast", RECAST_POLICIES],
    ["rateEffectiveTiming", RATE_EFFECTIVE_TIMINGS],
    ["repaymentEffectiveTiming", REPAYMENT_EFFECTIVE_TIMINGS],
    ["roundingMode", ROUNDING_MODES],
    ["balancePrecision", BALANCE_PRECISIONS],
    ["sameDayTiming", SAME_DAY_TIMINGS],
    ["finalPayment", FINAL_PAYMENT_POLICIES],
    ["shortMonth", SHORT_MONTH_POLICIES],
    ["economicKind", ECONOMIC_KINDS],
    ["componentDestination", COMPONENT_DESTINATIONS],
    ["componentAmountRule", COMPONENT_AMOUNT_RULES],
    ["revolvingPaymentModel", REVOLVING_PAYMENT_MODELS],
    ["phaseKind", PHASE_KINDS],
    ["paymentLimitKind", PAYMENT_LIMIT_KINDS],
    ["feeCapitalization", FEE_CAPITALIZATIONS],
  ] as const)("%s", (axis, values) => {
    expect([...values]).toEqual([...FROZEN[axis]]);
  });

  it("eventOrder placement keys and values", () => {
    expect([...EVENT_ORDER_PLACEMENT_KEYS]).toEqual([...FROZEN.eventOrderPlacementKeys]);
    expect([...PLACEMENTS]).toEqual([...FROZEN.placement]);
  });

  it("keeps the P1.1 component versions unchanged", () => {
    expect(CURRENT_COMPONENT_VERSIONS).toMatchObject({
      "money-kernel": "money-kernel@1",
      calendar: "calendar@1",
      schedule: "schedule@1",
      "daycount-act365f": "daycount-act365f@1",
      "daycount-actact-calendar": "daycount-actact-calendar@1",
      "daycount-act360": "daycount-act360@1",
      "daycount-monthly-alloc": "daycount-monthly-alloc@1",
      rates: "rates@1",
      "rate-quote": "rate-quote@1",
      profile: "profile@1",
      "event-order": "event-order@1",
      repayment: "repayment@1",
    });
  });

  it("matches each module's own version constant", () => {
    expect(CURRENT_COMPONENT_VERSIONS).toEqual({
      "money-kernel": MONEY_KERNEL_VERSION,
      calendar: CALENDAR_VERSION,
      schedule: SCHEDULE_VERSION,
      "daycount-act365f": ACT365F_VERSION,
      "daycount-actact-calendar": ACTACT_VERSION,
      "daycount-act360": ACT360_VERSION,
      "daycount-monthly-alloc": MONTHLY_ALLOC_VERSION,
      rates: RATES_VERSION,
      "rate-quote": RATE_QUOTE_VERSION,
      profile: PROFILE_VERSION,
      "event-order": EVENT_ORDER_VERSION,
      repayment: REPAYMENT_VERSION,
      accrual: ACCRUAL_VERSION,
      charge: CHARGE_VERSION,
      "daily-precision": DAILY_PRECISION_VERSION,
      offsets: OFFSETS_VERSION,
      recast: RECAST_VERSION,
      phases: PHASES_VERSION,
      fees: FEES_VERSION,
      allocation: ALLOCATION_VERSION,
      "final-payment": FINAL_PAYMENT_VERSION,
      "loan-periodic": PERIODIC_ENGINE_VERSION,
      "loan-daily": DAILY_ENGINE_VERSION,
      revolving: REVOLVING_VERSION,
      receivable: RECEIVABLE_VERSION,
      eligibility: ELIGIBILITY_VERSION,
      diagnostics: DIAGNOSTICS_VERSION,
      projection: PROJECTION_VERSION,
    });
  });
});
