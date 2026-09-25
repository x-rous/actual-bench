/**
 * What the browser may know about the operator vault (F-197): ready, or locked
 * and why. Client-safe - no Node imports, no key material, no paths.
 *
 * The vault always exists. "Locked" is an error with a fix, shown in App
 * Health; every other surface only needs to know that it is locked and where
 * to go.
 */

export type VaultLockReason =
  /** Stored credentials exist, and no key was found to open them. */
  | "missing"
  /** A key was found, and it does not open the stored credentials. */
  | "wrong-key"
  /** The key file exists but is empty or cannot be read. */
  | "unreadable"
  /** A fresh install could not write its key file. */
  | "cannot-create";

export type VaultSummary = { status: "ready" } | { status: "locked"; reason: VaultLockReason };

export const VAULT_LOCK_MESSAGES: Record<VaultLockReason, string> = {
  missing: "Bench can't find the vault key that sealed its stored credentials.",
  "wrong-key": "The vault key Bench has doesn't open its stored credentials.",
  unreadable: "The vault key file exists but can't be read.",
  "cannot-create": "Bench couldn't create a vault key because its data folder can't be written.",
};

/** One line for any surface the lock blocks. The fixes live in App Health. */
export const VAULT_LOCKED_NOTICE = "Stored credentials are locked, so this can't run on the server.";

export function isVaultReady(vault: VaultSummary | null | undefined): boolean {
  return vault?.status === "ready";
}

/** The error a route returns while the vault is locked. */
export function vaultLockedError(vault: VaultSummary): string {
  const reason = vault.status === "locked" ? ` ${VAULT_LOCK_MESSAGES[vault.reason]}` : "";
  return `The credential vault is locked.${reason} Open App Health to fix it.`;
}
