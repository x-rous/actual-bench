import { getBackupArtifact, recordArtifactVerification, type BackupArtifact } from "@/lib/app-db/backupRepository";
import type { JsonObject, SqliteDatabase } from "@/lib/app-db/types";
import type { BackupContentSummary, BackupVerificationLevel } from "./manifest";
import { plausibilityOf, strings } from "./plausibility";

export { isAnomalyFinding, plausibilityOf, type PlausibilityState } from "./plausibility";

/**
 * What Bench records about a copy after reading it (RD-077).
 *
 * Two kinds of finding live on a copy and must not be confused:
 *
 *   * **Readability**: does it open, does SQLite trust it, are Actual's
 *     tables there. Re-checked by every scrub and every "Look inside".
 *   * **Plausibility**: is it suspiciously smaller than the last good copy
 *     of the same budget. Decided once, when the copy is taken, because it is
 *     a comparison with what came before. Only a person can settle it, by
 *     accepting the change.
 *
 * A re-read answers the first question only. It used to overwrite the whole
 * record with its findings, which dropped the copy's contents (the counts the
 * next backup is compared against) and turned a copy that was readable but
 * implausible back into "verified". Every re-read goes through here instead.
 */

/** Strip `undefined` and non-scalar values so a content summary can be stored as JSON. */
export function jsonSummary(content: BackupContentSummary | Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || value === null) out[key] = value;
  }
  return out;
}

/**
 * Record the outcome of reading a copy again.
 *
 * Keeps everything already known, replaces the readability findings, keeps
 * the contents unless the read produced newer ones, and keeps a copy that is
 * readable but implausible marked failed until someone accepts the change.
 */
export function recordReadOutcome(
  db: SqliteDatabase,
  artifact: BackupArtifact,
  outcome: {
    level: BackupVerificationLevel;
    status: "passed" | "failed";
    findings: string[];
    content?: BackupContentSummary;
  },
  at: string
): void {
  // Merged with the record as it is now, not as it was when the read began:
  // a scrub or "Look inside" can take minutes, and a change accepted in the
  // meantime must not come back as unresolved. One transaction, so no other
  // connection's write lands between the read and this one.
  db.transaction(() => {
    const current = getBackupArtifact(db, artifact.id);
    if (current) writeReadOutcome(db, current, outcome, at);
  })();
}

function writeReadOutcome(
  db: SqliteDatabase,
  artifact: BackupArtifact,
  outcome: Parameters<typeof recordReadOutcome>[2],
  at: string
): void {
  const data = (artifact.verification?.data ?? {}) as JsonObject;
  const { unresolved } = plausibilityOf(artifact);
  const holdBack = outcome.status === "passed" && unresolved.length > 0;
  const content =
    outcome.content && Object.keys(jsonSummary(outcome.content)).length > 0
      ? jsonSummary(outcome.content)
      : (data.content ?? null);

  recordArtifactVerification(db, artifact.id, {
    level: outcome.level,
    status: holdBack ? "failed" : outcome.status,
    at,
    findings: {
      version: 1,
      data: {
        ...data,
        findings: [...outcome.findings, ...unresolved.filter((entry) => !outcome.findings.includes(entry))],
        anomalies: unresolved.length > 0 ? unresolved : strings(data.anomalies),
        readable: outcome.status === "passed",
        content,
      },
    },
  });
}

/**
 * Accept a copy's plausibility findings: "I deleted those on purpose".
 *
 * Allowed only for a copy whose only problem is the comparison. Afterwards it
 * counts as verified and becomes the copy the next backup is compared with,
 * so a genuine clean-up does not fail every backup after it.
 */
export function acceptPlausibilityFindings(db: SqliteDatabase, artifact: BackupArtifact, at: string): boolean {
  // Decided on the record as it is now, in the same transaction as the write:
  // a read on another connection that found the copy unreadable since the
  // page loaded must block the acceptance, not be overwritten by it.
  return db.transaction(() => {
    const current = getBackupArtifact(db, artifact.id);
    return current ? writeAcceptance(db, current, at) : false;
  })();
}

function writeAcceptance(db: SqliteDatabase, artifact: BackupArtifact, at: string): boolean {
  const { unresolved, readable } = plausibilityOf(artifact);
  if (unresolved.length === 0 || !readable) return false;
  const data = (artifact.verification?.data ?? {}) as JsonObject;
  recordArtifactVerification(db, artifact.id, {
    level: artifact.verificationLevel ?? "data",
    status: "passed",
    at,
    findings: {
      version: 1,
      data: {
        ...data,
        findings: strings(data.findings).filter((finding) => !unresolved.includes(finding)),
        anomalies: unresolved,
        anomaliesAcceptedAt: at,
        readable: true,
      },
    },
  });
  return true;
}
