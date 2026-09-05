/**
 * Client for the reconciliation app-DB routes (RD-071 / PR-034a).
 *
 * These endpoints only ever touch the Actual Bench metadata database. Nothing
 * here writes to the budget — that happens through the transport, in the apply
 * executor, and only after an explicit Apply.
 */

import type {
  ReconciliationItemRecord,
  ReconciliationProfileRecord,
  ReconciliationSessionRecord,
  ReconciliationSessionStatus,
  ReconciliationStatementFormat,
  ReconciliationStatementRowRecord,
} from "@/lib/app-db/reconciliationRepository";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listSessions(budgetSyncId: string) {
  return request<{ sessions: ReconciliationSessionRecord[] }>(
    `/api/reconciliation/sessions?budgetSyncId=${encodeURIComponent(budgetSyncId)}`
  );
}

export function getSession(id: string) {
  return request<{
    session: ReconciliationSessionRecord;
    statementRows: ReconciliationStatementRowRecord[];
    items: ReconciliationItemRecord[];
  }>(`/api/reconciliation/sessions/${encodeURIComponent(id)}`);
}

export function createSession(payload: {
  budgetSyncId: string;
  accountId: string;
  accountName?: string | null;
  profileId?: string | null;
  statementName?: string | null;
  tag?: string | null;
}) {
  return request<{ session: ReconciliationSessionRecord }>("/api/reconciliation/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSession(
  id: string,
  payload: Partial<{
    status: ReconciliationSessionStatus;
    statementName: string | null;
    statementStart: string | null;
    statementEnd: string | null;
    candidateStart: string | null;
    candidateEnd: string | null;
    statementFingerprint: string | null;
    statementFormat: ReconciliationStatementFormat | null;
    profileId: string | null;
    matchConfig: unknown;
    totals: unknown;
    applyResults: unknown;
    applyConfig: unknown;
    tag: string | null;
    appliedAt: string | null;
  }>
) {
  return request<{ session: ReconciliationSessionRecord }>(
    `/api/reconciliation/sessions/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) }
  );
}

export function deleteSession(id: string) {
  return request<void>(`/api/reconciliation/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function putStatementRows(sessionId: string, statementRows: unknown[]) {
  return request<{ count: number }>(
    `/api/reconciliation/sessions/${encodeURIComponent(sessionId)}/rows`,
    { method: "PUT", body: JSON.stringify({ statementRows }) }
  );
}

export function putItems(sessionId: string, items: unknown[]) {
  return request<{ count: number }>(
    `/api/reconciliation/sessions/${encodeURIComponent(sessionId)}/items`,
    { method: "PUT", body: JSON.stringify({ items }) }
  );
}

export function patchItem(id: string, payload: unknown) {
  return request<{ item: ReconciliationItemRecord }>(
    `/api/reconciliation/items/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) }
  );
}

export function listProfiles(budgetSyncId: string, accountId?: string) {
  const params = new URLSearchParams({ budgetSyncId });
  if (accountId) params.set("accountId", accountId);
  return request<{ profiles: ReconciliationProfileRecord[] }>(
    `/api/reconciliation/profiles?${params.toString()}`
  );
}

export function saveProfile(payload: {
  budgetSyncId: string;
  accountId: string;
  name: string;
  mapping: unknown;
  matchConfig: unknown;
}) {
  return request<{ profile: ReconciliationProfileRecord }>("/api/reconciliation/profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type {
  ReconciliationItemRecord,
  ReconciliationProfileRecord,
  ReconciliationSessionRecord,
  ReconciliationStatementRowRecord,
};
