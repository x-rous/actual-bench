import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getBackupPolicy, listBackupArtifacts } from "@/lib/app-db/backupRepository";
import { prune } from "@/lib/backup/prune";
import { collectUnusedPassphrases } from "@/lib/backup/passphrases";

type RouteContext = { params: Promise<{ policyId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Apply retention, or preview it.
 *
 * Defaults to a preview. Deleting backups is the one thing here that cannot be
 * undone, so the destructive reading of an ambiguous request is the wrong
 * default — the caller has to ask for it explicitly.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const body = (await readJsonBody(request).catch(() => ({}))) as { apply?: boolean };

    const db = getAppDb();
    const policy = getBackupPolicy(db, policyId);
    if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    const result = await prune(db, {
      artifacts: listBackupArtifacts(db, { policyId, limit: 500 }),
      retention: policy.retention,
      dryRun: body?.apply !== true,
    });

    // A prune can remove the last encrypted copy a stored passphrase existed
    // for, and an orphaned secret should be short-lived rather than permanent.
    if (body?.apply === true) collectUnusedPassphrases(db);

    return NextResponse.json({ result });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
