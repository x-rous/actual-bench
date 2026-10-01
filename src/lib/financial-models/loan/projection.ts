import { compareDates, type IsoDate } from "../calendar/dates";
import { DAILY_ENGINE_VERSION_V4, simulateDaily, simulateDailyAtVersion } from "./daily-engine";
import type { BlockReason, Certainty, FutureAssumption, LedgerEvent, LoanModelSnapshot, ModelEvent, OffsetStatePoint, PeriodSummary, SimulationRequest, SimulationResult, Anchor } from "./model";
import { simulatePeriodic } from "./periodic-engine";
import type { RatePeriod } from "./rates";
import type { EngineVersions } from "./versions";

/**
 * The debt projection (FR-111–FR-114): a versioned, deterministic list of
 * future financial events for one debt, for any consumer (the calculator
 * now, RD-073 later).
 *
 * Pure: it simulates from its inputs and returns data. It never writes, and
 * its output has no ledger operations in it (FR-019). Overrides apply to a
 * copy of the model and are never persisted (FR-110, FR-114).
 */

export const PROJECTION_VERSION_V1 = "projection@1";
export const PROJECTION_VERSION = "projection@2";
export const PROJECTION_SCHEMA_VERSION = 2;

export type DebtProjectionOverrides = {
  /** Added to the baseline assumptions for this projection only. */
  assumptions?: FutureAssumption[];
  /** Future explicit rates; a rate on the same date as a stored one replaces it here. */
  rates?: RatePeriod[];
};

export type DebtProjectionEventType =
  | "repayment"
  | "extra-repayment"
  | "interest-charge"
  | "fee"
  | "draw"
  | "rate-change"
  | "recast"
  | "balloon"
  | "final-payment"
  | "negative-amortization"
  | "residual";

export type DebtProjectionEvent = {
  date: IsoDate;
  eventType: DebtProjectionEventType;
  /** Signed from the household's cash: money out is negative; 0 for charges and markers. */
  cashMovementMinor: number;
  /** Signed change in the outstanding debt. */
  principalMovementMinor: number;
  interestMinor: number;
  feesMinor: number;
  balanceBeforeMinor: number;
  balanceAfterMinor: number;
  certainty: Certainty;
  sourceAccountId: string | null;
  debtAccountId: string | null;
  /** Actual categories are applied later from account budget status (research R-17); empty here. */
  categoryAllocations: { categoryId: string; amountMinor: number }[];
  modelRevision: number;
  engineVersions: EngineVersions;
  diagnostics: ModelEvent["diagnostics"];
};

export type DebtProjectionInput = {
  model: LoanModelSnapshot;
  anchor: Anchor;
  /** Known dated facts after the anchor (observed events). */
  events: LedgerEvent[];
  from: IsoDate;
  to: IsoDate;
  overrides?: DebtProjectionOverrides;
  resolution?: "events" | "monthly" | "yearly";
  /** The anchor date the stored baseline was computed from; a newer anchor makes it stale (FR-061). */
  baselineAnchorDate?: IsoDate | null;
};

export type DebtProjection =
  | {
      ok: true;
      schemaVersion: typeof PROJECTION_SCHEMA_VERSION;
      debtId: string;
      events: DebtProjectionEvent[];
      /** State-only points; never repayments or amortization rows. */
      offsetStates: OffsetStatePoint[];
      monthly: PeriodSummary[];
      yearly?: PeriodSummary[];
      stale: boolean;
    }
  | { ok: false; schemaVersion: typeof PROJECTION_SCHEMA_VERSION; debtId: string; blocked: BlockReason[] };

export type DebtProjectionV1 =
  | { ok: true; schemaVersion: 1; debtId: string; events: DebtProjectionEvent[]; monthly: PeriodSummary[]; yearly?: PeriodSummary[]; stale: boolean }
  | { ok: false; schemaVersion: 1; debtId: string; blocked: BlockReason[] };

/** The engine the profile calls for: per-period accrual runs periodic, daily accrual runs daily. */
export function simulate(req: SimulationRequest): SimulationResult {
  return req.model.profile.accrual === "per-period" ? simulatePeriodic(req) : simulateDaily(req);
}

function withOverrides(model: LoanModelSnapshot, overrides: DebtProjectionOverrides | undefined): LoanModelSnapshot {
  if (!overrides) return model;
  const replaced = new Set((overrides.rates ?? []).map((r) => r.accrualEffectiveFrom));
  return {
    ...model,
    rates: [...model.rates.filter((r) => !replaced.has(r.accrualEffectiveFrom)), ...(overrides.rates ?? [])],
    assumptions: [...model.assumptions, ...(overrides.assumptions ?? [])],
  };
}

