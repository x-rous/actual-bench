import { generateId } from "@/lib/uuid";
import { deriveLabel } from "@/components/connect/utils";
import type { ConnectionInstance } from "@/store/connection";
import type { RevealedServerSecret } from "./vaultApi";

/**
 * Rebuild a ConnectionInstance from a revealed vault secret. Shared by the
 * one-click "remembered budget" reconnect (RD-063) and the refresh
 * auto-resume path, so both build instances the same way.
 */
export function buildInstanceFromRevealed(
  revealed: RevealedServerSecret,
  budgetSyncId: string,
  label?: string
): ConnectionInstance {
  const base = {
    id: generateId(),
    label: label || deriveLabel(revealed.baseUrl),
    baseUrl: revealed.baseUrl,
    budgetSyncId,
    ...(revealed.secret.encryptionPassword
      ? { encryptionPassword: revealed.secret.encryptionPassword }
      : {}),
  };
  return revealed.mode === "browser-api"
    ? { ...base, mode: "browser-api", serverPassword: revealed.secret.serverPassword ?? "" }
    : { ...base, mode: "http-api", apiKey: revealed.secret.apiKey ?? "" };
}
