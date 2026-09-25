"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { VaultLockReason } from "@/lib/credentials/vaultSummary";

/** `GET /api/vault`: never key material. */
export type VaultStateResponse = {
  status: "ready" | "locked";
  reason?: VaultLockReason;
  message?: string;
  source?: "environment" | "legacy-environment" | "file";
  warning?: "legacy-name" | "both-names";
  detail?: string;
  keyPath: string;
  storedSecrets: number;
};

export async function fetchVaultState(): Promise<VaultStateResponse> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  if (!response.ok) throw new Error(`Vault status request failed (${response.status})`);
  return (await response.json()) as VaultStateResponse;
}

async function postVaultReset(): Promise<void> {
  const response = await fetch("/api/vault/reset", { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Vault reset failed (${response.status})`);
  }
}

const RESETTABLE: readonly VaultLockReason[] = ["missing", "wrong-key", "unreadable"];

/** Every query whose answer depends on the vault being usable. */
const VAULT_DEPENDENT_QUERIES = [
  ["vault-state"],
  ["vault-summary"],
  ["vault-locked"],
  ["sync-vault-status"],
  ["vault-status"],
  ["vault-connections"],
  ["automation-health"],
  ["automation-connections"],
  ["server-budgets"],
  ["backups"],
];

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>;
}

function sourceLabel(state: VaultStateResponse): React.ReactNode {
  if (state.source === "environment") return <>key from <Code>ACTUAL_BENCH_VAULT_KEY</Code></>;
  if (state.source === "legacy-environment") return <>key from <Code>SYNC_VAULT_KEY</Code></>;
  return <>key file <Code>{state.keyPath}</Code></>;
}

function Fix({ state }: { state: VaultStateResponse }) {
  const path = <Code>{state.keyPath}</Code>;
  switch (state.reason) {
    case "missing":
      return (
        <>
          Put the original key file back at {path} and check again, or set <Code>ACTUAL_BENCH_VAULT_KEY</Code> to the
          key you used before and restart Bench. If the key is gone for good, reset the vault and enter the credentials
          again.
        </>
      );
    case "wrong-key":
      return (
        <>
          Restore {path} to the key that sealed them and check again, or set <Code>ACTUAL_BENCH_VAULT_KEY</Code> to it
          and restart Bench. If that key is gone for good, reset the vault and enter the credentials again.
        </>
      );
    case "unreadable":
      return (
        <>
          Fix or replace {path}, then check again. Resetting the vault moves the file aside (it is kept, not deleted)
          and starts again with a new key.
        </>
      );
    case "cannot-create":
      return <>Make the folder holding {path} writable by Bench, then check again.</>;
    default:
      return null;
  }
}

/**
 * The "Credential vault" row of App Health (F-197). The vault always exists;
 * this says where its key comes from, or why it is locked and how to fix that.
 */
export function VaultHealth({ enrolledLabels }: { enrolledLabels: string[] }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const vault = useQuery({ queryKey: ["vault-state"], queryFn: fetchVaultState });

  // Everything that depends on the vault, not just its own row: once a key is
  // restored, the enrolled count and automation status must not stay as they
  // were while it was locked.
  const refreshVaultDependents = () => {
    for (const queryKey of VAULT_DEPENDENT_QUERIES) void queryClient.invalidateQueries({ queryKey });
  };

  const reset = useMutation({
    mutationFn: postVaultReset,
    onSuccess: () => {
      toast.success("Vault reset. Enrol your connections and re-enter backup credentials to use them again.");
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: refreshVaultDependents,
  });

  if (vault.isError) {
    return <span className="text-destructive">Status unavailable - {(vault.error as Error).message}</span>;
  }
  const state = vault.data;
  if (!state) return <span className="text-muted-foreground">Checking...</span>;

  const warning =
    state.warning === "legacy-name" ? (
      <>
        <Code>SYNC_VAULT_KEY</Code> is an old name. Rename it to <Code>ACTUAL_BENCH_VAULT_KEY</Code>; the old name will
        stop working in a future release.
      </>
    ) : state.warning === "both-names" ? (
      <>
        <Code>ACTUAL_BENCH_VAULT_KEY</Code> and <Code>SYNC_VAULT_KEY</Code> are both set to different values. Bench uses{" "}
        <Code>ACTUAL_BENCH_VAULT_KEY</Code>; remove the other one.
      </>
    ) : null;

  if (state.status === "ready") {
    return (
      <span className="flex flex-col gap-0.5">
        <span>Ready · {sourceLabel(state)}</span>
        {state.source === "file" && (
          <span className="text-muted-foreground">
            Keep this file with the rest of your data. Without it, stored credentials cannot be opened.
          </span>
        )}
        {warning && <span className="text-amber-700 dark:text-amber-300">{warning}</span>}
      </span>
    );
  }

  const canReset = state.reason ? RESETTABLE.includes(state.reason) : false;
  return (
    <span className="flex flex-col gap-1.5">
      <span className="text-destructive">
        Locked - {state.message} Automations that need stored credentials are paused.
      </span>
      {state.detail && <span className="break-all text-muted-foreground">{state.detail}</span>}
      <span className="text-muted-foreground">
        <Fix state={state} />
      </span>
      {warning && <span className="text-amber-700 dark:text-amber-300">{warning}</span>}
      <span className="flex flex-wrap gap-2 pt-0.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={refreshVaultDependents}
          disabled={vault.isFetching}
        >
          <RefreshCw className={vault.isFetching ? "animate-spin" : undefined} aria-hidden />
          Check again
        </Button>
        {canReset && (
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setConfirming(true)}
            disabled={reset.isPending}
          >
            {reset.isPending ? "Resetting..." : "Reset vault..."}
          </Button>
        )}
      </span>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        state={{
          title: "Reset the credential vault?",
          destructiveLabel: "Reset vault",
          onConfirm: () => reset.mutate(),
          message: (
            <span className="flex flex-col gap-2">
              <span>
                This deletes the {state.storedSecrets} stored {state.storedSecrets === 1 ? "secret" : "secrets"} Bench
                can no longer open, and starts the vault again. Nothing in your budgets changes.
              </span>
              {enrolledLabels.length > 0 && (
                <span>
                  These budgets stop running unattended until you enrol them again: {enrolledLabels.join(", ")}.
                </span>
              )}
              <span>
                S3 backup destinations and backup passphrases need their credentials entered again. Remembered
                connections are not affected.
              </span>
            </span>
          ),
        }}
      />
    </span>
  );
}
