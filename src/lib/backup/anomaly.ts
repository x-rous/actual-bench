import type { BackupArtifact } from "@/lib/app-db/backupRepository";
import type { BackupContentSummary } from "./manifest";

/**
 * Noticing that a backup got suspiciously smaller (RD-077).
 *
 * Every check in `verify.ts` asks whether an artifact is *readable*. This asks
 * a different question: whether it is *plausible*. A truncated export, a source
 * budget that failed to open half its data, an account that vanished upstream —
 * all produce a perfectly valid archive containing the wrong amount of budget,
 * and integrity checks pass on all of them.
 *
 * The rule has to survive legitimate shrinkage: people do delete accounts and
 * clean up transactions. So the thresholds are deliberately loose, and the
 * wording never accuses — it states the change, says what would explain it, and
 * leaves the judgement with the person who knows whether they deleted anything.
 *
 * A copy that trips this is still stored and still restorable. It simply does
 * not get to claim it was verified.
 */

/** A drop larger than this fraction is worth interrupting someone over. */
const TRANSACTION_DROP = 0.1;
const SIZE_DROP = 0.5;

export type AnomalyInput = {
  /** What the new copy contains. */
  content: BackupContentSummary;
  sizeBytes: number;
  /** The most recent comparable copy, if there is one. */
  previous: BackupArtifact | null;
  previousContent: BackupContentSummary | null;
};

function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * Returns findings, worst first. Empty when there is nothing to compare against
 * — the first backup of anything is never an anomaly, and treating it as one
 * would make the feature cry wolf on day one.
 */
export function detectBackupAnomalies(input: AnomalyInput): string[] {
  const findings: string[] = [];
  const { previous, previousContent } = input;
  if (!previous) return findings;

  const before = previousContent?.transactions;
  const after = input.content.transactions;
  if (typeof before === "number" && typeof after === "number" && before > 0) {
    const drop = (before - after) / before;
    if (drop > TRANSACTION_DROP) {
      findings.push(
        `This copy has ${Math.round(drop * 100)}% fewer transactions than the previous one (${formatCount(
          before
        )} → ${formatCount(after)}). If you deleted them, this is expected; if not, check the source budget before relying on this copy.`
      );
    }
  }

  const beforeAccounts = previousContent?.accounts;
  const afterAccounts = input.content.accounts;
  if (
    typeof beforeAccounts === "number" &&
    typeof afterAccounts === "number" &&
    afterAccounts < beforeAccounts
  ) {
    findings.push(
      `This copy has ${beforeAccounts - afterAccounts} fewer account(s) than the previous one (${beforeAccounts} → ${afterAccounts}).`
    );
  }

  // Size is the only signal for a copy of Bench's own database, and the
  // backstop when a budget export is unreadable enough to have no counts.
  if (previous.sizeBytes > 0 && input.sizeBytes < previous.sizeBytes * SIZE_DROP) {
    findings.push(
      `This copy is less than half the size of the previous one (${formatBytes(
        previous.sizeBytes
      )} → ${formatBytes(input.sizeBytes)}), which usually means the export was cut short.`
    );
  }

  return findings;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Read a previously recorded content summary off an artifact's verification. */
export function contentOf(artifact: BackupArtifact | null): BackupContentSummary | null {
  const raw = artifact?.verification?.data.content;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as BackupContentSummary;
}
