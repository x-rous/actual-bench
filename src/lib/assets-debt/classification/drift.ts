export type DriftComparison = {
  comparisonDate: string;
  modelMinor: number;
  actualMinor: number;
  lenderMinor: number | null;
  modelVsActualMinor: number;
  modelVsLenderMinor: number | null;
  actualVsLenderMinor: number | null;
};

export type DriftState = "in-sync" | "material" | "accepted";

/** Pure three-way comparison. Projected balance variance is deliberately not accepted here. */
export function compareDebtBalances(input: { comparisonDate: string; modelMinor: number; actualMinor: number; lenderMinor?: number | null }): DriftComparison {
  const lender = input.lenderMinor ?? null;
  return {
    comparisonDate: input.comparisonDate,
    modelMinor: input.modelMinor,
    actualMinor: input.actualMinor,
    lenderMinor: lender,
    modelVsActualMinor: input.modelMinor - input.actualMinor,
    modelVsLenderMinor: lender === null ? null : input.modelMinor - lender,
    actualVsLenderMinor: lender === null ? null : input.actualMinor - lender,
  };
}

export function debtDriftState(input: {
  comparison: DriftComparison;
  toleranceMinor: number;
  currentRevision: number;
  acceptedRevision: number | null;
  /** The accepted comparison must still be the same evidence, not merely the same revision. */
  acceptedFingerprint?: string | null;
  currentFingerprint?: string | null;
}): DriftState {
  const differences = [input.comparison.modelVsActualMinor, input.comparison.modelVsLenderMinor, input.comparison.actualVsLenderMinor]
    .filter((value): value is number => value !== null);
  if (differences.every((value) => Math.abs(value) <= input.toleranceMinor)) return "in-sync";
  if (input.acceptedRevision === input.currentRevision && input.acceptedFingerprint != null && input.acceptedFingerprint === input.currentFingerprint) return "accepted";
  return "material";
}

export function driftFingerprint(comparison: DriftComparison): string {
  return JSON.stringify([comparison.comparisonDate, comparison.modelMinor, comparison.actualMinor, comparison.lenderMinor]);
}
