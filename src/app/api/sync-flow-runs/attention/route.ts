import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { listSyncFlowAttention } from "@/lib/app-db/syncRunRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** What each flow's latest run left for a person to deal with. */
export function GET() {
  try {
    return NextResponse.json({ entries: listSyncFlowAttention(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
