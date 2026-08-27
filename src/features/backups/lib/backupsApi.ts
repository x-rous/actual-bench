import type {
  BackupArtifact,
  BackupArtifactLocation,
  BackupDestination,
  BackupPolicy,
} from "@/lib/app-db/backupRepository";
import type { DestinationCheck, DestinationFacts } from "@/lib/backup/destinations/types";
import type { BackupReadiness } from "@/lib/backup/readiness";
import type { BackupRunResult } from "@/lib/backup/runBackup";
import type { PruneResult } from "@/lib/backup/prune";
import type { ScrubResult } from "@/lib/backup/scrub";
import type { DiscoveryResult } from "@/lib/backup/discover";
import type { InspectionResult } from "@/lib/backup/inspect";

/** Client for the backup routes (RD-077 / PR-047e). */

export type ArtifactWithLocations = BackupArtifact & {
  locations: (BackupArtifactLocation & { destinationName: string | null })[];
};

/** The automation carrying out a rule's schedule, when there is one. */
export type RuleAutomationState = {
  id: string;
  enabled: boolean;
  running: boolean;
  autoPausedAt: string | null;
  autoPauseReason: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: "ok" | "warning" | "failing" | "paused" | "idle";
  statusSummary: string;
  lastRunMessage: string | null;
};

export type PolicyWithAutomation = BackupPolicy & { automation: RuleAutomationState | null };

/** A sealed passphrase Bench still holds, and what depends on it. */
export type HeldPassphrase = {
  ref: string;
  label: string;
  createdAt: string;
  ruleExists: boolean;
  artifactCount: number;
  newestArtifactAt: string | null;
};

export type BackupSource = {
  connectionFingerprint: string;
  label: string;
  baseUrl: string;
  budgetSyncId: string;
};

export type RecoveryCenterData = {
  readiness: BackupReadiness;
  destinations: BackupDestination[];
  policies: PolicyWithAutomation[];
  artifacts: ArtifactWithLocations[];
  sources: BackupSource[];
  heldPassphrases: HeldPassphrase[];
  vaultEnabled: boolean;
};

async function readError(response: Response): Promise<never> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // Keep the status-code message.
  }
  throw new Error(message);
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) return readError(response);
  return (await response.json()) as T;
}

export async function fetchRecoveryCenter(): Promise<RecoveryCenterData> {
  return json<RecoveryCenterData>(await fetch("/api/backups", { cache: "no-store" }));
}

// ── destinations ─────────────────────────────────────────────────────────────

export type DestinationTestResponse = {
  result: { ok: boolean; checks: DestinationCheck[]; facts: DestinationFacts };
};

export async function inspectPath(path: string): Promise<{ checks: DestinationCheck[]; facts: DestinationFacts }> {
  return json(
    await fetch("/api/backups/destinations/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
  );
}

export async function createDestination(input: Record<string, unknown>): Promise<BackupDestination> {
  const body = await json<{ destination: BackupDestination }>(
    await fetch("/api/backups/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
  return body.destination;
}

export async function patchDestination(
  id: string,
  input: Record<string, unknown>
): Promise<BackupDestination> {
  const body = await json<{ destination: BackupDestination }>(
    await fetch(`/api/backups/destinations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
  return body.destination;
}

export async function deleteDestination(id: string): Promise<{ orphanedCopies: number }> {
  return json(await fetch(`/api/backups/destinations/${id}`, { method: "DELETE" }));
}

export async function testDestination(id: string): Promise<DestinationTestResponse["result"]> {
  const body = await json<DestinationTestResponse>(
    await fetch(`/api/backups/destinations/${id}/test`, { method: "POST" })
  );
  return body.result;
}

// ── rules ────────────────────────────────────────────────────────────────────

export async function createPolicy(input: Record<string, unknown>): Promise<BackupPolicy> {
  const body = await json<{ policy: BackupPolicy }>(
    await fetch("/api/backups/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
  return body.policy;
}

export async function patchPolicy(id: string, input: Record<string, unknown>): Promise<BackupPolicy> {
  const body = await json<{ policy: BackupPolicy }>(
    await fetch(`/api/backups/policies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
  return body.policy;
}

export async function deletePolicy(
  id: string
): Promise<{ keptArtifacts: number; encryptedArtifacts: number; keptPassphrase: boolean }> {
  return json(await fetch(`/api/backups/policies/${id}`, { method: "DELETE" }));
}

export async function forgetPassphrase(
  ref: string,
  strandBackups = false
): Promise<{ forgotten: boolean; strandedBackups: number }> {
  return json(
    await fetch("/api/backups/passphrases", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, strandBackups }),
    })
  );
}

/** Runs are slow and their result is the point, so it is returned in full. */
export async function backUpNow(policyId: string): Promise<BackupRunResult> {
  const body = await json<{ result: BackupRunResult }>(
    await fetch(`/api/backups/policies/${policyId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
  );
  return body.result;
}

export async function previewRetention(policyId: string, apply = false): Promise<PruneResult> {
  const body = await json<{ result: PruneResult }>(
    await fetch(`/api/backups/policies/${policyId}/prune`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply }),
    })
  );
  return body.result;
}

// ── copies ───────────────────────────────────────────────────────────────────

export async function setPinned(artifactId: string, pinned: boolean): Promise<BackupArtifact> {
  const body = await json<{ artifact: BackupArtifact }>(
    await fetch(`/api/backups/artifacts/${artifactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    })
  );
  return body.artifact;
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  const response = await fetch(`/api/backups/artifacts/${artifactId}`, { method: "DELETE" });
  if (!response.ok) await readError(response);
}

export async function inspectBackup(
  artifactId: string,
  passphrase?: string
): Promise<InspectionResult> {
  const body = await json<{ result: InspectionResult }>(
    await fetch(`/api/backups/artifacts/${artifactId}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(passphrase ? { passphrase } : {}),
    })
  );
  return body.result;
}

export function downloadUrl(artifactId: string): string {
  return `/api/backups/artifacts/${artifactId}/download`;
}

export async function scrubNow(destinationIds?: string[]): Promise<ScrubResult[]> {
  const body = await json<{ results: ScrubResult[] }>(
    await fetch("/api/backups/scrub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(destinationIds ? { destinationIds } : {}),
    })
  );
  return body.results;
}

export async function discoverBackups(destinationId?: string): Promise<DiscoveryResult[]> {
  const body = await json<{ results: DiscoveryResult[] }>(
    await fetch("/api/backups/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(destinationId ? { destinationId } : {}),
    })
  );
  return body.results;
}
