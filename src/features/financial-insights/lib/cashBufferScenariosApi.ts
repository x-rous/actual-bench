import type { BufferAdjustments, ScenarioResult } from "@/lib/financial-insights/bufferScenario";
import type { CashBufferScenarioRecord } from "@/lib/app-db/types";

/** Saves Bench metadata against permanent Actual ids; no Actual requests are made here. */
export async function saveCashBufferScenario(input: { budgetSyncId: string; id?: string; name: string; adjustments: BufferAdjustments; result: ScenarioResult | null }): Promise<CashBufferScenarioRecord[]> {
  const response = await fetch("/api/cash-buffer-scenarios", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error((await errorMessage(response)) ?? "Could not save the scenario");
  return ((await response.json()) as { scenarios: CashBufferScenarioRecord[] }).scenarios;
}

export async function deleteCashBufferScenario(budgetSyncId: string, id: string): Promise<CashBufferScenarioRecord[]> {
  const response = await fetch(`/api/cash-buffer-scenarios?budgetSyncId=${encodeURIComponent(budgetSyncId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error((await errorMessage(response)) ?? "Could not delete the scenario");
  return ((await response.json()) as { scenarios: CashBufferScenarioRecord[] }).scenarios;
}

async function errorMessage(response: Response): Promise<string | null> {
  try { return ((await response.json()) as { error?: string }).error ?? null; } catch { return null; }
}
