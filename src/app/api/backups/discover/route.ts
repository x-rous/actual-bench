import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getBackupDestination, listBackupDestinations } from "@/lib/app-db/backupRepository";
import type { DiscoveryResult } from "@/lib/backup/discover";
import { runBackupTask } from "@/lib/backup/tasks";
import { discoverTask } from "@/lib/backup/workerTasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Rebuild the inventory from the manifests in a destination.
 *
 * For the case this whole design anticipates: the server died, the volume was
 * recreated, Bench was restored onto a fresh machine — and the bucket is still
 * full of backups. Discovery adds; it never overwrites what Bench already knows
 * and never deletes. Run in a worker: a big bucket is a long walk.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request).catch(() => ({}))) as { destinationId?: string };
    const destinationId = typeof body?.destinationId === "string" ? body.destinationId : null;
    const db = getAppDb();

    const any = destinationId
      ? getBackupDestination(db, destinationId) !== null
      : listBackupDestinations(db).some((destination) => destination.enabled);
    if (!any) {
      return NextResponse.json({ error: "There is no destination to scan." }, { status: 404 });
    }

    const outcome = await runBackupTask<DiscoveryResult[]>({
      kind: "backup.discover",
      taskInput: { destinationId },
      deadlineMs: 290_000,
      inThread: (signal) => discoverTask({ destinationId }, signal),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
    return NextResponse.json({ results: outcome.value });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
