import type { NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import {
  getConnectionCredential,
  rememberedCredentialsSupported,
} from "@/lib/app-db/connectionCredentialRepository";
import { getSessionKey } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";
import type { HttpProxyConnection } from "./serverQueue";

/**
 * Resolve the effective upstream connection for a proxy request (RD-061 / PR-026c).
 *
 * Two shapes are supported, fully backward-compatible:
 *  - **Inline** (`connection` with an `apiKey`) — ephemeral connections; the key
 *    rides in the request body exactly as before.
 *  - **Reference** (`connectionRef` = a remembered connection fingerprint) — the
 *    sealed `apiKey` is unsealed **server-side** with the unlocked session key
 *    and never travels to the browser.
 */

export type ProxyConnectionSource = {
  connection?: HttpProxyConnection;
  connectionRef?: string;
};

export type ResolvedProxyConnection =
  | { ok: true; connection: HttpProxyConnection }
  | { ok: false; error: string; status: number };

export function resolveProxyConnection(
  request: NextRequest,
  payload: ProxyConnectionSource
): ResolvedProxyConnection {
  // Inline credentials (ephemeral connection) — unchanged path.
  if (payload.connection?.baseUrl && payload.connection?.apiKey) {
    return { ok: true, connection: payload.connection };
  }

  // Reference to a remembered connection — inject the sealed apiKey server-side.
  if (payload.connectionRef) {
    if (!rememberedCredentialsSupported()) {
      return { ok: false, error: "Remembered connections are not available here.", status: 400 };
    }
    const key = getSessionKey(readSessionToken(request));
    if (!key) {
      return { ok: false, error: "Vault is locked. Unlock to use a remembered connection.", status: 401 };
    }
    let cred;
    try {
      cred = getConnectionCredential(getAppDb(), payload.connectionRef, key);
    } catch {
      return { ok: false, error: "Could not decrypt the remembered connection.", status: 401 };
    }
    if (!cred || !cred.secret.apiKey) {
      return { ok: false, error: "Remembered connection not found.", status: 404 };
    }
    return {
      ok: true,
      connection: {
        baseUrl: cred.baseUrl,
        apiKey: cred.secret.apiKey,
        budgetSyncId: cred.budgetSyncId,
        encryptionPassword: cred.secret.encryptionPassword,
      },
    };
  }

  return { ok: false, error: "Missing connection details", status: 400 };
}
