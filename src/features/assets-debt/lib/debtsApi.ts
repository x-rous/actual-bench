import type { AttentionItem } from "@/lib/assets-debt/services/attentionService";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail, DebtSaveInput, DebtSummary, ValidationIssue } from "@/lib/assets-debt/services/debtConfigService";
import type { AssumptionInput } from "@/lib/app-db/debtAssumptionRepository";
import type { DebtProjection, DebtProjectionOverrides } from "@/lib/financial-models/loan/projection";
import type { Eligibility } from "@/lib/financial-models/loan/eligibility";
import type { MatchingHistorySnapshot } from "@/lib/assets-debt/actual/ledgerPort";
import type { MatchRuleSave, MatchRuleView } from "@/lib/assets-debt/services/matchingService";
import type { DebtBacktestResult } from "@/lib/financial-models/matching";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { DebtObservationRecord } from "@/lib/app-db/debtObservationRepository";
import type { DebtAnchorRecord } from "@/lib/app-db/debtAnchorRepository";
import type { DriftComparison, DriftState } from "@/lib/assets-debt/classification/drift";

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

/** Archives an active debt; discards a draft. */
/** Delete an archived loan permanently, with everything Bench stored for it; Actual is not touched. */
export const deleteDebtPermanently = (id: string) => request<undefined>(`/api/assets-debt/debts/${encodeURIComponent(id)}?permanent=yes`, { method: "DELETE" });

/** Remove a lender statement with its corrections and any restart made from it. */
export const removeDebtObservation = (id: string, observationId: string) =>
  request<{ removed: { statements: number; restarts: number } }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/observations/${encodeURIComponent(observationId)}`, { method: "DELETE" }).then((r) => r.removed);

export const archiveDebt = (id: string) => request<{ debt?: DebtDetail } | undefined>(`/api/assets-debt/debts/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getEligibility = (id: string) => request<{ eligibility: Eligibility }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/eligibility`).then((r) => r.eligibility);

export const getSchedule = (id: string, body: { from: string; to: string; overrides?: DebtProjectionOverrides; resolution?: "events" | "monthly" | "yearly"; offsetHistories?: OffsetHistorySnapshot[] }) =>
  request<{ projection: DebtProjection }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/schedule`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.projection);

export const saveAssumptions = (id: string, assumptions: AssumptionInput[], changeSummary: string) =>
  request<{ debt: DebtDetail }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/assumptions`, { method: "PUT", body: JSON.stringify({ assumptions, changeSummary }) }).then((r) => r.debt);

export const listMatchRules = (id: string) =>
  request<{ rules: MatchRuleView[] }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/match-rules`).then((r) => r.rules);

/** A fresh read-only backtest; the server requires one to enable a rule and refuses weak or ambiguous rules. */
export type EnableBacktest = { from: string; to: string; snapshots: MatchingHistorySnapshot[] };

export const createMatchRule = (id: string, rule: MatchRuleSave, enableBacktest?: EnableBacktest) =>
  request<{ rule: MatchRuleView }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/match-rules`, { method: "POST", body: JSON.stringify({ rule, ...(enableBacktest ? { enableBacktest } : {}) }) }).then((r) => r.rule);

export const updateMatchRule = (id: string, ruleId: string, rule: MatchRuleSave, enableBacktest?: EnableBacktest) =>
  request<{ rule: MatchRuleView }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/match-rules`, { method: "PATCH", body: JSON.stringify({ ruleId, rule, ...(enableBacktest ? { enableBacktest } : {}) }) }).then((r) => r.rule);

export const deleteMatchRule = (id: string, ruleId: string) =>
  request<void>(`/api/assets-debt/debts/${encodeURIComponent(id)}/match-rules?ruleId=${encodeURIComponent(ruleId)}`, { method: "DELETE" });

export const runMatchBacktest = (id: string, body: { ruleId: string; from: string; to: string; snapshots: MatchingHistorySnapshot[] }) =>
  request<{ backtest: DebtBacktestResult }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/backtest`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.backtest);

/** The matching editor's live check of an unsaved rule; nothing is stored. */
export const checkDraftMatchRule = (id: string, body: { rule: { purpose: string; conditions: unknown; actions: unknown }; from: string; to: string; snapshots: MatchingHistorySnapshot[] }) =>
  request<{ backtest: DebtBacktestResult }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/backtest`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.backtest);

export const listDebtObservations = (id: string) => request<{ observations: DebtObservationRecord[]; history: DebtObservationRecord[] }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/observations`);
export const recordDebtObservation = (id: string, body: { observedOn: string; recordedAt: string; principalMinor: number; accruedInterestMinor: number | null; supersedesObservationId?: string | null; note: string | null }) =>
  request<{ observation: DebtObservationRecord }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/observations`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.observation);
export const listDebtAnchors = (id: string) => request<{ effective: DebtAnchorRecord | null; anchors: DebtAnchorRecord[] }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/anchors`);
export const createDebtAnchor = (id: string, observationId: string) => request<{ anchor: DebtAnchorRecord }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/anchors`, { method: "POST", body: JSON.stringify({ observationId, carriedRemainderDecimal: null }) }).then((r) => r.anchor);
export type DebtReconciliationView = {
  comparison: DriftComparison; drift: DriftState; health: { overdue: boolean; dueDate: string | null }; lenderObservation: DebtObservationRecord | null; projectedBalanceVariance: null;
  /** The calculation on schedule (repayments on their due dates), next to the "as paid" figure in `comparison` (T309). */
  scheduledMinor?: number;
  /** When the calculation follows the repayments as paid: the date of the latest applied repayment it starts from. */
  asPaidFrom?: string | null;
};
export const getDebtReconciliation = (id: string, body: { comparisonDate: string; actualBalanceMinor: number; offsetHistories?: OffsetHistorySnapshot[] }) =>
  request<{ reconciliation: DebtReconciliationView }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/reconciliation`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.reconciliation);
export const acceptDebtDrift = (id: string, body: { comparisonDate: string; actualBalanceMinor: number; offsetHistories?: OffsetHistorySnapshot[] }) => request<{ debt: DebtDetail }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/reconciliation`, { method: "PATCH", body: JSON.stringify({ accept: true, ...body }) }).then((r) => r.debt);
export const runConventionDiagnostic = (id: string, observationId: string) => request<{ candidates: Array<{ variant: { dayCount: string; timing: string; interestPostingRounding: string }; isCurrent: boolean; ok: boolean; principalMinor: number | null; differenceMinor: number | null }> }>(`/api/assets-debt/debts/${encodeURIComponent(id)}/diagnostics/conventions`, { method: "POST", body: JSON.stringify({ observationId }) }).then((r) => r.candidates);
