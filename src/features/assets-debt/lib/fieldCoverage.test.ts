import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DebtAssumptionKind } from "@/lib/app-db/types";
import type { AssumptionInput } from "@/lib/app-db/debtAssumptionRepository";
import type { OffsetLinkInput } from "@/lib/app-db/debtOffsetLinkRepository";
import type { RatePeriodInput } from "@/lib/app-db/debtRateRepository";
import type { DebtFields } from "@/lib/app-db/debtRepository";
import type { DebtConfigV1 } from "@/lib/financial-models/loan/configSchema";
import { DEBT_CONFIG_V2_IDENTIFIERS } from "@/lib/financial-models/loan/versions";
import { newTracking, statesToSaveInput, simKey, type SimulationState } from "./simulatorModel";
import { DAILY_MONTHLY_CHARGE, offsetOf, sim } from "./simulatorTestKit";
import * as vocabulary from "./vocabulary";

/**
 * Field coverage for the simulator-first UI (RD-084 P1.3b T218; SC-016,
 * ux-simulator §15).
 *
 * Every config v1 path and every relational column a debt save writes has
 * exactly one intentional home: a named control on a named surface, or an
 * explicit derived / hidden / removed entry with its reason. The maps are
 * typed against the config and repository types, so adding a field without
 * classifying it fails to compile; the runtime checks fail when a control's
 * label disappears from its surface or a saved config holds an unlisted path.
 */

type Leaf = string | number | boolean | null | undefined;
/** Every leaf path of T: `a.b`, with `[]` for array elements. Distributes over unions. */
type Paths<T, P extends string> = T extends Leaf
  ? P
  : T extends readonly (infer E)[]
    ? Paths<E, `${P}[]`>
    : T extends object
      ? { [K in keyof T & string]-?: Paths<NonNullable<T[K]>, `${P}.${K}`> }[keyof T & string]
      : never;

const SURFACES = {
  header: "components/simulator/SimulatorView.tsx",
  primary: "components/simulator/PrimaryInputs.tsx",
  features: "components/simulator/FeatureControls.tsx",
  interestOnly: "components/simulator/InterestOnlyControl.tsx",
  drawer: "components/simulator/CalculationMethodDrawer.tsx",
  rates: "components/simulator/RateChangesDialog.tsx",
  extras: "components/simulator/ExtraTransactionsDialog.tsx",
  tracking: "components/tracking/TrackingSetup.tsx",
  pages: "components/LoanPages.tsx",
} as const;
type Surface = keyof typeof SURFACES;

/** P primary · C contextual · A calculation method drawer · D dialog · I tracking setup (Actual) · H derived/hidden · R removed. */
type Home = { class: "P" | "C" | "A" | "D" | "I"; surface: Surface; label: string } | { class: "H" | "R"; why: string };

const on = (klass: "P" | "C" | "A" | "D" | "I", surface: Surface, label: string): Home => ({ class: klass, surface, label });
const hidden = (why: string): Home => ({ class: "H", why });

