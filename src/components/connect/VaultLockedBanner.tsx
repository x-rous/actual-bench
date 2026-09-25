"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

async function fetchVaultLocked(): Promise<boolean> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  if (!response.ok) return false;
  const body = (await response.json()) as { status?: string };
  return body.status === "locked";
}

/**
 * The connect screen is the one page every visit passes through, so a locked
 * vault is announced here too (F-197). Information only: the cause and the
 * fixes, reset included, sit behind a connection in App Health.
 */
export function VaultLockedBanner() {
  const locked = useQuery({ queryKey: ["vault-locked"], queryFn: fetchVaultLocked, staleTime: 60_000 });
  if (!locked.data) return null;
  return (
    <div
      role="status"
      className="flex w-full max-w-md items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">Stored credentials for automations are locked.</span> Connect to a budget and
        open App Health to fix it.
      </span>
    </div>
  );
}
