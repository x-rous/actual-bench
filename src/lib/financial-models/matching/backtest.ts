import { matchRuleStrength, type MatchActionsV1, type MatchConditionsV1 } from "./dsl";
import { evaluateExpectedPeriod, type ExpectedMatchPeriod, type MatchCandidate, type PeriodMatchEvaluation } from "./evaluate";

export const DEBT_BACKTEST_FORMAT = "rd084.debt-backtest";
export const DEBT_BACKTEST_VERSION = 1;

export type BacktestPeriod = PeriodMatchEvaluation & {
  projectedBalanceVarianceMinor: number | null;
  flags: string[];
};

export type DebtBacktestResult = {
  format: typeof DEBT_BACKTEST_FORMAT;
  version: typeof DEBT_BACKTEST_VERSION;
  from: string;
  to: string;
  generatedAt: string;
  read: { accounts: number; transactions: number };
  strength: ReturnType<typeof matchRuleStrength>;
  warnings: string[];
  summary: { expectedPeriods: number; unique: number; missing: number; multiple: number; unsafe: number };
  periods: BacktestPeriod[];
};

const rowFlags = (period: PeriodMatchEvaluation): string[] => [...new Set(period.candidates.flatMap(({ candidate }) => [
  ...(candidate.reconciled ? ["reconciled"] : []),
  ...(candidate.isParent || candidate.isChild ? ["split"] : []),
  ...(candidate.transferId ? ["transferred"] : []),
  ...(candidate.categoryId ? ["categorized"] : []),
]))];

export function backtestMatchingRule(input: {
  conditions: MatchConditionsV1;
  actions: MatchActionsV1;
  expectedPeriods: readonly ExpectedMatchPeriod[];
  candidates: readonly MatchCandidate[];
  accountsRead: number;
  from: string;
  to: string;
  generatedAt?: string;
}): DebtBacktestResult {
  void input.actions; // P1.4 actions are proposal intent only; evaluation never executes them.
  let cumulativeVariance = 0;
  const periods = input.expectedPeriods.map((expected): BacktestPeriod => {
    const evaluation = evaluateExpectedPeriod(input.conditions, input.candidates, expected);
    const unique = evaluation.status === "unique" ? evaluation.candidates[0] : null;
    if (unique) cumulativeVariance += unique.deviation.amountMinor;
    return {
      ...evaluation,
      projectedBalanceVarianceMinor: unique ? cumulativeVariance : null,
      flags: rowFlags(evaluation),
    };
  });
  const count = (status: BacktestPeriod["status"]) => periods.filter((period) => period.status === status).length;
  const strength = matchRuleStrength(input.conditions);
  return {
    format: DEBT_BACKTEST_FORMAT,
    version: DEBT_BACKTEST_VERSION,
    from: input.from,
    to: input.to,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    read: { accounts: input.accountsRead, transactions: input.candidates.filter((candidate) => !candidate.isChild).length },
    strength,
    warnings: strength.reasons,
    summary: { expectedPeriods: periods.length, unique: count("unique"), missing: count("missing"), multiple: count("multiple"), unsafe: count("unsafe") },
    periods,
  };
}