function projectDebtImpl(input: DebtProjectionInput, version: typeof PROJECTION_VERSION | typeof PROJECTION_VERSION_V1): DebtProjection | DebtProjectionV1 {
  const model = withOverrides(input.model, input.overrides);
  if (version === PROJECTION_VERSION_V1 && [...model.assumptions, ...input.events].some((event) => event.kind === "offset-deposit" || event.kind === "offset-withdrawal")) {
    return {
      ok: false,
      schemaVersion: 1,
      debtId: model.debtId,
      blocked: [{ code: "unsupported-profile", classification: "blocked", date: null, message: "projection@1 does not support offset deposits or withdrawals." }],
    };
  }
  const request = { model, anchor: input.anchor, events: input.events, to: input.to };
  const result = version === PROJECTION_VERSION_V1 && model.profile.accrual !== "per-period"
    ? simulateDailyAtVersion(DAILY_ENGINE_VERSION_V4, request)
    : simulate(request);
  const schemaVersion = version === PROJECTION_VERSION ? 2 : 1;
  if (!result.ok) return { ok: false, schemaVersion, debtId: model.debtId, blocked: result.blocked } as DebtProjection | DebtProjectionV1;
  const events = result.events
    .filter((e) => compareDates(e.date, input.from) >= 0)
    .map(
      (e): DebtProjectionEvent => ({
        date: e.date,
        eventType: e.type,
        cashMovementMinor: e.cashMovementMinor,
        principalMovementMinor: e.principalMovementMinor,
        interestMinor: e.interestMinor,
        feesMinor: e.feesMinor,
        balanceBeforeMinor: e.balanceBeforeMinor,
        balanceAfterMinor: e.balanceAfterMinor,
        certainty: e.certainty,
        sourceAccountId: null,
        debtAccountId: null,
        categoryAllocations: [],
        modelRevision: model.revision,
        engineVersions: { ...result.versions, projection: version },
        diagnostics: e.diagnostics,
      })
    );
  const monthly = result.periods.filter((p) => compareDates(p.to, input.from) >= 0);
  const stale = input.baselineAnchorDate ? compareDates(input.baselineAnchorDate, input.anchor.date) < 0 : false;
  const base = {
    ok: true as const,
    schemaVersion,
    debtId: model.debtId,
    events: input.resolution === "monthly" || input.resolution === "yearly" ? events.filter((e) => e.eventType !== "rate-change") : events,
    monthly,
    ...(input.resolution === "yearly" ? { yearly: yearly(monthly) } : {}),
    stale,
  };
  const offsetStates = result.offsetStates.filter((point) => compareDates(point.date, input.from) >= 0);
  if (version === PROJECTION_VERSION && result.offsetStates.length && offsetStates[0]?.date !== input.from) {
    const prior = result.offsetStates.filter((point) => compareDates(point.date, input.from) < 0);
    const totalBalanceMinor = prior.at(-1)?.totalBalanceMinor;
    const latestByAccount = new Map(prior.map((point) => [point.accountId, point]));
    if (totalBalanceMinor !== undefined) {
      offsetStates.unshift(...[...latestByAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId)).map((point) => ({ ...point, date: input.from, totalBalanceMinor })));
    }
  }
  return version === PROJECTION_VERSION
    ? { ...base, schemaVersion: 2, offsetStates }
    : { ...base, schemaVersion: 1 };
}

export function projectDebt(input: DebtProjectionInput): DebtProjection {
  return projectDebtImpl(input, PROJECTION_VERSION) as DebtProjection;
}

/** Historical projection contract, kept callable for stored-result reproduction. */
export function projectDebtV1(input: DebtProjectionInput): DebtProjectionV1 {
  return projectDebtImpl(input, PROJECTION_VERSION_V1) as DebtProjectionV1;
}

export function projectDebtAtVersion(version: string, input: DebtProjectionInput): DebtProjection | DebtProjectionV1 {
  if (version === PROJECTION_VERSION_V1) return projectDebtV1(input);
  if (version === PROJECTION_VERSION) return projectDebt(input);
  throw new RangeError(`Unsupported projection version: ${version}`);
}

function yearly(monthly: readonly PeriodSummary[]): PeriodSummary[] {
  const out: PeriodSummary[] = [];
  for (const m of monthly) {
    const year = m.period.slice(0, 4);
    const last = out[out.length - 1];
    if (last && last.period === year) {
      last.to = m.to;
      last.interestMinor += m.interestMinor;
      last.feesMinor += m.feesMinor;
      last.repaidMinor += m.repaidMinor;
      last.drawnMinor += m.drawnMinor;
      last.closingMinor = m.closingMinor;
    } else {
      out.push({ ...m, period: year, from: `${year}-01-01` });
    }
  }
  return out;
}
