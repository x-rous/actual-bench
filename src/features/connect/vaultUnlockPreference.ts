"use client";

import {
  DEFAULT_VAULT_UNLOCK_DURATION,
  KEEP_SIGNED_IN_DURATION,
  isVaultUnlockDuration,
  keepsSignedIn,
  type VaultUnlockDuration,
} from "@/lib/connectionVault/unlockDuration";

const STORAGE_KEY = "vault-unlock-duration";

/**
 * This browser's "Keep me signed in" choice, as the duration to ask for.
 * Choices saved before it was a checkbox map onto it: 7 or 30 days reads as
 * ticked (30 days), 8 or 24 hours as unticked.
 */
export function readVaultUnlockDuration(): VaultUnlockDuration {
  if (typeof window === "undefined") return DEFAULT_VAULT_UNLOCK_DURATION;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isVaultUnlockDuration(value) && keepsSignedIn(value)
      ? KEEP_SIGNED_IN_DURATION
      : DEFAULT_VAULT_UNLOCK_DURATION;
  } catch {
    return DEFAULT_VAULT_UNLOCK_DURATION;
  }
}

export function saveVaultUnlockDuration(duration: VaultUnlockDuration): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, duration);
    return true;
  } catch {
    return false;
  }
}
