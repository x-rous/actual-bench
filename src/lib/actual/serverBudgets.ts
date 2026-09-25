import { getServerRequestGate } from "@/lib/http/serverRequestGate";
import type { ConnectionInstance } from "@/store/connection";
import { listNodeServerBudgets } from "./runtime/nodeHost";

/**
 * The budget files on an enrolled connection's server (RD-095 follow-up,
 * PR-071a), so Bench can offer the others for enrolment: unattended secrets
 * are one per server, so once one budget there is enrolled, the rest need no
 * password from the browser.
 *
 * Direct signs in with Actual's own engine in a worker and lists the server's
 * files; HTTP asks actual-http-api's `/v1/budgets/` through the per-server
 * lock. Only remote budgets with a sync ID are kept, one per sync ID - the
 * same rule the Connect page uses.
 *
 * Server-only.
 */

export type ServerBudget = {
  budgetSyncId: string;
  name: string;
  /** End-to-end encrypted: enrolling it needs its encryption password. */
  encrypted: boolean;
};

type RawBudget = { state?: unknown; groupId?: unknown; name?: unknown; encryptKeyId?: unknown };

export function remoteBudgetsFrom(raw: unknown[]): ServerBudget[] {
  const seen = new Set<string>();
  const budgets: ServerBudget[] = [];
  for (const entry of raw as RawBudget[]) {
    if (!entry || entry.state !== "remote" || typeof entry.groupId !== "string" || !entry.groupId) continue;
    if (seen.has(entry.groupId)) continue;
    seen.add(entry.groupId);
    budgets.push({
      budgetSyncId: entry.groupId,
      name: typeof entry.name === "string" && entry.name ? entry.name : entry.groupId,
      encrypted: typeof entry.encryptKeyId === "string" && entry.encryptKeyId.length > 0,
    });
  }
  return budgets.sort((a, b) => a.name.localeCompare(b.name));
}

async function listHttpServerBudgets(connection: ConnectionInstance & { mode: "http-api" }): Promise<unknown[]> {
  const gate = getServerRequestGate();
  if (!gate) throw new Error("The server request lock is not available in this process.");
  const base = connection.baseUrl.replace(/\/+$/, "");
  const result = await gate<{ status: number; data?: unknown[]; error?: string }>(
    { baseUrl: connection.baseUrl, apiKey: connection.apiKey },
    `budgets-${Math.random().toString(36).slice(2, 9)}`,
    async () => {
      let response: Response;
      try {
        response = await fetch(`${base}/v1/budgets/`, {
          headers: { "x-api-key": connection.apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        return { status: 502, error: "network-failure" };
      }
      if (!response.ok) return { status: response.status, error: `HTTP ${response.status}` };
      const payload = (await response.json()) as { data?: unknown[] } | unknown[];
      return { status: 200, data: Array.isArray(payload) ? payload : (payload.data ?? []) };
    }
  );
  if (!result.data) {
    throw Object.assign(new Error(result.error ?? `HTTP ${result.status}`), {
      status: result.status,
      ...(result.status === 401 || result.status === 403 ? { code: "invalid-password" } : {}),
      ...(result.error === "network-failure" ? { code: "network-failure" } : {}),
    });
  }
  return result.data;
}

export async function listServerBudgets(connection: ConnectionInstance): Promise<ServerBudget[]> {
  const raw =
    connection.mode === "http-api" ? await listHttpServerBudgets(connection) : await listNodeServerBudgets(connection);
  return remoteBudgetsFrom(raw);
}
