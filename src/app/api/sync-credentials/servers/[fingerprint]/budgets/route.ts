import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { runConnectionTask } from "@/lib/actual/connectionTasks";
import { listServerBudgets, type ServerBudget } from "@/lib/actual/serverBudgets";
import { resolveServerConnection } from "@/lib/actual/serverTransport";
import { listSyncCredentialMeta } from "@/lib/credentials/unattendedCredentials";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { vaultEnabled } from "@/lib/sync/vault";
import type { ConnectionMode } from "@/store/connection";

type RouteContext = { params: Promise<{ fingerprint: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Signing in and listing files; nothing is opened, so it is quick. */
const LIST_DEADLINE_MS = 60_000;

/**
 * The budgets on an enrolled connection's server, and which of them are
 * enrolled (PR-071a). `fingerprint` is any enrolled connection on that server:
 * unattended secrets are one per server, so it opens them all. Answers
 * metadata only - never the secret.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    if (!vaultEnabled()) {
      return NextResponse.json({ error: "The credential vault is disabled." }, { status: 400 });
    }
    const { fingerprint } = await context.params;
    const db = getAppDb();
    const enrolledList = listSyncCredentialMeta(db);
    const meta = enrolledList.find((entry) => entry.connectionFingerprint === fingerprint);
    if (!meta) {
      return NextResponse.json({ error: "That connection is not enrolled." }, { status: 404 });
    }

    const result = await runConnectionTask<ServerBudget[]>({
      kind: "server.budgets",
      taskInput: { connectionFingerprint: fingerprint },
      mode: meta.mode,
      deadlineMs: LIST_DEADLINE_MS,
      messages: {
        failed: "Bench could not list the budgets on this server. Try again.",
        timedOut: "The server took too long to answer. Try again.",
      },
      inThread: async () => {
        const connection = resolveServerConnection(db, fingerprint);
        if (!connection) throw new Error("That connection has no stored credentials.");
        return listServerBudgets(connection);
      },
    });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });

    const enrolled = new Set(enrolledList.map((entry) => entry.connectionFingerprint));
    const mode = meta.mode as ConnectionMode;
    return NextResponse.json({
      server: { mode, baseUrl: meta.baseUrl },
      budgets: result.value.map((budget) => {
        const budgetFingerprint = connectionFingerprint({ mode, baseUrl: meta.baseUrl, budgetSyncId: budget.budgetSyncId });
        const isEnrolled = enrolled.has(budgetFingerprint);
        // The same budget enrolled through the other mode (PR-071c): runs can
        // already use it, so it is not offered again as if it were missing.
        const elsewhere = isEnrolled
          ? undefined
          : enrolledList.find((entry) => entry.budgetSyncId === budget.budgetSyncId);
        return {
          ...budget,
          connectionFingerprint: budgetFingerprint,
          enrolled: isEnrolled,
          ...(elsewhere ? { enrolledVia: elsewhere.mode } : {}),
        };
      }),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
