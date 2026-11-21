import { z } from "zod";
import { getAppDb } from "@/lib/app-db/connection";
import { getBackupDestination, getBackupPolicy, listBackupDestinations } from "@/lib/app-db/backupRepository";
import type { AutomationRunPhase } from "@/lib/automation/registry";
import { openSecret, type SealedSecret } from "@/lib/sync/vault";
import { discoverBackups, type DiscoveryResult } from "./discover";
import { compareArtifact } from "./compare";
import { inspectArtifact } from "./inspect";
import { runBackup } from "./runBackup";
import { takeSafetyRecoveryPoint } from "./safetyPoint";
import { scrubAll } from "./scrub";
import { BACKUP_SEARCH_KINDS, searchArtifact } from "./search";
import { readParkedArchive } from "./uploadedArchive";

/**
 * The Backups page's heavy work, as worker tasks (RD-077).
 *
 * Verifying a copy unzips it, writes and opens a SQLite file, runs integrity
 * and diagnostic checks, derives a scrypt key and hashes every byte - all
 * synchronous. Run in a route, that blocked the web server's only thread for
 * as long as it took, and every other request (the HTTP proxy included)
 * waited behind it. Each handler here is the same code a route used to call,
 * run in a disposable worker instead.
 *
 * Inputs are references - ids, a path to an archive parked on disk, and at
 * most a passphrase sealed with the vault key - never a plaintext secret.
 * Results are plain data.
 */

type TaskContext = { signal: AbortSignal; enterPhase(phase: AutomationRunPhase): void };

const parkedArchive = z
  .object({ path: z.string().min(1), budgetId: z.string().nullable(), budgetName: z.string().nullable() })
  .nullable()
  .optional();

const sealed = z.object({ ciphertext: z.string(), iv: z.string(), authTag: z.string() });

export const backupScrubInput = z.object({
  destinationIds: z.array(z.string()),
  newest: z.number().int().min(0).max(1000),
  deepest: z.number().int().min(0).max(1000),
});

export const backupInspectInput = z.object({ artifactId: z.string().min(1), passphrase: sealed.nullable() });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

export const backupSearchInput = z.object({
  artifactId: z.string().min(1),
  passphrase: sealed.nullable(),
  query: z.object({
    kind: z.enum(BACKUP_SEARCH_KINDS as [string, ...string[]]),
    text: z.string().max(200),
    from: isoDate,
    to: isoDate,
    page: z.number().int().min(0).max(100_000).optional(),
  }),
});

export const backupCompareInput = z.object({ artifactId: z.string().min(1), passphrase: sealed.nullable() });

export const backupDiscoverInput = z.object({ destinationId: z.string().nullable() });

export const backupRunInput = z.object({
  policyId: z.string().min(1),
  takenBefore: z.string().nullable(),
  notes: z.string().nullable(),
  archive: parkedArchive,
});

export const backupSafetyPointInput = z.object({
  reason: z.string(),
  connectionFingerprint: z.string().nullable(),
  force: z.boolean(),
  archive: parkedArchive,
});

export async function scrubTask(raw: unknown, signal?: AbortSignal) {
  const input = backupScrubInput.parse(raw);
  const db = getAppDb();
  const ids =
    input.destinationIds.length > 0
      ? input.destinationIds
      : listBackupDestinations(db)
          .filter((destination) => destination.enabled)
          .map((destination) => destination.id);
  return scrubAll(db, ids, { newest: input.newest, deepest: input.deepest, signal });
}

export async function inspectTask(raw: unknown, signal?: AbortSignal) {
  const input = backupInspectInput.parse(raw);
  const passphrase = input.passphrase ? openSecret(input.passphrase as SealedSecret) : undefined;
  return inspectArtifact(getAppDb(), input.artifactId, { passphrase, signal });
}

export async function searchTask(raw: unknown, signal?: AbortSignal) {
  const input = backupSearchInput.parse(raw);
  const passphrase = input.passphrase ? openSecret(input.passphrase as SealedSecret) : undefined;
  return searchArtifact(getAppDb(), input.artifactId, input.query as Parameters<typeof searchArtifact>[2], {
    passphrase,
    signal,
  });
}

export async function compareTask(raw: unknown, signal?: AbortSignal) {
  const input = backupCompareInput.parse(raw);
  const passphrase = input.passphrase ? openSecret(input.passphrase as SealedSecret) : undefined;
  return compareArtifact(getAppDb(), input.artifactId, { passphrase, signal });
}

export async function discoverTask(raw: unknown, signal?: AbortSignal): Promise<DiscoveryResult[]> {
  const input = backupDiscoverInput.parse(raw);
  const db = getAppDb();
  const destinations = input.destinationId
    ? [getBackupDestination(db, input.destinationId)].filter((entry) => entry !== null)
    : listBackupDestinations(db).filter((destination) => destination.enabled);

  const results: DiscoveryResult[] = [];
  for (const destination of destinations) {
    signal?.throwIfAborted();
    try {
      results.push(await discoverBackups(db, destination, { signal }));
    } catch (error) {
      if (signal?.aborted) throw error;
      results.push({
        destinationId: destination.id,
        destinationName: destination.name,
        scanned: 0,
        imported: 0,
        alreadyKnown: 0,
        unreadable: 0,
        adopted: 0,
        notes: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return results;
}

export async function runTask(raw: unknown, ctx?: TaskContext) {
  const input = backupRunInput.parse(raw);
  const db = getAppDb();
  const policy = getBackupPolicy(db, input.policyId);
  if (!policy) throw new Error("This backup rule no longer exists.");
  const result = await runBackup(db, policy, {
    trigger: "manual",
    tier: "manual",
    takenBefore: input.takenBefore,
    notes: input.notes,
    budgetArchive: input.archive ? await readParkedArchive(input.archive) : null,
    signal: ctx?.signal,
    onBeforeStore: () => ctx?.enterPhase("mutating"),
  });
  return { stored: result.stored, verified: result.verified, message: result.message ?? null };
}

export async function safetyPointTask(raw: unknown, ctx?: TaskContext) {
  const input = backupSafetyPointInput.parse(raw);
  return takeSafetyRecoveryPoint(getAppDb(), {
    reason: input.reason,
    connectionFingerprint: input.connectionFingerprint,
    force: input.force,
    budgetArchive: input.archive ? await readParkedArchive(input.archive) : null,
    signal: ctx?.signal,
  });
}

/** Registered by the worker's task host. */
export const backupTaskHandlers: Record<string, (input: unknown, ctx: TaskContext) => Promise<unknown>> = {
  "backup.scrub": (input, ctx) => scrubTask(input, ctx.signal),
  "backup.inspect": (input, ctx) => inspectTask(input, ctx.signal),
  "backup.discover": (input, ctx) => discoverTask(input, ctx.signal),
  "backup.search": (input, ctx) => searchTask(input, ctx.signal),
  "backup.compare": (input, ctx) => compareTask(input, ctx.signal),
  "backup.run": (input, ctx) => runTask(input, ctx),
  "backup.safetyPoint": (input, ctx) => safetyPointTask(input, ctx),
};
