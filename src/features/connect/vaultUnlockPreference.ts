"use client";

import {
  DEFAULT_VAULT_UNLOCK_DURATION,
  VAULT_UNLOCK_DURATION_OPTIONS,
  type VaultUnlockDuration,
} from "@/lib/connectionVault/unlockDuration";

const STORAGE_KEY = "vault-unlock-duration";

export function readVaultUnlockDuration(): VaultUnlockDuration {
  if (typeof window === "undefined") return DEFAULT_VAULT_UNLOCK_DURATION;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return VAULT_UNLOCK_DURATION_OPTIONS.some((option) => option.value === value)
      ? (value as VaultUnlockDuration)
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