const CONFIG: Record<Paths<DebtConfigV1, "config">, Home> = {
  "config.format": hidden("constant format marker"),
  "config.version": hidden("constant config version"),
  "config.terms.openingDate": on("P", "primary", "Start date"),
  "config.terms.openingPrincipalMinor": on("P", "primary", "Loan amount"),
  "config.terms.maturityDate": on("C", "features", "Contract maturity date"),
  "config.terms.contractualTermMonths": on("C", "features", "Contract term"),
  "config.terms.amortizationTermMonths": on("P", "primary", "Years"),
  "config.terms.contractualPaymentMinor": on("C", "features", "Contract repayment amount"),
  "config.terms.creditLimitMinor": on("C", "features", "Credit limit"),
  "config.terms.firstPaymentDate": on("C", "features", "First repayment date"),
  "config.terms.firstInterestChargeDate": on("A", "drawer", "First interest charge"),
  "config.profile.amortization": on("A", "drawer", "Amortization"),
  "config.profile.rateQuote": on("A", "drawer", "Rate quoted as"),
  "config.profile.dayCount": on("A", "drawer", "Day count"),
  "config.profile.accrual": on("A", "drawer", "Interest accrues"),
  "config.profile.chargeFrequency": on("A", "drawer", "Interest is charged"),
  "config.profile.chargeDay": on("A", "drawer", "Charge day of the month"),
  "config.profile.capitalization": on("A", "drawer", "Interest capitalizes"),
  "config.profile.repaymentFrequency": on("C", "features", "Frequency"),
  "config.profile.repaymentDerivation": on("A", "drawer", "Repayment amount"),
  "config.profile.recast": on("A", "drawer", "Recalculate the repayment"),
  "config.profile.rateEffectiveTiming": on("A", "drawer", "A new rate applies"),
  "config.profile.repaymentEffectiveTiming": on("A", "drawer", "A repayment counts"),
  "config.profile.rounding.paymentRounding": on("A", "drawer", "Repayment rounding"),
  "config.profile.rounding.interestPostingRounding": on("A", "drawer", "Interest rounding"),
  "config.profile.rounding.intermediateScale.mode": on("A", "drawer", "Working precision"),
  "config.profile.rounding.intermediateScale.places": on("A", "drawer", "Decimal places"),
  "config.profile.rounding.intermediateRounding": on("A", "drawer", "Working rounding"),
  "config.profile.rounding.balancePrecision": on("A", "drawer", "Balance precision"),
  "config.profile.eventOrder.timing": on("A", "drawer", "Transactions on the same day as interest"),
  "config.profile.eventOrder.scheduledRepayments": on("A", "drawer", "Scheduled repayments"),
  "config.profile.eventOrder.otherPayments": on("A", "drawer", "Other payments and draws"),
  "config.profile.eventOrder.offsets": on("A", "drawer", "Offset balance changes"),
  "config.profile.finalPayment": on("A", "drawer", "Final repayment"),
  "config.profile.shortMonth": hidden("config v1 has a single value (clamp to the last calendar day)"),
  "config.profile.negativeAmortizationAllowed": on("A", "drawer", "The contract allows negative amortization"),
  "config.profile.interestOnlyRepayment": hidden("config v1 has a single value (charged interest outstanding)"),
  "config.profile.presetId": on("A", "drawer", "Start from a preset"),
  "config.phases[].kind": hidden("config v1 has one phase kind (interest-only), set by the Interest-only switch"),
  "config.phases[].from": on("D", "interestOnly", "Period ${index + 1} from"),
  "config.phases[].to": on("D", "interestOnly", "Until"),
  "config.phases[].recastAtEnd": on("D", "interestOnly", "At the end"),
  "config.components[].economicKind": on("D", "features", "Cost ${i + 1}"),
  "config.components[].label": on("I", "tracking", "${c.economicKind} label"),
  "config.components[].destination": on("I", "tracking", "Goes to"),
  "config.components[].categoryId": on("I", "tracking", "Category"),
  "config.components[].amountRule": hidden("fixed for fees and costs; calculated for the principal and interest rows"),
  "config.components[].fixedAmountMinor": on("D", "features", "Amount each repayment"),
  "config.components[].treatment": on("D", "features", "How it is paid"),
  "config.components[].order": hidden("derived from list order"),
  "config.paymentRecasts[].date": on("A", "drawer", "Recast ${i + 1}"),
  "config.paymentRecasts[].note": on("A", "drawer", "Note"),
  "config.revolving.paymentModel": on("C", "features", "Minimum payment"),
  "config.revolving.percentOfBalanceBps": on("C", "features", "Share of balance"),
  "config.revolving.minimumFloorMinor": on("C", "features", "Minimum amount"),
};

const DEBT_COLUMNS: Record<keyof DebtFields | "status" | "changeSummary", Home> = {
  budgetSyncId: hidden("the connected budget"),
  name: on("I", "tracking", "Name"),
  debtType: on("I", "tracking", "Kind of loan"),
  behaviorClass: on("P", "primary", "Loan type"),
  currency: hidden("retained internally for stored-config compatibility; the simulator is amount-based"),
  currencyMinorDigits: on("A", "drawer", "Amount decimal places"),
  liabilityAccountId: on("I", "tracking", "Loan account"),
  paymentAccountId: on("I", "tracking", "Repayments come from"),
  signConvention: on("I", "tracking", "Balance sign in Actual"),
  lenderPattern: on("I", "tracking", "Interest on your lender statement"),
  executionStrategy: on("I", "tracking", "Calculation engine"),
  driftToleranceMinor: on("I", "tracking", "Drift tolerance"),
  lenderChargeGraceDays: on("I", "tracking", "Lender charge grace"),
  onboardingDate: hidden("set by lender observations (P1.5)"),
  loanPaymentCategoryId: on("I", "tracking", "Loan payment category"),
  drawCategoryId: on("I", "tracking", "Draw category"),
  expectedObservationIntervalDays: on("I", "tracking", "Expected statement every"),
  currentConfigJson: hidden("built from the simulation (CONFIG above)"),
  status: on("I", "pages", "Save as draft"),
  changeSummary: on("D", "pages", "What changed (optional)"),
};

