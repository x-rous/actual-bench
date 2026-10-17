import type { ActualIndex } from "@/lib/reconciliation/match/actualIndex";
import { scoreAmountMismatchCandidate, scoreCandidate, scoreSameMerchantCandidate } from "@/lib/reconciliation/match/score";
import type { ActualTransactionSnapshot, MatchConfig, StatementRow } from "@/lib/reconciliation/types";
import { describeReason } from "./format";

/** Explain an existing edge; this never admits a new match or changes a decision. */
export function candidateEvidence(row: StatementRow, transaction: ActualTransactionSnapshot,
  config: MatchConfig, index: ActualIndex): string[] {
  const candidate = transaction.amount === row.amount || transaction.amount === row.originalAmount
    ? scoreCandidate(row, transaction, config, index)
    : scoreAmountMismatchCandidate(row, transaction, config, index) ??
      scoreSameMerchantCandidate(row, transaction, config, index);
  return (candidate?.reasons ?? []).filter((reason) => reason.kind === "reference" ||
    reason.kind === "date" || reason.kind === "amount" ||
    (reason.kind === "text" && reason.similarity > 0)).map(describeReason).slice(0, 3);
}
