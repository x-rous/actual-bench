const STORAGE_KEY = "actual-admin-last-active-ref";

export type LastActiveRef = {
  fingerprint: string;
  budgetSyncId: string;
  label: string;
};

/**
 * Non-secret pointer to the connection that was active before a refresh, so
 * AppShell can try to resume it from the vault instead of always bouncing to
 * /connect. Kept outside the connection store's persist middleware (which is
 * deliberately locked to never write secrets) — this never holds any.
 */
export function getLastActiveRef(): LastActiveRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastActiveRef>;
    if (
      typeof parsed.fingerprint === "string" &&
      typeof parsed.budgetSyncId === "string" &&
      typeof parsed.label === "string"
    ) {
      return { fingerprint: parsed.fingerprint, budgetSyncId: parsed.budgetSyncId, label: parsed.label };
    }
    return null;
  } catch {
    return null;
  }
}

export function setLastActiveRef(ref: LastActiveRef): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ref));
  } catch {
    // Storage unavailable (private mode, quota) — refresh just won't auto-resume.
  }
}

/** Called on an explicit disconnect so a later refresh doesn't resume it. */
export function clearLastActiveRef(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — worst case a stale pointer fails to resolve next time.
  }
}