const RATE_COLUMNS: Record<keyof RatePeriodInput, Home> = {
  id: hidden("row identity"),
  announcedAt: on("D", "rates", "Announced on"),
  accrualEffectiveFrom: on("D", "rates", "Starts accruing"),
  annualRateDecimal: on("P", "primary", "Interest rate"),
  paymentRecalcPolicy: on("D", "rates", "Repayment on this change"),
  paymentEffectiveFrom: on("D", "rates", "Repayment changes from"),
  rateCapDecimal: on("D", "rates", "Rate cap"),
  rateFloorDecimal: on("D", "rates", "Rate floor"),
  paymentCap: on("D", "rates", "Limit the new repayment"),
  source: on("D", "rates", "Source"),
  note: on("D", "rates", "Note"),
};

const OFFSET_COLUMNS: Record<keyof OffsetLinkInput, Home> = {
  id: hidden("row identity"),
  actualAccountId: on("I", "tracking", "Offset account"),
  effectiveFrom: on("C", "features", "Offset start date"),
  effectiveTo: on("C", "features", "Offset end date"),
  offsetPercentageBps: on("C", "features", "Offset share"),
  balanceBasis: on("C", "features", "Balance used"),
  capMinor: on("C", "features", "Offset cap"),
  fundScheduledRepayments: on("C", "features", "Draw scheduled repayments from offset"),
  fundScheduledRepaymentsFrom: on("C", "features", "Start drawing from"),
  useActualBalance: on("D", "tracking", "Track offset balance from Actual"),
};

const ASSUMPTION_COLUMNS: Record<keyof AssumptionInput, Home> = {
  id: hidden("row identity"),
  kind: on("D", "extras", "KIND_LABEL"),
  effectiveFrom: on("D", "extras", "First date"),
  recurrence: on("D", "extras", "Repeats"),
  amountMinor: on("D", "extras", "Amount"),
  feeTreatment: on("D", "extras", "How it is paid"),
  offsetAccountId: on("D", "extras", "Offset account"),
  note: on("D", "extras", "Details"),
};

const ASSUMPTION_KINDS: Record<DebtAssumptionKind, Home> = {
  "extra-repayment": on("D", "extras", "Extra payment"),
  draw: on("D", "extras", "Redraw"),
  fee: on("D", "extras", "Fee"),
  "payment-change": on("D", "extras", "Repayment change"),
  "offset-balance": hidden("authoritative observation/reconciliation state; not an ordinary simulator action"),
  "offset-deposit": on("D", "extras", "Offset deposit"),
  "offset-withdrawal": on("D", "extras", "Offset withdrawal"),
};

const source = (surface: Surface) => readFileSync(join(__dirname, "..", SURFACES[surface]), "utf8");

function checkHomes(name: string, map: Record<string, Home>) {
  describe(name, () => {
    it.each(Object.entries(map))("%s has a named control or a stated reason", (_path, home) => {
      if ("why" in home) expect(home.why.length).toBeGreaterThan(5);
      else expect(source(home.surface)).toContain(home.label);
    });
  });
}

checkHomes("config v1 paths", CONFIG);
checkHomes("debt columns", DEBT_COLUMNS);
checkHomes("rate period columns", RATE_COLUMNS);
checkHomes("offset link columns", OFFSET_COLUMNS);
checkHomes("assumption columns", ASSUMPTION_COLUMNS);
checkHomes("assumption kinds", ASSUMPTION_KINDS);

/** Leaf paths of a value, as `Paths` spells them. */
function pathsOf(value: unknown, prefix: string, out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") out.add(prefix);
  else if (Array.isArray(value)) for (const v of value) pathsOf(v, `${prefix}[]`, out);
  else for (const [k, v] of Object.entries(value)) pathsOf(v, `${prefix}.${k}`, out);
  return out;
}

