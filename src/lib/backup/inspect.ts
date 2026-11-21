import type { BackupArtifact } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { readArtifact, unopenedMessage } from "./openArtifact";
import { verifyAppDbArchive, verifyBudgetArchive, type VerificationOutcome } from "./verify";
import { recordReadOutcome } from "./verificationRecord";

export { readableLocations } from "./openArtifact";

/**
 * Looking inside a backup without restoring it (RD-077 / PR-047e).
 *
 * The question people actually have in front of a list of backups is not "is
 * this file intact" but "is *this* the one — does it still have the account I
 * deleted, does it stop before the import that went wrong". Answering that by
 * restoring means creating a budget, opening it, looking, and cleaning up.
 *
 * So Bench opens the archive server-side and reports what is in it: how many
 * accounts, payees, categories and transactions, and the date range covered.
 * Nothing is written anywhere and no budget is created — this is a read.
 */

export type InspectionResult = {
  artifact: BackupArtifact;
  objectKey: string;
  destinationName: string;
  checksumMatches: boolean;
  encrypted: boolean;
  /** False when it is encrypted and Bench has no stored passphrase for it. */
  opened: boolean;
  verification: VerificationOutcome | null;
  message: string;
};

export async function inspectArtifact(
  db: SqliteDatabase,
  artifactId: string,
  options: { passphrase?: string; signal?: AbortSignal } = {}
): Promise<InspectionResult> {
  const read = await readArtifact(db, artifactId, options);
  const { artifact } = read;
  const base = {
    artifact,
    objectKey: read.objectKey,
    destinationName: read.destinationName,
    checksumMatches: read.status !== "damaged",
    encrypted: artifact.encrypted,
  };

  // A damaged copy is said plainly and not opened: opening bytes already
  // known to be wrong tells the user nothing they can use.
  if (read.status !== "opened") {
    return { ...base, opened: false, verification: null, message: unopenedMessage(read) };
  }

  const verification =
    artifact.kind === "budget"
      ? verifyBudgetArchive(read.plaintext, "deep")
      : verifyAppDbArchive(read.plaintext, "data");

  // An inspection is a verification, so it counts as one. Anything else would
  // mean a user could open a backup, see it is fine, and still be told on the
  // list that Bench has never checked it.
  recordReadOutcome(db, artifact, verification, new Date().toISOString());

  return {
    ...base,
    opened: true,
    verification,
    message:
      verification.status === "passed"
        ? describeContents(verification)
        : verification.findings[0] ?? "Bench could not read this backup.",
  };
}

function describeContents(verification: VerificationOutcome): string {
  const { content } = verification;
  if (content.transactions === undefined) return "Opened and read; it is a valid database.";
  const range =
    content.earliestTransaction && content.latestTransaction
      ? ` covering ${content.earliestTransaction} to ${content.latestTransaction}`
      : "";
  return `${content.transactions.toLocaleString()} transactions across ${
    content.accounts ?? 0
  } accounts${range}.`;
}
