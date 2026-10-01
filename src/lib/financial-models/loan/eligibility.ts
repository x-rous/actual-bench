import type { LoanModelSnapshot } from "./model";

/**
 * Which execution strategy can reproduce a contract (FR-026, FR-027, FR-030).
 *
 * The ladder is Actual formula rule → Bench periodic → Bench daily, and the
 * least complex eligible strategy is recommended. Every rejected strategy says
 * why; nothing switches silently.
 */

export const ELIGIBILITY_VERSION = "eligibility@1";

export type ExecutionStrategy = "actual-formula-rule" | "bench-periodic" | "bench-daily";

export type ActualCapabilities = { formulaRules: boolean; splitActions: boolean; transferPayees: boolean; ruleReadback: boolean };

export type StrategyOption = { strategy: ExecutionStrategy; eligible: boolean; reasons: string[] };

export type Eligibility = { recommended: ExecutionStrategy | null; options: StrategyOption[] };

function periodicReasons(model: LoanModelSnapshot): string[] {
  const { profile } = model;
  const reasons: string[] = [];
  if (profile.accrual !== "per-period") reasons.push("Interest accrues daily, which only a daily simulation reproduces.");
  if (model.offsets.length > 0) reasons.push("Offset balances change interest day by day.");
  if (profile.repaymentFrequency === "custom-dated" || profile.repaymentFrequency === "semi-monthly") reasons.push(`${profile.repaymentFrequency} repayments are not a regular period.`);
  if (model.behaviorClass === "revolving-credit") reasons.push("A revolving facility has no amortization periods.");
  if (model.assumptions.some((a) => a.kind === "extra-repayment" || a.kind === "draw" || a.kind === "offset-balance" || a.kind === "offset-deposit" || a.kind === "offset-withdrawal")) {
    reasons.push("Extra repayments, draws or offset changes can fall between payment dates.");
  }
  if (profile.chargeFrequency !== "at-repayment" && profile.accrual === "per-period") reasons.push("Interest is charged on its own cadence, not with each payment.");
  return reasons;
}

function formulaReasons(model: LoanModelSnapshot, capabilities: ActualCapabilities): string[] {
  const { profile } = model;
  const reasons = periodicReasons(model);
  if (profile.amortization !== "level-payment") reasons.push(`A ${profile.amortization} loan is not a single level-payment formula.`);
  if (profile.repaymentFrequency !== "monthly") reasons.push(`${profile.repaymentFrequency} repayments are not compatible with a monthly formula.`);
  if (profile.rateQuote !== "nominal-simple-periodic") reasons.push("Only a simple periodic rate (annual ÷ 12) fits the formula.");
  if (model.rates.length > 1) reasons.push("Rate changes need the rule rewritten; the formula needs a stable rate.");
  if (model.phases.length > 0) reasons.push("Interest-only phases change the payment rule over time.");
  if (!capabilities.formulaRules) reasons.push("The connected Actual does not support formula rules.");
  if (!capabilities.splitActions) reasons.push("The connected Actual does not support split actions.");
  if (!capabilities.transferPayees) reasons.push("The connected Actual does not support transfer payees in rules.");
  if (!capabilities.ruleReadback) reasons.push("The connected Actual cannot read a rule back to verify it.");
  return reasons;
}

function dailyReasons(model: LoanModelSnapshot): string[] {
  return model.profile.accrual === "per-period" ? ["Interest accrues per period; a daily simulation would change the contract's arithmetic."] : [];
}

export function evaluateStrategyEligibility(model: LoanModelSnapshot, capabilities: ActualCapabilities): Eligibility {
  const options: StrategyOption[] = [
    { strategy: "actual-formula-rule", reasons: formulaReasons(model, capabilities) },
    { strategy: "bench-periodic", reasons: periodicReasons(model) },
    { strategy: "bench-daily", reasons: dailyReasons(model) },
  ].map((o) => ({ strategy: o.strategy as ExecutionStrategy, eligible: o.reasons.length === 0, reasons: o.reasons }));
  return { recommended: options.find((o) => o.eligible)?.strategy ?? null, options };
}
