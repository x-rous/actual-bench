import type { PlanDocument, PlanRecord, UnreadablePlan } from "@/lib/cashflow-planning/types";

/** Cashflow plans are saved in the Bench app database, against permanent Actual ids; no Actual request is made here. */

/** The plan was saved from somewhere else since it was opened here. */
export class PlanConflictError extends Error {}

async function message(response: Response, fallback: string): Promise<string> {
  try { return ((await response.json()) as { error?: string }).error ?? fallback; } catch { return fallback; }
}

export async function listPlans(budgetSyncId: string): Promise<{ plans: PlanRecord[]; unreadable: UnreadablePlan[] }> {
  const response = await fetch(`/api/cashflow-plans?budgetSyncId=${encodeURIComponent(budgetSyncId)}`);
  if (!response.ok) throw new Error(await message(response, "Could not load the plans"));
  const body = (await response.json()) as { plans: PlanRecord[]; unreadable?: UnreadablePlan[] };
  return { plans: body.plans, unreadable: body.unreadable ?? [] };
}

/** Browsers refuse a keepalive request whose body is over 64 KiB, so a larger save goes as an ordinary request. */
const KEEPALIVE_MAX_BYTES = 60_000;

export async function savePlan(input: { budgetSyncId: string; id?: string; baseRevision?: number; force?: boolean; document: PlanDocument }, options?: { keepalive?: boolean }): Promise<PlanRecord> {
  const body = JSON.stringify(input);
  const keepalive = options?.keepalive === true && new TextEncoder().encode(body).length < KEEPALIVE_MAX_BYTES;
  const response = await fetch("/api/cashflow-plans", { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive });
  if (response.status === 409) throw new PlanConflictError(await message(response, "This plan was changed somewhere else"));
  if (!response.ok) throw new Error(await message(response, "Could not save the plan"));
  return ((await response.json()) as { plan: PlanRecord }).plan;
}

export async function deletePlan(budgetSyncId: string, id: string): Promise<void> {
  const response = await fetch(`/api/cashflow-plans?budgetSyncId=${encodeURIComponent(budgetSyncId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await message(response, "Could not delete the plan"));
}
