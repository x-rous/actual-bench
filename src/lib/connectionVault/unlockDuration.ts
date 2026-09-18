export const VAULT_UNLOCK_DURATIONS = {
  "8h": 8 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

export type VaultUnlockDuration = keyof typeof VAULT_UNLOCK_DURATIONS;

export const DEFAULT_VAULT_UNLOCK_DURATION: VaultUnlockDuration = "8h";

export const VAULT_UNLOCK_DURATION_OPTIONS: ReadonlyArray<{
  value: VaultUnlockDuration;
  label: string;
}> = [
  { value: "8h", label: "8 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export function isVaultUnlockDuration(value: unknown): value is VaultUnlockDuration {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(VAULT_UNLOCK_DURATIONS, value)
  );
}

export function vaultUnlockDurationMs(duration: VaultUnlockDuration): number {
  return VAULT_UNLOCK_DURATIONS[duration];
}
