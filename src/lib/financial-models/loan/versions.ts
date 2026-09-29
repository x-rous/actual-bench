/**
 * Engine component versions (research R-02, FR-181, FR-183).
 *
 * Every calculation component carries its own version string, `<name>@<n>`,
 * and a result records the whole map, so a fix to one day-count convention
 * bumps only that convention. A version that any stored result depends on
 * stays callable: registries are append-only, and a new behavior is a new
 * version registered beside the old one, never an edit to it.
 */

export type ComponentVersion = `${string}@${number}`;

const VERSION_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)@([1-9]\d*)$/;

export function parseComponentVersion(version: string): { name: string; revision: number } | null {
  const match = VERSION_RE.exec(version);
  return match ? { name: match[1], revision: Number(match[2]) } : null;
}

export type VersionLookup<T> =
  | { ok: true; version: ComponentVersion; impl: T }
  | { ok: false; code: "unsupported-engine-version"; version: string };

export type VersionRegistry<T> = {
  /** Component name shared by every version, e.g. `daycount-act365f`. */
  readonly name: string;
  register(version: ComponentVersion, impl: T): void;
  /** The implementation for an exact version. An unknown one is a blocking result, never a fallback. */
  resolve(version: string): VersionLookup<T>;
  versions(): ComponentVersion[];
  latest(): ComponentVersion;
};

export function createVersionRegistry<T>(name: string): VersionRegistry<T> {
  const entries = new Map<string, T>();
  const versions = () =>
    [...entries.keys()].sort(
      (a, b) => parseComponentVersion(a)!.revision - parseComponentVersion(b)!.revision
    ) as ComponentVersion[];
  return {
    name,
    register(version, impl) {
      const parsed = parseComponentVersion(version);
      if (!parsed || parsed.name !== name) throw new RangeError(`${version} is not a version of ${name}`);
      if (entries.has(version)) throw new RangeError(`${version} is already registered; register a new version instead`);
      entries.set(version, impl);
    },
    resolve(version) {
      const impl = entries.get(version);
      if (impl === undefined) return { ok: false, code: "unsupported-engine-version", version };
      return { ok: true, version: version as ComponentVersion, impl };
    },
    versions,
    latest() {
      const all = versions();
      if (all.length === 0) throw new RangeError(`No version of ${name} is registered`);
      return all[all.length - 1];
    },
  };
}

/** Map of component name → version, recorded with every calculation result. */
export type EngineVersions = Record<string, ComponentVersion>;

/**
 * The current version of every P1.1 component. Frozen at the end of P1.1
 * (T048): changing a component's behavior adds a new version here and keeps
 * the old one registered.
 */
export const CURRENT_COMPONENT_VERSIONS = {
  "money-kernel": "money-kernel@1",
  "calendar": "calendar@1",
  "schedule": "schedule@1",
  "daycount-act365f": "daycount-act365f@1",
  "daycount-actact-calendar": "daycount-actact-calendar@1",
  "daycount-act360": "daycount-act360@1",
  "daycount-monthly-alloc": "daycount-monthly-alloc@1",
  "rates": "rates@1",
  "rate-quote": "rate-quote@1",
  "profile": "profile@1",
  "event-order": "event-order@1",
  "repayment": "repayment@1",
} as const satisfies EngineVersions;

/**
 * Every identifier `rd084.debt-config` version 1 accepts, frozen at the end of
 * P1.1 (T048). `identifiers.test.ts` fails if a parser enum drifts from this
 * list. Adding a value is a new config version (research R-12), and removing
 * one would strand stored configurations, so neither happens by editing v1.
 * A listed identifier may still be unselectable (see daycount/registry.ts).
 */
export const DEBT_CONFIG_V1_IDENTIFIERS = {
  amortization: ["level-payment", "constant-principal", "custom-payment", "revolving"],
  rateQuote: ["nominal-simple-periodic", "nominal-compounded-monthly", "nominal-compounded-semiannual", "annual-effective"],
  dayCount: ["actual-365-fixed", "actual-actual-calendar", "actual-360", "monthly-30-360-actual-day-allocation"],
  paymentLimitKind: ["absolute", "previous-payment-factor"],
  accrual: ["per-period", "daily-simple", "daily-compounded"],
  chargeFrequency: ["monthly", "quarterly", "annual", "at-repayment"],
  capitalization: ["at-charge", "daily"],
  repaymentFrequency: ["weekly", "fortnightly", "semi-monthly", "monthly", "quarterly", "annual", "custom-dated"],
  repaymentDerivation: ["annuity-at-payment-frequency", "monthly-equivalent-pro-rata", "split-monthly", "contractual-fixed", "lender-provided"],
  recast: ["never", "on-rate-change", "annual", "on-contract-date", "lender-provided"],
  rateEffectiveTiming: ["on-accrual-effective-date", "from-next-charge-period"],
  repaymentEffectiveTiming: ["transaction-date", "next-calendar-day"],
  roundingMode: ["half-up", "half-even", "up", "down"],
  intermediateScaleMode: ["full", "currency", "fixed"],
  balancePrecision: ["round-each-event", "round-each-posting", "carry-full-precision"],
  sameDayTiming: ["start-of-day", "end-of-day"],
  placement: ["before-accrual", "after-accrual"],
  eventOrderPlacementKeys: ["scheduledRepayments", "otherPayments", "offsets"],
  finalPayment: ["true-up-to-zero", "contractual-balloon", "keep-level-payment-with-residual", "continue-until-paid"],
  shortMonth: ["clamp-to-last-calendar-day"],
  economicKind: ["principal", "interest", "fee", "escrow", "insurance", "tax", "draw", "other"],
  componentDestination: ["transfer", "category", "income-category", "tracking-only"],
  componentAmountRule: ["fixed", "calculated", "lender-provided"],
  revolvingPaymentModel: ["fixed-scheduled", "interest-only", "percent-of-balance"],
  phaseKind: ["interest-only"],
} as const;
