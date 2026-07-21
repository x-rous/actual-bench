import { randomBytes } from "node:crypto";

/**
 * In-memory unlock-session cache for remembered connection credentials
 * (RD-061 / PR-026b).
 *
 * After the user unlocks with their passphrase, the derived AES key is held
 * here — in server memory only, keyed by an opaque token that rides in an
 * httpOnly cookie. The key is NEVER persisted (that is the whole point: the
 * server cannot decrypt on its own). A server restart drops all sessions and
 * users re-unlock.
 *
 * The Map is stashed on `globalThis` so it survives Next's dev module-instance
 * duplication (HMR) and is shared across API route modules in one process.
 *
 * Node-only; must never be imported into client code.
 */

export const SESSION_IDLE_TTL_MS = 8 * 60 * 60 * 1000; // 8h sliding idle window

type Session = { key: Buffer; expiresAt: number; ttlMs: number };

const globalStore = globalThis as unknown as { __abVaultSessions?: Map<string, Session> };
const sessions: Map<string, Session> = (globalStore.__abVaultSessions ??= new Map());

function sweep(now: number): void {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

/** Create a session holding `key`; returns the opaque token for the cookie. */
export function createSession(key: Buffer, ttlMs: number = SESSION_IDLE_TTL_MS): string {
  const now = Date.now();
  sweep(now);
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { key, expiresAt: now + ttlMs, ttlMs });
  return token;
}

/**
 * Return the key for a live session, refreshing its idle window (sliding TTL,
 * using the session's own TTL). Null when the token is unknown or expired.
 */
export function getSessionKey(token: string | undefined | null): Buffer | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = now + session.ttlMs; // sliding refresh
  return session.key;
}

/** Whether a token maps to a live session (no key returned). */
export function hasSession(token: string | undefined | null): boolean {
  return getSessionKey(token) !== null;
}

/** Drop a single session (lock). */
export function clearSession(token: string | undefined | null): void {
  if (token) sessions.delete(token);
}

/** Drop every session (e.g. on passphrase change). */
export function clearAllSessions(): void {
  sessions.clear();
}
