import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  createBackupPolicy,
  listBackupPolicies,
  updateBackupPolicy,
} from "@/lib/app-db/backupRepository";
import { upsertBackupCredential } from "@/lib/credentials/backupSecrets";
import { reconcileBackupAutomations } from "@/lib/automation/jobs/backupReconcile";
import { requireReadyVault } from "@/lib/credentials/vaultState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ policies: listBackupPolicies(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Backup rule payload must be an object" }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const passphrase = typeof payload.passphrase === "string" ? payload.passphrase : null;
    delete payload.passphrase;

    if (payload.encryption === "passphrase" && !passphrase) {
      return NextResponse.json(
        { error: "A passphrase is required to encrypt backups." },
        { status: 400 }
      );
    }
    const db = getAppDb();
    // Bench will not store a passphrase it cannot encrypt.
    if (passphrase) requireReadyVault(db);
    const policy = createBackupPolicy(db, payload);

    if (passphrase) {
      upsertBackupCredential(db, {
        ref: policy.id,
        kind: "passphrase",
        label: policy.name,
        secret: { passphrase },
      });
      updateBackupPolicy(db, policy.id, { encryptionCredentialRef: policy.id });
    }

    // Give it its automation now rather than waiting for the next tick, so the
    // schedule the user just chose is visible on the Automations page
    // immediately instead of appearing a minute later.
    reconcileBackupAutomations(db, listBackupPolicies(db));

    return NextResponse.json({ policy: { ...policy, encryptionCredentialRef: passphrase ? policy.id : null } }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
