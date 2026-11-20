/**
 * Telling "smaller than last time" from "unreadable" (RD-077).
 *
 * Pure and browser-safe: the page uses it to label a copy, the server to
 * decide what a re-read may change. See `verificationRecord.ts`.
 */

/**
 * The wording `detectBackupAnomalies` uses, for copies recorded before
 * anomalies were stored separately from other findings.
 */
const ANOMALY_PATTERNS = [
  /fewer transactions than the previous one/,
  /fewer account\(s\) than the previous one/,
  /less than half the size of the previous one/,
];

export function isAnomalyFinding(finding: string): boolean {
  return ANOMALY_PATTERNS.some((pattern) => pattern.test(finding));
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export type PlausibilityState = {
  /** Plausibility findings not yet accepted by a person. */
  unresolved: string[];
  /** Whether the copy itself read cleanly (only the comparison failed). */
  readable: boolean;
};

/** What a copy's record says about its plausibility. */
export function plausibilityOf(artifact: {
  verification: { data: Record<string, unknown> } | null;
  verificationStatus: string;
}): PlausibilityState {
  const data = artifact.verification?.data ?? {};
  const findings = strings(data.findings);
  const recorded = strings(data.anomalies);
  // Older copies carry anomalies only inside their findings.
  const anomalies = recorded.length > 0 ? recorded : findings.filter(isAnomalyFinding);
  if (anomalies.length === 0 || typeof data.anomaliesAcceptedAt === "string") {
    return { unresolved: [], readable: artifact.verificationStatus !== "failed" };
  }
  const readable =
    typeof data.readable === "boolean"
      ? data.readable
      : findings.every((finding) => anomalies.includes(finding) || !finding.includes(":"));
  return { unresolved: anomalies, readable };
}

