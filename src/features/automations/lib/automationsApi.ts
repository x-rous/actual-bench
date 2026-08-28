import type { AutomationDefinition, AutomationRun } from "@/lib/app-db/types";

/** Client for the automation routes (RD-079 / PR-043d). */

export type AutomationListItem = AutomationDefinition & {
  scheduleLabel: string;
  running: boolean;
  lastRun: AutomationRun | null;
  /** Human name of the job type — "Budget File Sync", "Bank sync". */
  typeLabel: string;
  status: "ok" | "warning" | "failing" | "paused" | "idle";
  /** One sentence a person can act on, from the health module. */
  statusSummary: string;
};

export type AutomationJobTypeSummary = {
  type: string;
  label: string;
  supportsReview: boolean;
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

export async function listAutomations(): Promise<{
  automations: AutomationListItem[];
  jobTypes: AutomationJobTypeSummary[];
}> {
  const response = await fetch("/api/automations", { cache: "no-store" });
  if (!response.ok) return readError(response);
  return (await response.json()) as { automations: AutomationListItem[]; jobTypes: AutomationJobTypeSummary[] };
}

export type RunHistoryEntry = AutomationRun & {
  automationName: string;
  typeLabel: string;
};

export type RunHistoryFilters = {
  automationId?: string;
  type?: string;
  statuses?: string[];
  limit?: number;
};

export type RunHistory = {
  runs: RunHistoryEntry[];
  automations: { id: string; name: string; type: string }[];
  jobTypes: { type: string; label: string }[];
};

/** Every run across every automation, filtered - "what failed last night?" */
export async function fetchRunHistory(filters: RunHistoryFilters = {}): Promise<RunHistory> {
  const params = new URLSearchParams();
  if (filters.automationId) params.set("automation", filters.automationId);
  if (filters.type) params.set("type", filters.type);
  for (const status of filters.statuses ?? []) params.append("status", status);
  if (filters.limit) params.set("limit", String(filters.limit));

  const response = await fetch(`/api/automations/runs?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) return readError(response);
  return (await response.json()) as RunHistory;
}

export async function listAutomationRuns(automationId: string, limit = 25): Promise<AutomationRun[]> {
  const response = await fetch(`/api/automations/${automationId}/runs?limit=${limit}`, { cache: "no-store" });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { runs: AutomationRun[] }).runs;
}

export type RunOutcome = {
  automationId: string;
  runId: string | null;
  status: "succeeded" | "partial" | "failed" | "cancelled" | "no_changes" | "running" | "skipped";
  message?: string;
};

/**
 * A run that *happened* answers 200 whatever it concluded — failing is a
 * result, not a transport error — so the outcome is returned rather than
 * discarded. Reporting "Run finished" over a failed run is worse than saying
 * nothing.
 */
export async function runAutomationNow(automationId: string): Promise<RunOutcome> {
  const response = await fetch(`/api/automations/${automationId}/run`, { method: "POST" });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { outcome: RunOutcome }).outcome;
}

export async function patchAutomation(
  automationId: string,
  patch: Record<string, unknown>
): Promise<AutomationDefinition> {
  const response = await fetch(`/api/automations/${automationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { automation: AutomationDefinition }).automation;
}

export async function deleteAutomation(automationId: string): Promise<void> {
  const response = await fetch(`/api/automations/${automationId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) return readError(response);
}

export type ReviewQueueEntry = {
  automationId: string;
  automationName: string;
  type: string;
  typeLabel: string;
  subjects: string[];
  pendingCount: number;
  lastRunAt: string | null;
  href: string;
  summary: string;
};

export async function listReviewQueue(): Promise<ReviewQueueEntry[]> {
  const response = await fetch("/api/automations/review-queue", { cache: "no-store" });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { entries: ReviewQueueEntry[] }).entries;
}

export type VaultConnection = {
  connectionFingerprint: string;
  label: string;
  baseUrl: string;
  budgetSyncId: string;
};

/**
 * Connections with credentials stored for unattended use.
 *
 * The set an automation can actually be built on: a connection without an
 * enrolled credential produces an automation that can only fail closed.
 */
export async function listVaultConnections(): Promise<{
  enabled: boolean;
  credentials: VaultConnection[];
}> {
  const response = await fetch("/api/sync-credentials", { cache: "no-store" });
  if (!response.ok) return readError(response);
  return (await response.json()) as { enabled: boolean; credentials: VaultConnection[] };
}

export type EnrolledConnection = {
  connectionFingerprint: string;
  label: string;
  baseUrl: string;
  budgetSyncId: string;
  mode: string;
  enrolledAt: string;
  usedBy: { id: string; name: string; type: string; typeLabel: string; enabled: boolean }[];
};

/** Which budgets Bench may act on unattended, and what depends on each. */
export async function listEnrolledConnections(): Promise<{
  vaultEnabled: boolean;
  connections: EnrolledConnection[];
}> {
  const response = await fetch("/api/automations/connections", { cache: "no-store" });
  if (!response.ok) return readError(response);
  return (await response.json()) as { vaultEnabled: boolean; connections: EnrolledConnection[] };
}

export async function createAutomation(input: Record<string, unknown>): Promise<AutomationDefinition> {
  const response = await fetch("/api/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { automation: AutomationDefinition }).automation;
}

export type BankSyncAccountPreview = {
  id: string;
  name: string;
  linked: boolean;
  syncSource: string | null;
  lastSync: string | null;
};

/**
 * What a scheduled bank sync would actually pull.
 *
 * Server-side, because the vault credential is not the browser's to hold and
 * the budget in question is often not the one currently open.
 */
export async function listBankSyncAccounts(
  connectionFingerprint: string
): Promise<BankSyncAccountPreview[]> {
  const response = await fetch(
    `/api/automations/bank-sync-accounts?connection=${encodeURIComponent(connectionFingerprint)}`,
    { cache: "no-store" }
  );
  if (!response.ok) return readError(response);
  return ((await response.json()) as { accounts: BankSyncAccountPreview[] }).accounts;
}

