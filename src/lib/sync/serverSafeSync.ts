import { getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { getSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import { createHttpApiTransport } from "@/lib/actual/httpApiTransport";
import { decodeFlowPlanConfig } from "./flowConfig";
import { createAppDbApplyStore } from "./appDbApplyStore";
import { createAppDbPreviewStore } from "./appDbPreviewStore";
import { runSafeSync, type SafeSyncResult } from "./safeSyncOrchestrator";
import { vaultEnabled } from "./vault";
import type { ApplyTransportProvider } from "./applyOrchestrator";
import type { PreviewTransportProvider } from "./previewOrchestrator";
import type { SqliteDatabase, SyncCredential } from "@/lib/app-db/types";
import type { HttpApiConnection } from "@/store/connection";

/**
 * Headless server-side safe-sync (RD-058 / PR-024b). Runs the RD-054 safe-only
 * executor for an HTTP-API flow with **no browser open**, driving the same
 * planner/apply engine through a server-side HTTP transport and the app-DB
 * stores. Credentials come from the encrypted vault - never the client.
 *
 * Fail-safe: a disabled/locked vault or an un-enrolled connection returns a
 * typed pre-run status (the scheduler pauses/surfaces it) instead of guessing.
 * HTTP-API only (Hybrid decision); Direct stays on the client interval.
 */

export type ServerSafeSyncBlocked = {
  status: "vault_disabled" | "vault_locked" | "not_enrolled" | "flow_not_found";
  flowId: string;
  message: string;
};

export type ServerSafeSyncResult = ServerSafeSyncBlocked | SafeSyncResult;

/** True for a blocked (pre-run) outcome the scheduler treats as a soft failure. */
export function isServerSafeSyncBlocked(r: ServerSafeSyncResult): r is ServerSafeSyncBlocked {
  return (
    r.status === "vault_disabled" ||
    r.status === "vault_locked" ||
    r.status === "not_enrolled" ||
    r.status === "flow_not_found"
  );
}

function connectionFromCredential(cred: SyncCredential): HttpApiConnection {
  return {
    id: cred.connectionFingerprint,
    label: cred.label || cred.baseUrl,
    mode: "http-api",
    baseUrl: cred.baseUrl,
    apiKey: cred.secret.apiKey,
    budgetSyncId: cred.budgetSyncId,
    ...(cred.secret.encryptionPassword ? { encryptionPassword: cred.secret.encryptionPassword } : {}),
  };
}

export async function runServerSafeSync(
  db: SqliteDatabase,
  flowId: string
): Promise<ServerSafeSyncResult> {
  if (!vaultEnabled()) {
    return { status: "vault_disabled", flowId, message: "Credential vault is disabled (SYNC_VAULT_KEY unset)." };
  }

  const flow = getSyncFlow(db, flowId);
  if (!flow) {
    return { status: "flow_not_found", flowId, message: `Sync flow ${flowId} was not found.` };
  }
  const config = decodeFlowPlanConfig(flow);

  let sourceCred: SyncCredential | null;
  let targetCred: SyncCredential | null;
  try {
    sourceCred = getSyncCredential(db, config.sourceConnectionFingerprint);
    targetCred = getSyncCredential(db, config.targetConnectionFingerprint);
  } catch {
    // openSecret failed → vault locked (key changed) or ciphertext tampered.
    return { status: "vault_locked", flowId, message: "Cannot decrypt stored credentials; the vault key may have changed." };
  }
  if (!sourceCred || !targetCred) {
    return { status: "not_enrolled", flowId, message: "The source or target connection is not enrolled for unattended sync." };
  }

  const sourceConnection = connectionFromCredential(sourceCred);
  const targetConnection = connectionFromCredential(targetCred);

  const transport: PreviewTransportProvider & ApplyTransportProvider = {
    async openTransport(connection) {
      return createHttpApiTransport(connection as HttpApiConnection);
    },
  };

  return runSafeSync(
    {
      flowId,
      context: { sourceConnection, targetConnection },
      trigger: "scheduled_unattended",
    },
    {
      transport,
      previewStore: createAppDbPreviewStore(db),
      applyStore: createAppDbApplyStore(db),
    }
  );
}
