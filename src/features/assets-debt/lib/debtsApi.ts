import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail, DebtSaveInput, DebtSummary, ValidationIssue } from "@/lib/assets-debt/services/debtConfigService";
import type { AssumptionInput } from "@/lib/app-db/debtAssumptionRepository";
import type { DebtProjection, DebtProjectionOverrides } from "@/lib/financial-models/loan/projection";
import type { Eligibility } from "@/lib/financial-models/loan/eligibility";

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const blocked = body.blocked as { message?: string } | undefined;
    throw new DebtApiError(String(body.error ?? blocked?.message ?? `Request failed (${response.status})`), response.status, (body.issues as ValidationIssue[]) ?? []);
  }
  return body as T;
}

export const listDebts = (budgetSyncId: string, includeArchived = false) =>
  request<{ debts: DebtSummary[] }>(`/api/assets-debt/debts?budgetSyncId=${encodeURIComponent(budgetSyncId)}${includeArchived ? "&includeArchived=1" : ""}`).then((r) => r.debts);

export const getDebt = (id: string) => request<{ debt: DebtDetail }>(`/api/assets-debt/debts/${encodeURIComponent(id)}`).then((r) => r.debt);

export const createDebt = (debt: DebtSaveInput, accountDirectory: AccountDirectory) =>
  request<{ debt: DebtDetail }>("/api/assets-debt/debts", { method: "POST", body: JSON.stringify({ debt, accountDirectory }) }).then((r) => r.debt);

export const updateDebt = (id: string, debt: DebtSaveInput, accountDirectory: AccountDirectory) =>
  request<{ debt: DebtDetail }>(`/api/assets-debt/debts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ debt, accountDirectory }) }).then((r) => r.debt);

/** Archives an active debt; discards a draft. */
export const archiveDebt = (id: string) => request<{ debt?: DebtDetail } | undefined>(`/api/assets-debt/debts/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getEligibility = (id: string) => request<{ eligibility: Eligibility }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/eligibility`).then((r) => r.eligibility);

export const getSchedule = (id: string, body: { from: string; to: string; overrides?: DebtProjectionOverrides; resolution?: "events" | "monthly" | "yearly" }) =>
  request<{ projection: DebtProjection }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/schedule`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.projection);

export const saveAssumptions = (id: string, assumptions: AssumptionInput[], changeSummary: string) =>
  request<{ debt: DebtDetail }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/assumptions`, { method: "PUT", body: JSON.stringify({ assumptions, changeSummary }) }).then((r) => r.debt);
