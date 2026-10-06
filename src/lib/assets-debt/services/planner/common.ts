import type { PostingKind, PostingReason } from "@/lib/app-db/types";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import { evaluateExpectedPeriod, type ExpectedMatchPeriod, type MatchCandidate, type MatchConditionsV1, type PeriodMatchEvaluation } from "@/lib/financial-models/matching";
import { CURRENT_COMPONENT_VERSIONS } from "@/lib/financial-models/loan/versions";
import type { DirectoryAccount } from "../../actual/ledgerPort";
import { classifyPosting, REASONS, type PolicyInput, type PostingShape } from "../../classification/policy";
import { buildPostingMarker } from "../../markers";
import {
  assertExactMoney,
  calculatePeriod,
  POSTING_INPUT_FORMAT,
  POSTING_INPUT_FORMAT_VERSION,
  type ClosingState,
  type PostingInputSnapshot,
  type PostingOpening,
  type PostingOutputSnapshot,
  type RowSnapshot,
} from "../snapshot";

/**
 * Shared planning context and helpers (RD-084 P1.6 T118–T120).
 *
 * Planners are pure: they read the context the proposal service assembled
 * (stored configuration, the effective anchor, the browser's bounded read of
 * Actual, existing postings) and return proposals. They never write, here or
 * in Actual; proposals are persisted by the proposal service and applied only
 * by the user's explicit Apply (SC-018).
 */

export type ComponentConfig = {
  economicKind: string;
  label: string;
  destination: string;
  categoryId: string | null;
  amountRule: string;
  fixedAmountMinor: number | null;
  treatment: string | null;
  order: number;
};

export type PlanningDebt = {
  id: string;
  budgetSyncId: string;
  name: string;
  liabilityAccountId: string | null;
  paymentAccountId: string | null;
  signConvention: "negative-is-debt" | "positive-is-debt";
  lenderPattern: "embedded-interest" | "separate-interest" | null;
  executionStrategy: string;
  loanPaymentCategoryId: string | null;
  lenderChargeGraceDays: number;
  /** The allowed difference before flagging (also how close a payment must be to pay the loan off). */
  driftToleranceMinor?: number;
  currentRevision: number;
  onboardingDate: string | null;
};

export type ExistingPostingSummary = {
  id: string;
  postingKind: string;
  periodKey: string;
  status: string;
  generation: number;
  outputSnapshot: PostingOutputSnapshot;
  actualIds: string[] | null;
};

export type PlanningContext = {
  debt: PlanningDebt;
  configHash: string;
  model: LoanModelSnapshot;
  components: ComponentConfig[];
  accounts: DirectoryAccount[];
  transferPayeeByAccount: Record<string, string>;
  opening: PostingOpening;
  offsets: PostingInputSnapshot["offsets"];
  window: { from: string; to: string };
  /** The date the preview runs; the grace period is measured to it. */
  today: string;
  driftMaterial: boolean;
  /** Claimable candidates from the bounded read (Bench-marked and posting-linked rows excluded). */
  candidates: MatchCandidate[];
  /** Every row and split child from the bounded read, by id. */
  rows: Map<string, RowSnapshot>;
  rules: Partial<Record<"repayment" | "interest-charge" | "lender-repayment-row", MatchConditionsV1>>;
  postings: ExistingPostingSummary[];
  /** Whether this connection's reads report transfer ids (a link needs them, R-07). */
  canVerifyTransferLinks: boolean;
  /** Whether the transport offers restructure and link writes at all. */
  canRestructure: boolean;
  parameters: {
    openingAdjustmentCategoryId?: string | null;
    adjustmentCategoryId?: string | null;
    /** Actual liability balance at the onboarding date as a debt magnitude (FR-022), read by the browser. */
    actualBalanceAtOnboardingMinor?: number | null;
    /** `actualMagnitudeMinor`: the Actual liability as a debt magnitude at the comparison date. */
    reconciliation?: { comparisonDate: string; actualMagnitudeMinor: number; observation: { id: string; principalMinor: number; accruedInterestMinor: number | null; canonicalHash: string } } | null;
  };
};

export type PlannedPosting = {
  postingKind: PostingKind;
  periodKey: string;
  shape: PostingShape;
  generation: number;
  marker: string | null;
  inputSnapshot: PostingInputSnapshot;
  outputSnapshot: PostingOutputSnapshot;
  engineVersions: Record<string, string>;
  classification: "safe" | "review" | "blocked";
  reasons: PostingReason[];
  reversalOf?: string | null;
};

/** Something the user should know that is not a posting: waiting for a row, ambiguous matches. */
export type PlanningNotice = { code: string; periodKey: string; text: string };

export type PlanResult = { postings: PlannedPosting[]; notices: PlanningNotice[] };

export const LIVE_STATUSES = new Set(["applying", "applied", "indeterminate"]);

export function account(ctx: PlanningContext, id: string | null): DirectoryAccount | null {
  if (!id) return null;
  return ctx.accounts.find((a) => a.id === id) ?? null;
}

export function usableAccount(ctx: PlanningContext, id: string | null): DirectoryAccount | null {
  const found = account(ctx, id);
  return found && !found.closed ? found : null;
}

/** The ledger amount that increases the debt magnitude by `magnitudeMinor` (FR-022). */
export function ledgerIncrease(ctx: PlanningContext, magnitudeMinor: number): number {
  return ctx.debt.signConvention === "negative-is-debt" ? -magnitudeMinor : magnitudeMinor;
}

/** Live postings of this kind and period: the period is already handled (FR-163). */
export function livePosting(ctx: PlanningContext, postingKind: string, periodKey: string): ExistingPostingSummary | null {
  return ctx.postings.find((p) => p.postingKind === postingKind && p.periodKey === periodKey && LIVE_STATUSES.has(p.status)) ?? null;
}

