import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getBackupPolicy } from "@/lib/app-db/backupRepository";
import { runBackup } from "@/lib/backup/runBackup";

type RouteContext = { params: Promise<{ policyId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A large budget takes a while to export, verify and upload to two places.
export const maxDuration = 300;

/**
 * Back up now.
 *
 * A run that happened answers 200 whatever it concluded — a backup that failed
 * is a result, not a transport error, and the caller needs the detail to say
 * which destination refused it.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const body = await readJsonBody(request).catch(() => ({}));
    const options = (body ?? {}) as { takenBefore?: string; notes?: string };

    const db = getAppDb();
    const policy = getBackupPolicy(db, policyId);
    if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    const result = await runBackup(db, policy, {
      trigger: "manual",
      tier: "manual",
      takenBefore: options.takenBefore ?? null,
      notes: options.notes ?? null,
    });

    return NextResponse.json({ result });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
