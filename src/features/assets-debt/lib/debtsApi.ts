import type { AttentionItem } from "@/lib/assets-debt/services/attentionService";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail, DebtSaveInput, DebtSummary, ValidationIssue } from "@/lib/assets-debt/services/debtConfigService";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { DebtObservationRecord } from "@/lib/app-db/debtObservationRepository";
import type { DebtAnchorRecord } from "@/lib/app-db/debtAnchorRepository";

/**
 * Client for `/api/assets-debt/debts/**` (RD-084 P1.3). Configuration and
 * projection only: none of these calls writes to Actual.
 */

export class DebtApiError extends Error {
  readonly issues: ValidationIssue[];
  readonly status: number;
  constructor(message: string, status: number, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "DebtApiError";
    this.status = status;
    this.issues = issues;
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const blocked = body.blocked as { message?: string } | undefined;
    throw new DebtApiError(String(body.error ?? blocked?.message ?? `Request failed (${response.status})`), response.status, (body.issues as ValidationIssue[]) ?? []);
  }
  return body as T;
}

/** What needs the user across the budget's loans (T293); read-only. */
export const listNeedsAttention = (budgetSyncId: string) =>
  request<{ items: AttentionItem[] }>(`/api/assets-debt/attention?budgetSyncId=${encodeURIComponent(budgetSyncId)}`).then((r) => r.items);

export const listDebts = (budgetSyncId: string, includeArchived = false) =>
  request<{ debts: DebtSummary[] }>(`/api/assets-debt/debts?budgetSyncId=${encodeURIComponent(budgetSyncId)}${includeArchived ? "&includeArchived=1" : ""}`).then((r) => r.debts);

export const getDebt = (id: string) => request<{ debt: DebtDetail }>(`/api/assets-debt/debts/${encodeURIComponent(id)}`).then((r) => r.debt);

export const createDebt = (debt: DebtSaveInput, accountDirectory: AccountDirectory) =>
  request<{ debt: DebtDetail }>("/api/assets-debt/debts", { method: "POST", body: JSON.stringify({ debt, accountDirectory }) }).then((r) => r.debt);

export const updateDebt = (id: string, debt: DebtSaveInput, accountDirectory: AccountDirectory) =>
  request<{ debt: DebtDetail }>(`/api/assets-debt/debts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ debt, accountDirectory }) }).then((r) => r.debt);

/** Delete an archived loan permanently, with everything Bench stored for it; Actual is not touched. */
export const deleteDebtPermanently = (id: string) => request<undefined>(`/api/assets-debt/debts/${encodeURIComponent(id)}?permanent=yes`, { method: "DELETE" });

/** Remove a lender statement with its corrections and any restart made from it. */
export const removeDebtObservation = (id: string, observationId: string) =>
  request<{ removed: { statements: number; restarts: number } }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/observations/${encodeURIComponent(observationId)}`, { method: "DELETE" }).then((r) => r.removed);

export const archiveDebt = (id: string) => request<{ debt?: DebtDetail } | undefined>(`/api/assets-debt/debts/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Lender statements and restarts of the calculation from one. */
export const recordDebtObservation = (id: string, body: { observedOn: string; recordedAt: string; principalMinor: number; accruedInterestMinor: number | null; supersedesObservationId?: string | null; note: string | null }) =>
  request<{ observation: DebtObservationRecord }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/observations`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.observation);
export const listDebtAnchors = (id: string) => request<{ effective: DebtAnchorRecord | null; anchors: DebtAnchorRecord[] }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/anchors`);
export const createDebtAnchor = (id: string, observationId: string) => request<{ anchor: DebtAnchorRecord }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/anchors`, { method: "POST", body: JSON.stringify({ observationId, carriedRemainderDecimal: null }) }).then((r) => r.anchor);
/** Which calculation method matches a lender statement best. */
export const runConventionDiagnostic = (id: string, observationId: string) => request<{ candidates: Array<{ variant: { dayCount: string; timing: string; interestPostingRounding: string }; isCurrent: boolean; ok: boolean; principalMinor: number | null; differenceMinor: number | null }> }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/diagnostics/conventions`, { method: "POST", body: JSON.stringify({ observationId }) }).then((r) => r.candidates);

export const getLoanSummary = (id: string, body: { today: string; offsetHistories?: OffsetHistorySnapshot[] }) => request<{ ok: true; summary: import("@/lib/assets-debt/services/loanSummaryService").LoanSummary }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/summary`, { method: "POST", body: JSON.stringify(body) });
