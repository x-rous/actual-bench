import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteBackupPolicy,
  getBackupPolicy,
  listBackupArtifacts,
  listBackupPolicies,
  updateBackupPolicy,
} from "@/lib/app-db/backupRepository";
import { deleteBackupCredential, upsertBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import { reconcileBackupAutomations } from "@/lib/automation/jobs/backupReconcile";

type RouteContext = { params: Promise<{ policyId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Backup rule payload must be an object" }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const passphrase = typeof payload.passphrase === "string" ? payload.passphrase : null;
    delete payload.passphrase;

    const db = getAppDb();
    if (passphrase) {
      upsertBackupCredential(db, { ref: policyId, kind: "passphrase", secret: { passphrase } });
      payload.encryptionCredentialRef = policyId;
    }

    const policy = updateBackupPolicy(db, policyId, payload);
    if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    reconcileBackupAutomations(db, listBackupPolicies(db));
    return NextResponse.json({ policy });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Deleting a rule stops it running. It never deletes the copies it took: those
 * are backups, they are still restorable, and the reason to keep the artifact
 * rows is that a stored copy nobody has a record of is the worst of both worlds.
 * They stay in the inventory, unowned, and retention will not touch them
 * because they no longer belong to a rule with rules.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const db = getAppDb();
    if (!getBackupPolicy(db, policyId)) {
      return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });
    }

    const keptArtifacts = listBackupArtifacts(db, { policyId, limit: 500 }).length;
    deleteBackupPolicy(db, policyId);
    deleteBackupCredential(db, policyId);
    reconcileBackupAutomations(db, listBackupPolicies(db));

    return NextResponse.json({ deleted: true, keptArtifacts });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
