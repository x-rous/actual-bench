import type { ConnectionCredentialMeta, ConnectionCredentialSecret } from "@/lib/app-db/types";
import type { ConnectionMode } from "@/store/connection";

/**
 * Client for the remembered-connection vault routes (RD-061 / PR-026d).
 *
 * All requests are same-origin, so the httpOnly unlock-session cookie rides
 * along automatically. Secrets only ever travel *to* the server on enroll, and
 * *from* it only via `revealDirectSecret` (Direct mode, explicit unlock).
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

/** List remembered connection metadata (no secrets). Available before unlock. */
export function listRememberedConnections(): Promise<{
  supported: boolean;
  connections: ConnectionCredentialMeta[];
}> {
  return jsonFetch("/api/connection-vault/connections");
}

export type RememberConnectionInput = {
  mode: ConnectionMode;
  baseUrl: string;
  budgetSyncId: string;
  label?: string;
  secret: ConnectionCredentialSecret;
};

/** Remember (seal + store) a connection. Requires an unlocked session. */
export function rememberConnection(
  input: RememberConnectionInput
): Promise<{ connection: ConnectionCredentialMeta }> {
  return jsonFetch("/api/connection-vault/connections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Forget a remembered connection by fingerprint. */
export function forgetRememberedConnection(connectionFingerprint: string): Promise<{ ok: true }> {
  return jsonFetch(
    `/api/connection-vault/connections?connectionFingerprint=${encodeURIComponent(connectionFingerprint)}`,
    { method: "DELETE" }
  );
}

export type RevealedDirectSecret = {
  baseUrl: string;
  budgetSyncId: string;
  label: string;
  secret: { serverPassword: string; encryptionPassword: string | null };
};

/** Release a remembered Direct connection's server password to reconnect (weaker path). */
export function revealDirectSecret(connectionFingerprint: string): Promise<RevealedDirectSecret> {
  return jsonFetch("/api/connection-vault/connections/reveal", {
    method: "POST",
    body: JSON.stringify({ connectionFingerprint }),
  });
}
