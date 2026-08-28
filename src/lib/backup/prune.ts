import {
  deleteBackupArtifact,
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
  recordArtifactLocation,
  type BackupArtifact,
  type BackupPolicy,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { createDestinationAdapter } from "./destinations";
import { manifestKeyFor } from "./manifest";
import { planRetention, type RetentionDecision } from "./retention";

/**
 * Carrying out a retention plan (RD-077 / PR-047d).
 *
 * Separate from `planRetention` on purpose: deciding and deleting are different
 * acts, and keeping them apart means the preview a user approves is produced by
 * exactly the code that then runs, not by a second implementation that agrees
 * with it most of the time.
 *
 * The failure rule is the interesting one. If a copy cannot be deleted — the
 * bucket is unreachable, the volume is read-only — the artifact **keeps its
 * row**. Removing Bench's record of a file that is still sitting in a
 * destination would turn a transient error into an orphan nobody knows about,
 * and the whole point of the index is that it tells the truth about what exists.
 */

export type PruneEntry = {
  artifactId: string;
  reason: string;
  createdAt: string;
  kind: string;
  sizeBytes: number;
  /** Where copies of it live, and what happened to each. */
  locations: { destinationName: string; objectKey: string; status: "deleted" | "failed" | "missing"; error?: string }[];
  removed: boolean;
};

export type PruneResult = {
  dryRun: boolean;
  kept: number;
  pruned: PruneEntry[];
  failed: number;
  freedBytes: number;
};

/**
 * The artifacts retention is allowed to reason about: the ones that exist.
 *
 * `listBackupArtifacts` includes rows whose upload failed, and those are
 * verified - verification happens before the copy is written. Left in, such a
 * row could become the newest verified copy and satisfy the rule that protects
 * it, while the real stored copy it was standing in for got pruned. A backup
 * that is not anywhere protects nothing.
 */
export function storedArtifacts(
  db: SqliteDatabase,
  artifacts: BackupArtifact[]
): BackupArtifact[] {
  return artifacts.filter((artifact) =>
    listArtifactLocations(db, artifact.id).some((location) => location.status === "stored")
  );
}

export type PrunePlanInput = {
  artifacts: BackupArtifact[];
  retention: BackupPolicy["retention"];
  now?: Date;
};

/** Preview what a prune would do, without touching a destination. */
export function previewPrune(db: SqliteDatabase, input: PrunePlanInput): PruneResult {
  const plan = planRetention(storedArtifacts(db, input.artifacts), input.retention, input.now);
  return {
    dryRun: true,
    kept: plan.keep.length,
    failed: 0,
    freedBytes: sumBytes(db, plan.prune),
    pruned: plan.prune.map((decision) => describe(db, decision, true)),
  };
}

function sumBytes(db: SqliteDatabase, decisions: RetentionDecision[]): number {
  return decisions.reduce((total, decision) => {
    const artifact = getBackupArtifact(db, decision.artifactId);
    return total + (artifact?.sizeBytes ?? 0);
  }, 0);
}

function describe(db: SqliteDatabase, decision: RetentionDecision, preview: boolean): PruneEntry {
  const artifact = getBackupArtifact(db, decision.artifactId);
  const locations = listArtifactLocations(db, decision.artifactId);
  return {
    artifactId: decision.artifactId,
    reason: decision.reason,
    createdAt: artifact?.createdAt ?? "",
    kind: artifact?.kind ?? "budget",
    sizeBytes: artifact?.sizeBytes ?? 0,
    removed: false,
    locations: locations.map((location) => ({
      destinationName:
        (location.destinationId && getBackupDestination(db, location.destinationId)?.name) ||
        "Unknown destination",
      objectKey: location.objectKey,
      status: preview ? "deleted" : "missing",
    })),
  };
}

export async function prune(
  db: SqliteDatabase,
  input: PrunePlanInput & { dryRun?: boolean }
): Promise<PruneResult> {
  if (input.dryRun) return previewPrune(db, input);

  const plan = planRetention(storedArtifacts(db, input.artifacts), input.retention, input.now);
  const entries: PruneEntry[] = [];
  let failed = 0;
  let freedBytes = 0;

  for (const decision of plan.prune) {
    const artifact = getBackupArtifact(db, decision.artifactId);
    if (!artifact) continue;

    const locations = listArtifactLocations(db, artifact.id);
    const results: PruneEntry["locations"] = [];
    let allGone = true;

    for (const location of locations) {
      const destination = location.destinationId ? getBackupDestination(db, location.destinationId) : null;
      if (!destination) {
        // The destination was removed from Bench. There is nothing to delete
        // through, so the record goes but no claim is made about the file.
        results.push({ destinationName: "Removed destination", objectKey: location.objectKey, status: "missing" });
        continue;
      }
      if (location.status === "deleted" || location.status === "failed") {
        results.push({ destinationName: destination.name, objectKey: location.objectKey, status: "missing" });
        continue;
      }

      try {
        const adapter = createDestinationAdapter(db, destination);
        await adapter.remove(location.objectKey);
        await adapter.remove(manifestKeyFor(location.objectKey));
        recordArtifactLocation(db, {
          artifactId: artifact.id,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "deleted",
        });
        results.push({ destinationName: destination.name, objectKey: location.objectKey, status: "deleted" });
      } catch (error) {
        allGone = false;
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        recordArtifactLocation(db, {
          artifactId: artifact.id,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "stored",
          lastError: message,
        });
        results.push({
          destinationName: destination.name,
          objectKey: location.objectKey,
          status: "failed",
          error: message,
        });
      }
    }

    if (allGone) {
      deleteBackupArtifact(db, artifact.id);
      freedBytes += artifact.sizeBytes;
    }

    entries.push({
      artifactId: artifact.id,
      reason: decision.reason,
      createdAt: artifact.createdAt,
      kind: artifact.kind,
      sizeBytes: artifact.sizeBytes,
      locations: results,
      removed: allGone,
    });
  }

  return { dryRun: false, kept: plan.keep.length, pruned: entries, failed, freedBytes };
}
