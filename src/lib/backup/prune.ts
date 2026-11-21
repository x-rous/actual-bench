import {
  deleteBackupArtifact,
  getBackupDestination,
  listBackupDestinations,
  listLocationsByArtifact,
  recordArtifactLocation,
  type BackupArtifact,
  type BackupArtifactLocation,
  type BackupPolicy,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { openDestination, type DestinationAdapter } from "./destinations";
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
  /**
   * Records of runs that never stored a copy anywhere, removed. There was no
   * file to delete; the row only cluttered the inventory.
   */
  cleaned: number;
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
  artifacts: BackupArtifact[],
  locations: Map<string, BackupArtifactLocation[]> = listLocationsByArtifact(db)
): BackupArtifact[] {
  return artifacts.filter((artifact) =>
    (locations.get(artifact.id) ?? []).some((location) => location.status === "stored")
  );
}

/**
 * Rows for runs that never stored a copy: every location is a failed upload
 * (never uploaded), or there is none. A location that was stored once and
 * later failed a check is not one of these - its file is still out there.
 */
function neverStored(locations: BackupArtifactLocation[]): boolean {
  return locations.every((location) => location.status === "failed" && location.uploadedAt === null);
}

export type PrunePlanInput = {
  artifacts: BackupArtifact[];
  retention: BackupPolicy["retention"];
  now?: Date;
};

type Context = {
  artifacts: Map<string, BackupArtifact>;
  locations: Map<string, BackupArtifactLocation[]>;
  destinationNames: Map<string, string>;
};

function context(db: SqliteDatabase, artifacts: BackupArtifact[]): Context {
  return {
    artifacts: new Map(artifacts.map((artifact) => [artifact.id, artifact])),
    locations: listLocationsByArtifact(db),
    destinationNames: new Map(listBackupDestinations(db).map((destination) => [destination.id, destination.name])),
  };
}

function plan(db: SqliteDatabase, input: PrunePlanInput, ctx: Context) {
  return planRetention(storedArtifacts(db, input.artifacts, ctx.locations), input.retention, input.now);
}

function strays(input: PrunePlanInput, ctx: Context): BackupArtifact[] {
  const now = (input.now ?? new Date()).getTime();
  return input.artifacts.filter(
    (artifact) =>
      neverStored(ctx.locations.get(artifact.id) ?? []) &&
      now - new Date(artifact.createdAt).getTime() >= input.retention.minimumAgeHours * 3_600_000
  );
}

/** Preview what a prune would do, without touching a destination. */
export function previewPrune(db: SqliteDatabase, input: PrunePlanInput): PruneResult {
  const ctx = context(db, input.artifacts);
  const decided = plan(db, input, ctx);
  return {
    dryRun: true,
    kept: decided.keep.length,
    failed: 0,
    freedBytes: decided.prune.reduce((total, decision) => total + (ctx.artifacts.get(decision.artifactId)?.sizeBytes ?? 0), 0),
    pruned: decided.prune.map((decision) => describe(ctx, decision)),
    cleaned: strays(input, ctx).length,
  };
}

function describe(ctx: Context, decision: RetentionDecision): PruneEntry {
  const artifact = ctx.artifacts.get(decision.artifactId);
  return {
    artifactId: decision.artifactId,
    reason: decision.reason,
    createdAt: artifact?.createdAt ?? "",
    kind: artifact?.kind ?? "budget",
    sizeBytes: artifact?.sizeBytes ?? 0,
    removed: false,
    locations: (ctx.locations.get(decision.artifactId) ?? []).map((location) => ({
      destinationName:
        (location.destinationId && ctx.destinationNames.get(location.destinationId)) || "Unknown destination",
      objectKey: location.objectKey,
      status: "deleted",
    })),
  };
}

export async function prune(
  db: SqliteDatabase,
  input: PrunePlanInput & {
    dryRun?: boolean;
    /**
     * Only these may be removed: the copies a person was shown in the
     * preview. The plan is worked out again here, and a backup finishing in
     * between can change it; a copy the plan now prunes that was not in the
     * preview is left alone, and one the preview showed that the plan now
     * keeps is kept.
     */
    onlyIds?: string[];
    signal?: AbortSignal;
  }
): Promise<PruneResult> {
  if (input.dryRun) return previewPrune(db, input);

  const ctx = context(db, input.artifacts);
  const allowed = input.onlyIds ? new Set(input.onlyIds) : null;
  const decided = plan(db, input, ctx);
  const decisions = decided.prune.filter((decision) => !allowed || allowed.has(decision.artifactId));
  const kept = decided.keep.length + (decided.prune.length - decisions.length);
  const entries: PruneEntry[] = [];
  let failed = 0;
  let freedBytes = 0;
  const adapters = new Map<string, Promise<DestinationAdapter>>();

  for (const decision of decisions) {
    if (input.signal?.aborted) break;
    const artifact = ctx.artifacts.get(decision.artifactId);
    if (!artifact) continue;

    const locations = ctx.locations.get(artifact.id) ?? [];
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
        // Checked once per destination: deleting through a folder whose
        // volume is unmounted "succeeds" on files that are not there, and the
        // real copies would be recorded as gone.
        let opening = adapters.get(destination.id);
        if (!opening) {
          opening = openDestination(db, destination, { signal: input.signal });
          adapters.set(destination.id, opening);
        }
        const adapter = await opening;
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

  let cleaned = 0;
  for (const stray of strays(input, ctx)) {
    // Stops with the rest of the run, and an apply from the preview removes
    // only rows the preview listed.
    if (input.signal?.aborted) break;
    if (allowed && !allowed.has(stray.id)) continue;
    if (deleteBackupArtifact(db, stray.id)) cleaned += 1;
  }

  return { dryRun: false, kept, pruned: entries, failed, freedBytes, cleaned };
}
