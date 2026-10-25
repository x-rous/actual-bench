import type { Registry } from "@/lib/asset-registry/models";
const endpoint = "/api/assets-debt/assets";
/** `__path` selects a sibling route (for example `depreciation`); it is not sent in the body. */
export async function registryRequest(budget: string, method = "GET", payload?: Record<string, unknown>): Promise<Registry> {
  const { __path, ...body } = payload ?? {}; const path = typeof __path === "string" ? __path : "";
  const response = await fetch(method === "GET" ? `${endpoint}?budgetSyncId=${encodeURIComponent(budget)}` : path ? `${endpoint}/${path}` : endpoint, {
    method, headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify({ budgetSyncId: budget, ...body }) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Asset metadata request failed");
  return result as Registry;
}
