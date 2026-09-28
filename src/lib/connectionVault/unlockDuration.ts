export const VAULT_UNLOCK_DURATIONS = {
  "8h": 8 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

export type VaultUnlockDuration = keyof typeof VAULT_UNLOCK_DURATIONS;

export const DEFAULT_VAULT_UNLOCK_DURATION: VaultUnlockDuration = "8h";

/** What "Keep me signed in" asks for: 30 days, renewed while in use. */
export const KEEP_SIGNED_IN_DURATION: VaultUnlockDuration = "30d";

/**
 * Whether a duration keeps you signed in across browser restarts. The shorter
 * ones (the unticked "Keep me signed in") end when the browser closes, so
 * their cookie carries no expiry; the server still ends them when idle.
 */
export function keepsSignedIn(duration: VaultUnlockDuration): boolean {
  return duration === "7d" || duration === "30d";
}

export function isVaultUnlockDuration(value: unknown): value is VaultUnlockDuration {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(VAULT_UNLOCK_DURATIONS, value)
  );
}

export function vaultUnlockDurationMs(duration: VaultUnlockDuration): number {
  return VAULT_UNLOCK_DURATIONS[duration];
}
