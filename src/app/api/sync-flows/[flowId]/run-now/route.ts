import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { runServerSafeSync } from "@/lib/sync/serverSafeSync";
import { serverResultMessage } from "@/lib/sync/serverScheduler";
import { vaultEnabled } from "@/lib/sync/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ flowId: string }> };

/**
 * Run one unattended (server-side, HTTP-API) safe-sync for a flow immediately,
 * instead of waiting for the scheduler's next tick (RD-058 follow-up "Run now").
 * Same executor the scheduler uses; marker-based dedup makes an overlap with a
 * concurrent tick harmless. Blocked/failed outcomes are returned, not thrown.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    if (!vaultEnabled()) {
      return NextResponse.json(
        { error: "The server vault is disabled (SYNC_VAULT_KEY unset), so unattended sync cannot run." },
        { status: 400 }
      );
    }
    const { flowId } = await context.params;
    const result = await runServerSafeSync(getAppDb(), flowId);
    return NextResponse.json({ result: { status: result.status, message: serverResultMessage(result) ?? null } });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
