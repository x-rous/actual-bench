"use client";

import { useQuery } from "@tanstack/react-query";
import type { VaultLockReason, VaultSummary } from "@/lib/credentials/vaultSummary";

type VaultStateCommon = {
  source?: "environment" | "legacy-environment" | "file";
  warning?: "legacy-name" | "both-names";
  keyPath: string;
  storedSecrets: number;
};

/** `GET /api/vault` (F-197). Never key material. */
export type VaultStateResponse =
  | (VaultStateCommon & { status: "ready" })
  | (VaultStateCommon & { status: "locked"; reason: VaultLockReason; message: string; detail?: string });

async function fetchVaultState(): Promise<VaultStateResponse> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  if (!response.ok) throw new Error(`Vault status request failed (${response.status})`);
  return (await response.json()) as VaultStateResponse;
}

/** The one client read of the vault's state, shared by every surface that shows it. */
export function useVaultState() {
  return useQuery({ queryKey: ["vault-state"], queryFn: fetchVaultState, staleTime: 30_000 });
}

export function toVaultSummary(state: VaultStateResponse | undefined): VaultSummary | undefined {
  if (!state) return undefined;
  return state.status === "locked" ? { status: "locked", reason: state.reason } : { status: "ready" };
}
