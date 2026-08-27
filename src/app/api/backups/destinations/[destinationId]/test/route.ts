import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getBackupDestination, recordDestinationOutcome } from "@/lib/app-db/backupRepository";
import { createDestinationAdapter } from "@/lib/backup/destinations";

type RouteContext = { params: Promise<{ destinationId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Test a destination by using it: write real bytes, read them back, compare
 * checksums, delete. A test that only checks credentials would pass on a
 * read-only volume, which is precisely the configuration people get wrong.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { destinationId } = await context.params;
    const db = getAppDb();
    const destination = getBackupDestination(db, destinationId);
    if (!destination) return NextResponse.json({ error: "Destination not found" }, { status: 404 });

    const at = new Date().toISOString();
    try {
      const result = await createDestinationAdapter(db, destination).test();
      recordDestinationOutcome(db, destinationId, {
        success: result.ok,
        at,
        reason: result.ok ? undefined : result.checks.find((check) => check.status === "fail")?.detail,
      });
      return NextResponse.json({ result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordDestinationOutcome(db, destinationId, { success: false, at, reason: message });
      return NextResponse.json({
        result: { ok: false, checks: [{ name: "Connect", status: "fail", detail: message }], facts: { location: "" } },
      });
    }
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
