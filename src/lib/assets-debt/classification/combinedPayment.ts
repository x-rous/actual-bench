export type CombinedPaymentCandidate = {
  transactionId: string;
  amountMinor: number;
  isSplitParent: boolean;
  children?: { transactionId: string; amountMinor: number; debtIds: string[] }[];
  debtIds: string[];
};

export type CombinedPaymentDecision =
  | { classification: "single"; claims: { transactionId: string; debtId: string }[]; reasons: string[] }
  | { classification: "review" | "blocked"; claims: []; reasons: string[] };

/**
 * Identify whether a row already has claimable debt-specific children. This
 * never searches subsets or invents a partial allocation for an unsplit row.
 */
export function classifyCombinedPayment(
  candidate: CombinedPaymentCandidate,
  expectedWholeRows: readonly { debtId: string; amountMinor: number }[] = []
): CombinedPaymentDecision {
  if (candidate.isSplitParent) {
    const children = candidate.children ?? [];
    if (!children.length || children.some((child) => child.debtIds.length !== 1)) {
      return { classification: "blocked", claims: [], reasons: ["split-children-ambiguous"] };
    }
    return {
      classification: "single",
      claims: children.map((child) => ({ transactionId: child.transactionId, debtId: child.debtIds[0] })),
      reasons: ["claim-specific-split-children"],
    };
  }
  if (candidate.debtIds.length <= 1) {
    return candidate.debtIds.length === 1
      ? { classification: "single", claims: [{ transactionId: candidate.transactionId, debtId: candidate.debtIds[0] }], reasons: [] }
      : { classification: "blocked", claims: [], reasons: ["no-debt-identified"] };
  }
  const explicitlyReconciles = expectedWholeRows.length === candidate.debtIds.length
    && new Set(expectedWholeRows.map((row) => row.debtId)).size === candidate.debtIds.length
    && expectedWholeRows.every((row) => candidate.debtIds.includes(row.debtId))
    && expectedWholeRows.reduce((sum, row) => sum + row.amountMinor, 0) === Math.abs(candidate.amountMinor);
  return explicitlyReconciles
    ? { classification: "review", claims: [], reasons: ["unsplit-multi-debt-payment-needs-explicit-split"] }
    : { classification: "blocked", claims: [], reasons: ["unsplit-multi-debt-allocation-unknown"] };
}
