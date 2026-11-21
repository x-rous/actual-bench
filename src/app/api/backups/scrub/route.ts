import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { listBackupDestinations } from "@/lib/app-db/backupRepository";
import { scrubAll, type ScrubResult } from "@/lib/backup/scrub";
import { runBackupTask } from "@/lib/backup/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Verify stored copies on demand — the same work the weekly scrub does, in a
 * worker: opening and checking a large budget is synchronous, and run here it
 * held up every other request until it finished.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request).catch(() => ({}))) as {
      destinationIds?: unknown;
      newest?: unknown;
      deepest?: unknown;
    };
    const destinationIds = Array.isArray(body?.destinationIds)
      ? body.destinationIds.filter((id): id is string => typeof id === "string")
      : [];
    // The same bounds the worker task enforces, so neither path is handed a
    // count the other would refuse.
    const count = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? Math.min(1000, Math.max(0, Math.round(value))) : fallback;
    const newest = count(body?.newest, 3);
    const deepest = count(body?.deepest, 1);

    const outcome = await runBackupTask<ScrubResult[]>({
      kind: "backup.scrub",
      taskInput: { destinationIds, newest, deepest },
      deadlineMs: 290_000,
      inThread: (signal) => {
        const db = getAppDb();
        const ids =
          destinationIds.length > 0
            ? destinationIds
            : listBackupDestinations(db)
                .filter((destination) => destination.enabled)
                .map((destination) => destination.id);
        return scrubAll(db, ids, { newest, deepest, signal });
      },
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
    return NextResponse.json({ results: outcome.value });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
