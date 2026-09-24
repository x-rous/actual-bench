import { getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { openServerTransport, resolveServerConnection } from "@/lib/actual/serverTransport";
import { decodeFlowPlanConfig } from "./flowConfig";
import { createAppDbApplyStore } from "./appDbApplyStore";
import { createAppDbPreviewStore } from "./appDbPreviewStore";
import { runSafeSync, type SafeSyncResult } from "./safeSyncOrchestrator";
import { vaultEnabled } from "./vault";
import type { ApplyTransportProvider } from "./applyOrchestrator";
import type { PreviewTransportProvider } from "./previewOrchestrator";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { ConnectionInstance } from "@/store/connection";

/**
 * Headless server-side safe-sync (RD-058 / PR-024b). Runs the RD-054 safe-only
 * executor for an HTTP-API flow with **no browser open**, driving the same
 * planner/apply engine through a server-side HTTP transport and the app-DB
 * stores. Credentials come from the encrypted vault - never the client.
 *
 * Fail-safe: a disabled/locked vault or an un-enrolled connection returns a
 * typed pre-run status (the scheduler pauses/surfaces it) instead of guessing.
 * Connections resolve to either mode (RD-095); which flows run here is decided
 * upstream, by what can be enrolled.
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

export async function runServerSafeSync(
  db: SqliteDatabase,
  flowId: string,
  options: { onApplyStart?: () => void } = {}
): Promise<ServerSafeSyncResult> {
  if (!vaultEnabled()) {
    return { status: "vault_disabled", flowId, message: "Credential vault is disabled (SYNC_VAULT_KEY unset)." };
  }

  const flow = getSyncFlow(db, flowId);
  if (!flow) {
    return { status: "flow_not_found", flowId, message: `Sync flow ${flowId} was not found.` };
  }
  const config = decodeFlowPlanConfig(flow);

  let sourceConnection: ConnectionInstance | null;
  let targetConnection: ConnectionInstance | null;
  try {
    sourceConnection = resolveServerConnection(db, config.sourceConnectionFingerprint);
    targetConnection = resolveServerConnection(db, config.targetConnectionFingerprint);
  } catch {
    // openSecret failed → vault locked (key changed) or ciphertext tampered.
    return { status: "vault_locked", flowId, message: "Cannot decrypt stored credentials; the vault key may have changed." };
  }
  if (!sourceConnection || !targetConnection) {
    return { status: "not_enrolled", flowId, message: "The source or target connection is not enrolled for unattended sync." };
  }

  // HTTP on its own; Direct on the Node host, inside the worker this runs in.
  const transport: PreviewTransportProvider & ApplyTransportProvider = {
    async openTransport(connection) {
      return openServerTransport(connection);
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
      onApplyStart: options.onApplyStart,
    }
  );
}

/**
 * Human-readable reason for a non-success result, so operator surfaces (run
 * history, App Health, "Run now") explain a failed or blocked run rather than
 * showing a bare status. Lived in `serverScheduler.ts` until PR-043c replaced
 * that module with the automation engine.
 */
export function serverResultMessage(result: ServerSafeSyncResult): string | undefined {
  if (isServerSafeSyncBlocked(result)) return result.message;
  if (result.status === "preview_failed") return result.error.message;
  if (result.status === "failed" || result.status === "partial") return result.apply.error?.message;
  return undefined;
}
