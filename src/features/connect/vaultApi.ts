import type { ServerCredentialMeta, ServerCredentialSecret } from "@/lib/app-db/types";
import type { ConnectionMode } from "@/store/connection";

// Re-export for consumers building UI over remembered servers.
export type { ServerCredentialMeta } from "@/lib/app-db/types";

/**
 * Client for the remembered-server vault routes (RD-061 / RD-063).
 *
 * All requests are same-origin, so the httpOnly unlock-session cookie rides
 * along automatically. Secrets only ever travel *to* the server on enroll, and
 * *from* it only via `revealServerSecret` (explicit unlock).
 */

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const text = await response.text();
  let data: (T & { error?: string }) | null = null;
  try {
    data = (text ? JSON.parse(text) : {}) as T & { error?: string };
  } catch {
    // Non-JSON body: fall through to a status-based error.
  }
  if (!response.ok) {
    throw new Error(data?.error ?? `Request to ${input} failed (${response.status})`);
  }
  if (data === null) {
    throw new Error(`Request to ${input} returned a malformed response.`);
  }
  return data;
}

export type VaultStatus = { supported: boolean; passphraseSet: boolean; unlocked: boolean };

/** Whether the feature is available here, a passphrase is set, and this session is unlocked. */
export function getVaultStatus(): Promise<VaultStatus> {
  return jsonFetch("/api/connection-vault");
}

/** Set the passphrase for the first time (also unlocks this session). */
export function setVaultPassphrase(passphrase: string): Promise<{ ok: true; unlocked: true }> {
  return jsonFetch("/api/connection-vault/passphrase", {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });
}

/** Unlock this session with the passphrase. */
export function unlockVault(passphrase: string): Promise<{ ok: true; unlocked: true }> {
  return jsonFetch("/api/connection-vault/unlock", {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });
}

/** Lock this session (drop the in-memory key + clear the cookie). */
export function lockVault(): Promise<{ ok: true; unlocked: false }> {
  return jsonFetch("/api/connection-vault/lock", { method: "POST" });
}

/**
 * Reset the vault when the passphrase is forgotten: drop all saved servers +
 * budget passwords and clear the passphrase so a new one can be set.
 */
export function resetVault(): Promise<{ ok: true }> {
  return jsonFetch("/api/connection-vault/reset", { method: "POST" });
}

/** Change the passphrase, re-sealing all remembered credentials. */
export function changeVaultPassphrase(
  currentPassphrase: string,
  newPassphrase: string
): Promise<{ ok: true; unlocked: true }> {
  return jsonFetch("/api/connection-vault/passphrase/change", {
    method: "POST",
    body: JSON.stringify({ currentPassphrase, newPassphrase }),
  });
}

// ── Server-scoped vault (RD-063) ─────────────────────────────────────────────
// A saved server opens any of its budgets; budget encryption passwords are
// remembered per-budget under their server.

/** List remembered server metadata (no secrets). Available before unlock. */
export function listRememberedServers(): Promise<{
  supported: boolean;
  servers: ServerCredentialMeta[];
}> {
  return jsonFetch("/api/connection-vault/servers");
}

export type RememberServerInput = {
  mode: ConnectionMode;
  baseUrl: string;
  label?: string;
  secret: ServerCredentialSecret;
};

/** Remember (seal + store) a server. Requires an unlocked session. */
export function rememberServer(input: RememberServerInput): Promise<{ server: ServerCredentialMeta }> {
  return jsonFetch("/api/connection-vault/servers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Forget a remembered server (and its budget encryption passwords) by fingerprint. */
export function forgetRememberedServer(serverFingerprint: string): Promise<{ ok: true }> {
  return jsonFetch(
    `/api/connection-vault/servers?serverFingerprint=${encodeURIComponent(serverFingerprint)}`,
    { method: "DELETE" }
  );
}

export type RevealedServerSecret = {
  mode: ConnectionMode;
  baseUrl: string;
  label: string;
  secret: {
    apiKey: string | null;
    serverPassword: string | null;
    encryptionPassword: string | null;
  };
};

/**
 * Reveal a remembered server's secret to reconnect. Pass `budgetSyncId` to also
 * release that budget's remembered encryption password, when one is stored.
 */
export function revealServerSecret(
  serverFingerprint: string,
  budgetSyncId?: string
): Promise<RevealedServerSecret> {
  return jsonFetch("/api/connection-vault/servers/reveal", {
    method: "POST",
    body: JSON.stringify({ serverFingerprint, budgetSyncId }),
  });
}

export type RememberBudgetEncryptionInput = {
  serverFingerprint: string;
  budgetSyncId: string;
  label?: string;
  encryptionPassword: string;
};

/** Remember a budget's encryption password under its server. Requires an unlocked session. */
export function rememberBudgetEncryption(input: RememberBudgetEncryptionInput): Promise<{ ok: true }> {
  return jsonFetch("/api/connection-vault/servers/budget-encryption", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Forget a budget's remembered encryption password. */
export function forgetBudgetEncryption(serverFingerprint: string, budgetSyncId: string): Promise<{ ok: true }> {
  return jsonFetch(
    `/api/connection-vault/servers/budget-encryption?serverFingerprint=${encodeURIComponent(
      serverFingerprint
    )}&budgetSyncId=${encodeURIComponent(budgetSyncId)}`,
    { method: "DELETE" }
  );
}
