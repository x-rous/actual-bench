import { NextResponse } from "next/server";
import { isRecord } from "@/lib/app-db/jsonEnvelope";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteBackupPolicy,
  getBackupPolicy,
  listBackupArtifacts,
  listBackupPolicies,
  updateBackupPolicy,
} from "@/lib/app-db/backupRepository";
import {
  getBackupCredential,
  hasBackupCredential,
  upsertBackupCredential,
} from "@/lib/credentials/backupSecrets";
import { requireReadyVault } from "@/lib/credentials/vaultState";
import { generateId } from "@/lib/uuid";
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

    // Nothing is stored for a rule that does not exist: its id names where the
    // passphrase goes, and it comes from the URL.
    const existingPolicy = getBackupPolicy(db, policyId);
    if (!existingPolicy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    // Turning encryption on without giving Bench a passphrase would save a rule
    // that fails every night with "no stored passphrase". Caught here as well
    // as in the dialog, because the rule is what the runs read.
    if (payload.encryption === "passphrase" && !passphrase) {
      if (!existingPolicy.encryptionCredentialRef) {
        return NextResponse.json(
          { error: "Enter the passphrase Bench should use to encrypt these backups." },
          { status: 400 }
        );
      }
    }

    /*
     * A rule's source is fixed once it has taken copies.
     *
     * Retention and the plausibility check both treat a rule's copies as one
     * series. Pointing the rule at another budget mixed two budgets in it: the
     * new budget's copies took the old one's daily, weekly and monthly slots
     * and its history was pruned away. Backing up a different budget is a new
     * rule.
     */
    if (payload.sourceRef !== undefined && existingPolicy.contents !== "app-db") {
      const before = existingPolicy.sourceRef.data.connectionFingerprint ?? null;
      const after = isRecord(payload.sourceRef) && isRecord(payload.sourceRef.data)
        ? (payload.sourceRef.data.connectionFingerprint ?? null)
        : null;
      if (before !== after && listBackupArtifacts(db, { policyId, kind: "budget", limit: 1 }).length > 0) {
        return NextResponse.json(
          {
            error:
              "This rule already has backups of its budget, so its source cannot change. Create a new rule to back up a different budget.",
          },
          { status: 409 }
        );
      }
    }

    if (passphrase) {
      if (passphrase.length < 8) {
        return NextResponse.json({ error: "Use a passphrase of at least 8 characters." }, { status: 400 });
      }
      requireReadyVault(db);

      const currentRef = existingPolicy.encryptionCredentialRef;
      const current = currentRef ? getBackupCredential(db, currentRef) : null;
      const unchanged = current !== null && "passphrase" in current && current.passphrase === passphrase;

      if (!unchanged) {
        /*
         * A new passphrase gets a new ref; the old one is left exactly where
         * it is.
         *
         * Every encrypted copy records the ref that opens it. Overwriting the
         * secret under the same ref made all of those copies resolve to the
         * new passphrase, which cannot open them: Bench lost the old one, the
         * weekly check marked them damaged, and anyone who had not written
         * the old passphrase down lost those backups. The old ref is
         * collected on its own once no copy needs it.
         */
        const ref =
          currentRef || hasBackupCredential(db, policyId) ? `${policyId}.${generateId()}` : policyId;
        upsertBackupCredential(db, {
          ref,
          kind: "passphrase",
          label: existingPolicy.name,
          secret: { passphrase },
        });
        payload.encryptionCredentialRef = ref;
      }
    }

    const policy = updateBackupPolicy(db, policyId, payload);
    if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    reconcileBackupAutomations(db, listBackupPolicies(db));
    // The ref a changed passphrase replaced goes once nothing needs it.
    collectUnusedPassphrases(db);
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
    const existing = getBackupPolicy(db, policyId);
    if (!existing) {
      return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });
    }

    const artifacts = listBackupArtifacts(db, { policyId, limit: "all" });
    const encryptedArtifacts = artifacts.filter((artifact) => artifact.encrypted).length;

    deleteBackupPolicy(db, policyId);
    reconcileBackupAutomations(db, listBackupPolicies(db));
    // Nothing encrypted left behind means nothing needs the passphrase.
    const forgottenPassphrases = collectUnusedPassphrases(db);

    return NextResponse.json({
      deleted: true,
      keptArtifacts: artifacts.length,
      encryptedArtifacts,
      keptPassphrase:
        encryptedArtifacts > 0 && !forgottenPassphrases.includes(existing.encryptionCredentialRef ?? policyId),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
