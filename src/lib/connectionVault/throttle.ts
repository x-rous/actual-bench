/**
 * Brute-force throttle for signing in (RD-096; first built for vault unlock in
 * RD-061 / PR-026). The password is the app's password and the vault's, so a
 * guess is limited by this backoff as well as scrypt's cost.
 *
 * Counted per client, so a stranger's failed guesses slow down that stranger,
 * not the owner signing in from their own browser. The client is the address
 * the nearest reverse proxy saw (the last `X-Forwarded-For` entry, which a
 * client behind that proxy can't forge). Where Bench is reached directly and
 * that header can be forged, a global count with a much higher threshold still
 * stops a guesser who rotates addresses.
 *
 * In memory (globalThis-backed to survive Next's dev module split); a restart
 * resets it. Node-only; must never be imported into client code.
 */

const MAX_ATTEMPTS = 5; // failures from one client before its lockout starts
const GLOBAL_MAX_ATTEMPTS = 50; // failures from everyone before all sign-ins wait
const BASE_LOCKOUT_MS = 15_000; // first lockout window
const MAX_LOCKOUT_MS = 15 * 60_000; // cap
const FORGET_AFTER_MS = 60 * 60_000; // an hour without failures starts a client over
const MAX_CLIENTS = 1_000; // buckets kept before idle ones are dropped

type Bucket = { failures: number; lockedUntil: number; lastFailureAt: number };
type ThrottleState = { clients: Map<string, Bucket>; global: Bucket };

const store = globalThis as unknown as { __abSignInThrottle?: ThrottleState };
const state: ThrottleState = (store.__abSignInThrottle ??= { clients: new Map(), global: emptyBucket() });

function emptyBucket(): Bucket {
  return { failures: 0, lockedUntil: 0, lastFailureAt: 0 };
}

/** Who is signing in: the address the nearest proxy saw, or "direct" without one. */
export function throttleClientKey(headers: { get(name: string): string | null }): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded.at(-1) ?? headers.get("x-real-ip")?.trim() ?? "direct";
}

function lockoutFor(failures: number, threshold: number): number {
  return Math.min(BASE_LOCKOUT_MS * 2 ** (failures - threshold), MAX_LOCKOUT_MS);
}

function remaining(bucket: Bucket | undefined, now: number): number {
  return bucket && bucket.lockedUntil > now ? bucket.lockedUntil - now : 0;
}

/** Milliseconds this client must wait before trying again, or 0 when it may. */
export function unlockRetryAfterMs(client: string): number {
  const now = Date.now();
  return Math.max(remaining(state.clients.get(client), now), remaining(state.global, now));
}

function fail(bucket: Bucket, threshold: number, now: number): void {
  if (now - bucket.lastFailureAt > FORGET_AFTER_MS) bucket.failures = 0;
  bucket.failures += 1;
  bucket.lastFailureAt = now;
  if (bucket.failures >= threshold) bucket.lockedUntil = now + lockoutFor(bucket.failures, threshold);
}

/** Record a failed attempt; past the threshold, start (and grow) the lockout. */
export function recordUnlockFailure(client: string): void {
  const now = Date.now();
  if (!state.clients.has(client) && state.clients.size >= MAX_CLIENTS) {
    for (const [key, bucket] of state.clients) {
      if (bucket.lockedUntil <= now) state.clients.delete(key);
    }
  }
  const bucket = state.clients.get(client) ?? emptyBucket();
  state.clients.set(client, bucket);
  fail(bucket, MAX_ATTEMPTS, now);
  fail(state.global, GLOBAL_MAX_ATTEMPTS, now);
}

/** A correct password: this client starts over, and so does the global count. */
export function recordUnlockSuccess(client: string): void {
  state.clients.delete(client);
  state.global = emptyBucket();
}

/** Test helper: reset the throttle between cases. */
export function resetUnlockThrottle(): void {
  state.clients.clear();
  state.global = emptyBucket();
}