describe("saved configurations hold only classified paths", () => {
  const rich: SimulationState[] = [
    sim(),
    { ...sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE, rounding: { ...sim().profile.rounding, intermediateScale: { mode: "fixed", places: 10 } }, eventOrder: { scheduledRepayments: "after-accrual", otherPayments: "before-accrual", offsets: "before-accrual" } } }), ...offsetOf(1_000_000) },
    sim({
      interestOnly: true,
      phases: [{ kind: "interest-only", from: "2024-01-01", to: "2026-01-01", recastAtEnd: "on-rate-change" }],
      components: [{ key: simKey("c"), economicKind: "fee", amountRule: "fixed", fixedAmountMinor: 1_000, treatment: "cash-paid" }],
      paymentRecasts: [{ date: "2027-01-01", note: "reset" }],
      contractTermMonths: 60,
      maturityDate: "2029-01-01",
    }),
    sim({ shape: "revolving-credit", creditLimitMinor: 50_000_000, revolving: { paymentModel: "percent-of-balance", percentOfBalanceBps: 200, minimumFloorMinor: 2_500 }, profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE, amortization: "revolving" } }),
  ];

  it.each(rich.map((s, i) => [i, s] as const))("config %i", (_i, s) => {
    const t = { ...newTracking(s), name: "Loan", offsetAccountMap: Object.fromEntries(s.offsets.map((o) => [o.placeholderAccountId, "acc-offset"])) };
    const built = statesToSaveInput(s, { ...t, status: "draft" }, "b1", "bench-daily");
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const unlisted = [...pathsOf(built.input.config, "config")].filter((p) => !(p in CONFIG) && !Object.keys(CONFIG).some((k) => k.startsWith(`${p}.`)));
    expect(unlisted).toEqual([]);
    const columns = { ...DEBT_COLUMNS } as Record<string, Home>;
    for (const key of Object.keys(built.input)) if (!["config", "rates", "offsets", "assumptions"].includes(key)) expect(columns).toHaveProperty([key]);
    for (const r of built.input.rates) for (const key of Object.keys(r)) expect(RATE_COLUMNS).toHaveProperty([key]);
    for (const o of built.input.offsets) for (const key of Object.keys(o)) expect(OFFSET_COLUMNS).toHaveProperty([key]);
    for (const a of built.input.assumptions) for (const key of Object.keys(a)) expect(ASSUMPTION_COLUMNS).toHaveProperty([key]);
  });
});

describe("every current config identifier a person can choose is offered", () => {
  const offered = (options: { value: string }[]) => options.map((o) => o.value).filter(Boolean).sort();
  const groups: [keyof typeof DEBT_CONFIG_V2_IDENTIFIERS, { value: string }[], string[]][] = [
    ["amortization", vocabulary.AMORTIZATION_OPTIONS, []],
    ["rateQuote", vocabulary.RATE_QUOTE_OPTIONS, []],
    ["dayCount", vocabulary.DAY_COUNT_OPTIONS, []],
    ["accrual", vocabulary.ACCRUAL_OPTIONS, []],
    ["chargeFrequency", vocabulary.CHARGE_FREQUENCY_OPTIONS, []],
    ["capitalization", vocabulary.CAPITALIZATION_OPTIONS, []],
    ["repaymentFrequency", vocabulary.REPAYMENT_FREQUENCY_OPTIONS, []],
    ["repaymentDerivation", vocabulary.REPAYMENT_DERIVATION_OPTIONS, []],
    ["recast", vocabulary.RECAST_OPTIONS, []],
    ["finalPayment", vocabulary.FINAL_PAYMENT_OPTIONS, []],
    ["roundingMode", vocabulary.ROUNDING_OPTIONS, []],
    ["balancePrecision", vocabulary.BALANCE_PRECISION_OPTIONS, []],
    ["sameDayTiming", vocabulary.EVENT_TIMING_OPTIONS, []],
    ["componentDestination", vocabulary.DESTINATION_OPTIONS, []],
    ["revolvingPaymentModel", vocabulary.REVOLVING_MODEL_OPTIONS, []],
  ];
  it.each(groups)("%s", (group, options, notOffered) => {
    expect(offered(options)).toEqual([...DEBT_CONFIG_V2_IDENTIFIERS[group]].filter((v) => !notOffered.includes(v)).sort());
  });
});
