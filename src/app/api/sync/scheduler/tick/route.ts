import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getSchedulerState, runSchedulerTick } from "@/lib/sync/serverScheduler";
import { vaultEnabled } from "@/lib/sync/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual/external trigger for the unattended scheduler (RD-058 / PR-024c).
 * POST runs one pass; GET returns scheduler status. POST is guarded by a shared
 * secret so an external cron can drive it without exposing an open trigger.
 */

// GET → scheduler status snapshot (non-secret metadata) for the health view.
export function GET() {
  try {
    return NextResponse.json(getSchedulerState(getAppDb()));
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// POST → run one scheduler pass. Requires SYNC_SCHEDULER_SECRET + matching header.
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.SYNC_SCHEDULER_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "The scheduler trigger endpoint is disabled. Set SYNC_SCHEDULER_SECRET to enable it." },
        { status: 403 }
      );
    }
    const provided = Buffer.from(request.headers.get("x-scheduler-secret") ?? "");
    const expected = Buffer.from(secret);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (!vaultEnabled()) {
      return NextResponse.json({ error: "Credential vault is disabled (SYNC_VAULT_KEY unset)." }, { status: 400 });
    }
    const summary = await runSchedulerTick(getAppDb());
    return NextResponse.json(summary);
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
