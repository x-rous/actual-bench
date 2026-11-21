import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import {
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
  type BackupArtifact,
  type BackupArtifactLocation,
  type BackupDestination,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { createDestinationAdapter } from "./destinations";
import { decryptArchive } from "./encryption";
import { sha256 } from "./manifest";
import { verifyAppDbArchive, verifyBudgetArchive, type VerificationOutcome } from "./verify";
import { recordReadOutcome } from "./verificationRecord";

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
  const artifact = getBackupArtifact(db, artifactId);
  if (!artifact) throw new Error("That backup is not in the inventory.");

  // Every stored copy, healthiest destination first, until one can be read:
  // trying only the first left a second, intact copy unused whenever the
  // first destination was down.
  const candidates = readableLocations(db, artifactId);
  if (candidates.length === 0) {
    throw new Error("Bench has no stored copy of this backup to open.");
  }

  // The first copy whose bytes match the checksum wins. A damaged copy is
  // passed over for the next one, and reported as damaged only when every
  // copy that could be read is.
  let bytes: Buffer | null = null;
  let damaged: { bytes: Buffer; candidate: (typeof candidates)[number] } | null = null;
  let location = candidates[0].location;
  let destination = candidates[0].destination;
  const errors: string[] = [];
  for (const candidate of candidates) {
    let read: Buffer;
    try {
      read = await createDestinationAdapter(db, candidate.destination, { signal: options.signal }).get(
        candidate.location.objectKey
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      errors.push(`${candidate.destination.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (sha256(read) !== artifact.checksumSha256) {
      damaged ??= { bytes: read, candidate };
      continue;
    }
    bytes = read;
    location = candidate.location;
    destination = candidate.destination;
    break;
  }
  if (!bytes && damaged) {
    bytes = damaged.bytes;
    location = damaged.candidate.location;
    destination = damaged.candidate.destination;
  }
  if (!bytes) throw new Error(`No copy of this backup could be read. ${errors.join("; ")}`);

  const checksumMatches = !damaged || bytes !== damaged.bytes;

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

/**
 * The stored copies of an artifact Bench can reach, healthiest destination
 * first: one whose last outcome was a success before one that last failed.
 */
export function readableLocations(
  db: SqliteDatabase,
  artifactId: string
): { location: BackupArtifactLocation; destination: BackupDestination }[] {
  const healthy = (destination: BackupDestination) =>
    !destination.lastFailureAt || (destination.lastSuccessAt ?? "") > destination.lastFailureAt;
  return listArtifactLocations(db, artifactId)
    .filter((location) => location.status === "stored" && location.destinationId)
    .map((location) => ({ location, destination: getBackupDestination(db, location.destinationId as string) }))
    .filter(
      (entry): entry is { location: BackupArtifactLocation; destination: BackupDestination } =>
        entry.destination !== null
    )
    .sort((a, b) => Number(healthy(b.destination)) - Number(healthy(a.destination)));
}

function storedPassphrase(db: SqliteDatabase, artifact: BackupArtifact): string | null {
  // The artifact's own reference only: a rule's current passphrase cannot
  // open a copy taken before it changed.
  const ref = artifact.encryptionCredentialRef;
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
