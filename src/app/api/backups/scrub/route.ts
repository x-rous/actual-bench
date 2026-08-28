import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { listBackupDestinations } from "@/lib/app-db/backupRepository";
import { scrubAll } from "@/lib/backup/scrub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Verify stored copies on demand — the same work the weekly scrub does. */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request).catch(() => ({}))) as {
      destinationIds?: string[];
      newest?: number;
      deepest?: number;
    };

    const db = getAppDb();
    const ids =
      Array.isArray(body?.destinationIds) && body.destinationIds.length > 0
        ? body.destinationIds
        : listBackupDestinations(db)
            .filter((destination) => destination.enabled)
            .map((destination) => destination.id);

    const results = await scrubAll(db, ids, {
      newest: typeof body?.newest === "number" ? body.newest : 3,
      deepest: typeof body?.deepest === "number" ? body.deepest : 1,
    });

    return NextResponse.json({ results });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
