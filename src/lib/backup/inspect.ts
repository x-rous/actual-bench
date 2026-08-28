import { getBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import {
  getBackupArtifact,
  getBackupDestination,
  getBackupPolicy,
  listArtifactLocations,
  recordArtifactVerification,
  type BackupArtifact,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { createDestinationAdapter } from "./destinations";
import { decryptArchive } from "./encryption";
import { sha256 } from "./manifest";
import { verifyAppDbArchive, verifyBudgetArchive, type VerificationOutcome } from "./verify";

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
  options: { passphrase?: string } = {}
): Promise<InspectionResult> {
  const artifact = getBackupArtifact(db, artifactId);
  if (!artifact) throw new Error("That backup is not in the inventory.");

  const location = listArtifactLocations(db, artifactId).find(
    (entry) => entry.status === "stored" && entry.destinationId
  );
  if (!location?.destinationId) {
    throw new Error("Bench has no stored copy of this backup to open.");
  }

  const destination = getBackupDestination(db, location.destinationId);
  if (!destination) throw new Error("The destination holding this backup has been removed.");

  const adapter = createDestinationAdapter(db, destination);
  const bytes = await adapter.get(location.objectKey);
  const checksumMatches = sha256(bytes) === artifact.checksumSha256;

  const base = {
    artifact,
    objectKey: location.objectKey,
    destinationName: destination.name,
    checksumMatches,
    encrypted: artifact.encrypted,
  };

  if (!checksumMatches) {
    // Say it plainly and stop: opening bytes that are already known to be wrong
    // tells the user nothing they can use.
    return {
      ...base,
      opened: false,
      verification: null,
      message:
        "The stored bytes no longer match the checksum recorded when this backup was written. Treat it as damaged.",
    };
  }

  let plaintext: Uint8Array = bytes;
  if (artifact.encrypted) {
    const passphrase = options.passphrase ?? storedPassphrase(db, artifact);
    if (!passphrase) {
      return {
        ...base,
        opened: false,
        verification: null,
        message:
          "This backup is encrypted and Bench has no stored passphrase for it. Enter the passphrase to look inside.",
      };
    }
    plaintext = decryptArchive(bytes, passphrase);
  }

  const verification =
    artifact.kind === "budget"
      ? verifyBudgetArchive(plaintext, "deep")
      : verifyAppDbArchive(plaintext, "data");

  // An inspection is a verification, so it counts as one. Anything else would
  // mean a user could open a backup, see it is fine, and still be told on the
  // list that Bench has never checked it.
  recordArtifactVerification(db, artifact.id, {
    level: verification.level,
    status: verification.status,
    at: new Date().toISOString(),
    findings: { version: 1, data: { findings: verification.findings } },
  });

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

function storedPassphrase(db: SqliteDatabase, artifact: BackupArtifact): string | null {
  // The artifact's own reference first, so a copy whose rule was deleted can
  // still be opened with the passphrase Bench kept for it.
  const ref =
    artifact.encryptionCredentialRef ??
    (artifact.policyId ? getBackupPolicy(db, artifact.policyId)?.encryptionCredentialRef ?? null : null);
  if (!ref) return null;
  try {
    const secret = getBackupCredential(db, ref);
    return secret && "passphrase" in secret ? secret.passphrase : null;
  } catch {
    return null;
  }
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
