import { compareDates, type IsoDate } from "../calendar/dates";
import { simulateDaily } from "./daily-engine";
import type { BlockReason, Certainty, FutureAssumption, LedgerEvent, LoanModelSnapshot, ModelEvent, PeriodSummary, SimulationRequest, SimulationResult, Anchor } from "./model";
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

export const PROJECTION_VERSION = "projection@1";
export const PROJECTION_SCHEMA_VERSION = 1;

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
      monthly: PeriodSummary[];
      yearly?: PeriodSummary[];
      stale: boolean;
    }
  | { ok: false; schemaVersion: typeof PROJECTION_SCHEMA_VERSION; debtId: string; blocked: BlockReason[] };

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

export function projectDebt(input: DebtProjectionInput): DebtProjection {
  const model = withOverrides(input.model, input.overrides);
  const result = simulate({ model, anchor: input.anchor, events: input.events, to: input.to });
  if (!result.ok) return { ok: false, schemaVersion: PROJECTION_SCHEMA_VERSION, debtId: model.debtId, blocked: result.blocked };
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
        engineVersions: result.versions,
        diagnostics: e.diagnostics,
      })
    );
  const monthly = result.periods.filter((p) => compareDates(p.to, input.from) >= 0);
  const stale = input.baselineAnchorDate ? compareDates(input.baselineAnchorDate, input.anchor.date) < 0 : false;
  return {
    ok: true,
    schemaVersion: PROJECTION_SCHEMA_VERSION,
    debtId: model.debtId,
    events: input.resolution === "monthly" || input.resolution === "yearly" ? events.filter((e) => e.eventType !== "rate-change") : events,
    monthly,
    ...(input.resolution === "yearly" ? { yearly: yearly(monthly) } : {}),
    stale,
  };
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
