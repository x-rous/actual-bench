"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VAULT_LOCK_MESSAGES,
  VAULT_LOCKED_NOTICE,
  type VaultLockReason,
  type VaultSummary,
} from "@/lib/credentials/vaultSummary";

/**
 * Shown wherever a locked vault stops something from working (F-197). The
 * vault always exists; locked is an error with a fix, and the fix lives in App
 * Health, so this says what happened and points there. Renders nothing while
 * the vault is ready.
 */
export function VaultLockedNotice({ vault, className }: { vault: VaultSummary | null | undefined; className?: string }) {
  if (!vault || vault.status === "ready") return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">{VAULT_LOCKED_NOTICE}</span> {VAULT_LOCK_MESSAGES[vault.reason]}{" "}
        <Link href="/app-health" className="underline underline-offset-4">
          Fix it in App Health
        </Link>
        .
      </span>
    </div>
  );
}

async function fetchVaultSummary(): Promise<VaultSummary | null> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as { status: "ready" | "locked"; reason?: VaultLockReason };
  return body.status === "locked" ? { status: "locked", reason: body.reason ?? "missing" } : { status: "ready" };
}

/** A page-level notice that asks for the vault's state itself. */
export function VaultLockedPageNotice({ className }: { className?: string }) {
  const vault = useQuery({ queryKey: ["vault-summary"], queryFn: fetchVaultSummary, staleTime: 30_000 });
  return <VaultLockedNotice vault={vault.data} className={className} />;
}
