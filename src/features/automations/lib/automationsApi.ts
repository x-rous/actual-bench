import type { AutomationDefinition, AutomationRun } from "@/lib/app-db/types";

/** Client for the automation routes (RD-079 / PR-043d). */

export type AutomationListItem = AutomationDefinition & {
  scheduleLabel: string;
  running: boolean;
  lastRun: AutomationRun | null;
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

export async function listAutomationRuns(automationId: string, limit = 25): Promise<AutomationRun[]> {
  const response = await fetch(`/api/automations/${automationId}/runs?limit=${limit}`, { cache: "no-store" });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { runs: AutomationRun[] }).runs;
}

export async function runAutomationNow(automationId: string): Promise<void> {
  const response = await fetch(`/api/automations/${automationId}/run`, { method: "POST" });
  if (!response.ok) return readError(response);
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

