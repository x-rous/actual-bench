"use client";

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";

/**
 * Like useState, but the value is serialised to sessionStorage so it survives
 * client-side navigation within the same tab.
 *
 * - Reads the stored value on mount and merges it with defaults (missing keys
 *   fall back to the default value, so adding new filter fields is safe).
 * - Writes the full state object to storage on every state change.
 * - Returns a stable clearFilters callback that resets to defaults and removes
 *   the storage key.
 *
 * sessionStorage lifetime matches connection and staged data — cleared on tab
 * close. Clear all "filters:*" keys from sessionStorage in AppShell when the
 * active connection changes so stale entity IDs don't carry over.
 */
export function usePersistedFilters<T extends Record<string, unknown>>(
  key: string,
  defaults: T
): [T, Dispatch<SetStateAction<T>>, () => void] {
  // Capture defaults once so clearFilters doesn't depend on the caller's
  // object reference (which may change on every render).
  const defaultsRef = useRef(defaults);

  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<T>;
        // Spread defaults first so new filter fields added later still get
        // their default value even if the stored object predates them.
        return { ...defaults, ...parsed };
      }
    } catch {
      // Ignore parse errors — fall back to defaults.
    }
    return defaults;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore storage errors (private mode, quota exceeded).
    }
  }, [key, state]);

  const clearFilters = useCallback(() => {
    setState(defaultsRef.current);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [key]);

  return [state, setState, clearFilters];
}
