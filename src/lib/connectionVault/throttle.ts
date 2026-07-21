/**
 * Brute-force throttle for remembered-connection vault unlock (RD-061 / PR-026).
 *
 * The app has no authentication, so an attacker who can reach it could otherwise
 * guess the passphrase limited only by scrypt cost. This adds a simple
 * server-side backoff: after a few failures, unlock attempts are locked out for
 * a growing window. Single-tenant, so the counter is global and in-memory
 * (globalThis-backed to survive Next's dev module split); a restart resets it.
 *
 * Node-only; must never be imported into client code.
 */

const MAX_ATTEMPTS = 5; // failures before lockout kicks in
const BASE_LOCKOUT_MS = 15_000; // first lockout window
const MAX_LOCKOUT_MS = 15 * 60_000; // cap

type ThrottleState = { failures: number; lockedUntil: number };

const store = globalThis as unknown as { __abVaultThrottle?: ThrottleState };
const state: ThrottleState = (store.__abVaultThrottle ??= { failures: 0, lockedUntil: 0 });

/** Milliseconds remaining in the current lockout, or 0 when unlock is allowed. */
export function unlockRetryAfterMs(): number {
  const remaining = state.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

/** Record a failed unlock; after the threshold, start (and grow) the lockout. */
export function recordUnlockFailure(): void {
  state.failures += 1;
  if (state.failures >= MAX_ATTEMPTS) {
    const overBy = state.failures - MAX_ATTEMPTS;
    const lockout = Math.min(BASE_LOCKOUT_MS * 2 ** overBy, MAX_LOCKOUT_MS);
    state.lockedUntil = Date.now() + lockout;
  }
}

/** Clear all failure state after a successful unlock. */
export function recordUnlockSuccess(): void {
  state.failures = 0;
  state.lockedUntil = 0;
}

/** Test helper: reset the throttle between cases. */
export function resetUnlockThrottle(): void {
  state.failures = 0;
  state.lockedUntil = 0;
}
