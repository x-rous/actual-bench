import {
  createBackupArtifact,
  getBackupArtifact,
  recordArtifactLocation,
  type BackupDestination,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { createDestinationAdapter } from "./destinations";
import { MANIFEST_SUFFIX, parseManifest } from "./manifest";

/**
 * Rebuilding the inventory from a destination (RD-077 / PR-047e).
 *
 * This is the feature that makes the index honest about being a cache. Bench's
 * database is a convenience — fast to query, good for the UI — but a backup
 * system whose catalogue lives inside the thing being backed up has a circular
 * dependency at exactly the wrong moment. Every artifact is therefore written
 * with a manifest beside it, and this walks a destination reading them.
 *
 * The situation it is for: the server died, the volume was recreated, someone
 * restored Bench onto a fresh machine — and the bucket is still full of
 * backups. Point Bench at it and the inventory comes back, with verification
 * status, retention tier and source budget intact, without a database to
 * consult.
 *
 * It never overwrites what is already known, and never deletes: discovery adds.
 * A manifest is evidence that a file exists, not authority over Bench's record
 * of one it took itself.
 */

export type DiscoveryResult = {
  destinationId: string;
  destinationName: string;
  scanned: number;
  imported: number;
  alreadyKnown: number;
  unreadable: number;
  notes: string[];
};

export async function discoverBackups(
  db: SqliteDatabase,
  destination: BackupDestination
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    destinationId: destination.id,
    destinationName: destination.name,
    scanned: 0,
    imported: 0,
    alreadyKnown: 0,
    unreadable: 0,
    notes: [],
  };

  const adapter = createDestinationAdapter(db, destination);
  const objects = await adapter.list("");
  const manifests = objects.filter((object) => object.key.endsWith(MANIFEST_SUFFIX));

  for (const object of manifests) {
    result.scanned += 1;
    const objectKey = object.key.slice(0, -MANIFEST_SUFFIX.length);

    let manifest;
    try {
      manifest = parseManifest(await adapter.get(object.key));
    } catch (error) {
      result.unreadable += 1;
      result.notes.push(
        `${object.key}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    if (!manifest) {
      result.unreadable += 1;
      result.notes.push(`${object.key} could not be read as a manifest.`);
      continue;
    }

    // The artifact must actually be there. A manifest whose file is gone
    // describes a backup that no longer exists, and importing it would put a
    // lie in the inventory.
    const head = await adapter.head(objectKey);
    if (!head) {
      result.unreadable += 1;
      result.notes.push(`${objectKey} is described by a manifest but is not present.`);
      continue;
    }

    if (getBackupArtifact(db, manifest.artifactId)) {
      result.alreadyKnown += 1;
    } else {
      createBackupArtifact(db, {
        id: manifest.artifactId,
        // Not attached to a policy: the rule that made it may not exist on this
        // install, and inventing one would be worse than leaving it unowned.
        policyId: null,
        kind: manifest.kind,
        createdAt: manifest.createdAt,
        sourceBudgetId: manifest.source?.budgetId ?? null,
        sourceBudgetName: manifest.source?.budgetName ?? null,
        sizeBytes: manifest.sizeBytes || head.sizeBytes,
        checksumSha256: manifest.checksumSha256,
        plaintextChecksumSha256: manifest.plaintextChecksumSha256 ?? null,
        encrypted: Boolean(manifest.encryption),
        encryption: manifest.encryption
          ? { version: 1, data: { ...manifest.encryption } }
          : null,
        tier: manifest.tier,
        pinned: manifest.pinned,
        protectedUntil: manifest.protectedUntil ?? null,
        takenBefore: manifest.takenBefore ?? null,
        // Carried across, but it describes a verification that happened
        // elsewhere, possibly long ago. "Verify now" is what makes it current.
        verificationLevel: manifest.verification?.level ?? null,
        verificationStatus: manifest.verification?.status ?? "unverified",
        verifiedAt: manifest.verification?.verifiedAt ?? null,
        manifestVersion: manifest.manifestVersion,
        benchVersion: manifest.benchVersion ?? null,
        notes: "Discovered from its manifest.",
      });
      result.imported += 1;
    }

    recordArtifactLocation(db, {
      artifactId: manifest.artifactId,
      destinationId: destination.id,
      objectKey,
      status: "stored",
      uploadedAt: manifest.createdAt,
    });
  }

  if (manifests.length === 0 && objects.length > 0) {
    result.notes.push(
      `${objects.length} file(s) are here but none have a Bench manifest beside them, so Bench cannot tell what they are.`
    );
  }

  return result;
}
