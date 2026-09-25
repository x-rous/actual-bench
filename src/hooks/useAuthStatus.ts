"use client";

import { useQuery } from "@tanstack/react-query";
import { getVaultStatus } from "@/features/connect/vaultApi";

export const AUTH_STATUS_QUERY_KEY = ["auth-status"] as const;

/**
 * Whether Actual Bench asks for its password, and whether this browser is
 * signed in (RD-096). The saved-connections vault answers it: one password,
 * one session. `useConnectionVault` writes to the same cache after it acts,
 * so the account menu and App Health follow a sign-in or password change.
 */
export function useAuthStatus() {
  return useQuery({ queryKey: AUTH_STATUS_QUERY_KEY, queryFn: getVaultStatus, staleTime: 60_000 });
}
