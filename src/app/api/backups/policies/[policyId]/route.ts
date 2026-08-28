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
import { upsertBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import { collectUnusedPassphrases } from "@/lib/backup/passphrases";
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

    // Turning encryption on without giving Bench a passphrase would save a rule
    // that fails every night with "no stored passphrase". Caught here as well
    // as in the dialog, because the rule is what the runs read.
    if (payload.encryption === "passphrase" && !passphrase) {
      const existing = getBackupPolicy(db, policyId);
      if (!existing?.encryptionCredentialRef) {
        return NextResponse.json(
          { error: "Enter the passphrase Bench should use to encrypt these backups." },
          { status: 400 }
        );
      }
    }

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
 * are backups, they are still restorable, and a stored copy nobody has a record
 * of is the worst of both worlds. They stay in the inventory, unowned, and
 * retention will not touch them because they no longer belong to a rule.
 *
 * Its **passphrase is kept** for as long as an encrypted copy still needs it.
 * Deleting the secret with the rule would quietly make every encrypted backup
 * it took unopenable — permanent data loss caused by tidying a setting. Bench
 * lists what it is still holding, and collects it automatically once the last
 * copy that needs it is gone.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const db = getAppDb();
    if (!getBackupPolicy(db, policyId)) {
      return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });
    }

    const artifacts = listBackupArtifacts(db, { policyId, limit: 500 });
    const encryptedArtifacts = artifacts.filter((artifact) => artifact.encrypted).length;

    deleteBackupPolicy(db, policyId);
    reconcileBackupAutomations(db, listBackupPolicies(db));
    // Nothing encrypted left behind means nothing needs the passphrase.
    const forgottenPassphrases = collectUnusedPassphrases(db);

    return NextResponse.json({
      deleted: true,
      keptArtifacts: artifacts.length,
      encryptedArtifacts,
      keptPassphrase: encryptedArtifacts > 0 && !forgottenPassphrases.includes(policyId),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