/** S10: 1 + the number of reversed postings of this key. */
export function generationFor(ctx: PlanningContext, postingKind: string, periodKey: string): number {
  return 1 + ctx.postings.filter((p) => p.postingKind === postingKind && p.periodKey === periodKey && p.status === "reversed").length;
}

export function markerFor(ctx: PlanningContext, postingKind: string, periodKey: string, generation: number): string {
  return buildPostingMarker({ budgetSyncId: ctx.debt.budgetSyncId, subjectId: ctx.debt.id, postingKind, periodKey, generation });
}

export function component(ctx: PlanningContext, kind: string): ComponentConfig | null {
  return [...ctx.components].sort((a, b) => a.order - b.order).find((c) => c.economicKind === kind) ?? null;
}

export function baseBlockers(ctx: PlanningContext): PostingReason[] {
  const blockers: PostingReason[] = [];
  if (ctx.debt.executionStrategy === "actual-formula-rule") blockers.push(REASONS.unsupportedStrategy);
  if (!usableAccount(ctx, ctx.debt.liabilityAccountId)) blockers.push(REASONS.missingAccount);
  return blockers;
}

export function inputSnapshot(
  ctx: PlanningContext,
  period: { key: string; from: string; to: string; chargeDates: string[] },
  matched: RowSnapshot[],
  parameters: PostingInputSnapshot["parameters"] = {},
  observation?: PostingInputSnapshot["observation"]
): PostingInputSnapshot {
  return {
    format: POSTING_INPUT_FORMAT,
    version: POSTING_INPUT_FORMAT_VERSION,
    subject: { kind: "debt", id: ctx.debt.id, configRevision: ctx.debt.currentRevision, configHash: ctx.configHash },
    period,
    opening: ctx.opening,
    offsets: ctx.offsets,
    matched,
    parameters,
    ...(observation ? { observation } : {}),
  };
}

export function engineVersionsFor(events: DebtProjectionEvent[]): Record<string, string> {
  const versions: Record<string, string> = { projection: CURRENT_COMPONENT_VERSIONS.projection };
  for (const event of events) Object.assign(versions, event.engineVersions);
  return versions;
}

/**
 * One projection of the whole preview window per planning context. The engine
 * simulates forward from the recorded opening, so a day's events are the same
 * whether the run stops on that day or at the window end; planning slices this
 * single run instead of re-simulating from the opening for every period, which
 * made a multi-year preview re-run the daily engine dozens of times.
 * Reproduction still recomputes each period on its own (`calculatePeriod` with
 * `from = to = date`), and the exact-match tests prove the two agree.
 */
const windowRuns = new WeakMap<PlanningContext, ReturnType<typeof calculatePeriod>>();

export function windowRun(ctx: PlanningContext): ReturnType<typeof calculatePeriod> {
  let run = windowRuns.get(ctx);
  if (!run) {
    run = calculatePeriod({ model: ctx.model, opening: ctx.opening, offsets: ctx.offsets, from: ctx.window.from, to: ctx.window.to });
    windowRuns.set(ctx, run);
  }
  return run;
}

/** Engine events of one day from the stored model and the recorded opening (the result reproduction recomputes). */
export function eventsOn(ctx: PlanningContext, date: string): { events: DebtProjectionEvent[]; closing: ClosingState; versions: Record<string, string> } | { error: string } {
  if (date >= ctx.window.from && date <= ctx.window.to) {
    const run = windowRun(ctx);
    if (!run.ok) return { error: run.message };
    const events = run.events.filter((e) => e.date === date);
    const closing: ClosingState = { date, principalMinor: events.at(-1)?.balanceAfterMinor ?? ctx.opening.principalMinor, accruedInterestMinor: 0, carriedRemainder: null };
    return { events, closing, versions: engineVersionsFor(events) };
  }
  const result = calculatePeriod({ model: ctx.model, opening: ctx.opening, offsets: ctx.offsets, from: date, to: date });
  if (!result.ok) return { error: result.message };
  return { events: result.events, closing: result.closing, versions: engineVersionsFor(result.events) };
}

export function finalize(
  ctx: PlanningContext,
  input: Omit<PlannedPosting, "classification" | "reasons"> & { policy: Omit<PolicyInput, "postingKind" | "shape" | "driftMaterial"> }
): PlannedPosting {
  const { policy, ...rest } = input;
  assertExactMoney(rest.inputSnapshot, "inputSnapshot");
  assertExactMoney(rest.outputSnapshot, "outputSnapshot");
  const result = classifyPosting({ ...policy, postingKind: rest.postingKind, shape: rest.shape, driftMaterial: ctx.driftMaterial });
  return { ...rest, classification: result.classification, reasons: result.reasons };
}

export function matchPeriod(ctx: PlanningContext, purpose: keyof PlanningContext["rules"], expected: ExpectedMatchPeriod): PeriodMatchEvaluation | null {
  const conditions = ctx.rules[purpose];
  if (!conditions) return null;
  const claimable = ctx.candidates.filter((c) => !c.benchMarked && !c.postingLinked);
  return evaluateExpectedPeriod(conditions, claimable, expected);
}

export function budgetStatusOf(ctx: PlanningContext, ids: (string | null)[]): Record<string, "on-budget" | "off-budget"> {
  const out: Record<string, "on-budget" | "off-budget"> = {};
  for (const id of ids) {
    const found = id ? account(ctx, id) : null;
    if (found) out[found.id] = found.offBudget ? "off-budget" : "on-budget";
  }
  return out;
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addIsoDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
