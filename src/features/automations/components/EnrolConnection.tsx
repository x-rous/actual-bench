"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isHttpApiConnection, useConnectionStore, selectActiveInstance } from "@/store/connection";
import { enrollCredential, getVaultStatus } from "@/features/sync/lib/syncApi";
import type { ConnectionInstance } from "@/store/connection";

/**
 * Enrolling a budget for unattended access (RD-058, relocated).
 *
 * A scheduled anything - sync, bank pull, backup - runs with the browser closed,
 * so the server needs that budget's API key stored. That has always been true;
 * what was wrong was where you could do it. The only path ran through a Budget
 * File Sync flow editor, so someone setting up a backup was sent to a feature
 * they may never use, losing the dialog they were filling in.
 *
 * This is that action, in one component, usable wherever the need appears.
 *
 * Two limits it states rather than hides:
 *
 *   * Bench can only enrol the connection you are **currently connected as**,
 *     because that is the only API key the browser holds. Any other budget has
 *     to be selected first.
 *   * Enrolment is per budget, not per server. Three budgets means three
 *     enrolments, and saying so keeps "I turned this on" and "this budget can
 *     be backed up" from drifting apart.
 */

export function useEnrolledFingerprints() {
  return useQuery({
    queryKey: ["vault-status"],
    queryFn: getVaultStatus,
    select: (status) => ({
      enabled: status.enabled,
      fingerprints: new Set(status.credentials.map((entry) => entry.connectionFingerprint)),
    }),
  });
}

export function EnrolConnection({
  connection,
  onEnrolled,
  compact,
}: {
  /** The budget that needs enrolling. Usually the active connection. */
  connection: ConnectionInstance | null;
  onEnrolled?: () => void;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const active = useConnectionStore(selectActiveInstance);
  const [showDetail, setShowDetail] = useState(false);
  const vault = useEnrolledFingerprints();

  const enrol = useMutation({
    mutationFn: async () => {
      if (!connection || !isHttpApiConnection(connection)) {
        throw new Error("Only HTTP API connections can be enrolled.");
      }
      return enrollCredential({
        connectionFingerprint: connectionFingerprint(connection),
        mode: "http-api",
        baseUrl: connection.baseUrl,
        budgetSyncId: connection.budgetSyncId,
        label: connection.label,
        secret: {
          apiKey: connection.apiKey,
          ...(connection.encryptionPassword
            ? { encryptionPassword: connection.encryptionPassword }
            : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success(`${connection?.label ?? "This budget"} can now be used unattended`);
      void queryClient.invalidateQueries({ queryKey: ["vault-status"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-connections"] });
      onEnrolled?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (vault.isLoading || !vault.data) return null;

  const box = "rounded-md border border-amber-400/40 bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200";

  if (!vault.data.enabled) {
    return (
      <div className={box}>
        <span className="font-medium">Unattended access is not configured on this server.</span>{" "}
        Set <code className="rounded bg-black/5 px-1 dark:bg-white/10">SYNC_VAULT_KEY</code> and
        restart Bench. Until then, anything scheduled can only run while Bench is open in a tab.
      </div>
    );
  }

  if (!connection) return null;

  if (!isHttpApiConnection(connection)) {
    return (
      <div className={box}>
        <span className="font-medium">{connection.label} is a Direct connection.</span> Actual&rsquo;s
        engine runs in your browser there, so there is nothing on the server to run when the tab is
        closed. Connect through an Actual HTTP API server to schedule work against this budget.
      </div>
    );
  }

  if (vault.data.fingerprints.has(connectionFingerprint(connection))) return null;

  // Only the connection the browser is currently using carries an API key.
  const isActive = active?.id === connection.id;
  if (!isActive) {
    return (
      <div className={box}>
        <span className="font-medium">{connection.label} is not enrolled for unattended access.</span>{" "}
        Bench can only enrol the budget you are connected to right now, because that is the only one
        whose key your browser holds. Switch to it, then enrol it here.
      </div>
    );
  }

  return (
    <div className={box}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{connection.label} is not enrolled for unattended access.</span>{" "}
          {compact
            ? "Scheduled work runs with your browser closed."
            : "Anything scheduled against it runs with your browser closed, so Bench needs this budget's API key stored on the server."}
        </span>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => enrol.mutate()}
          disabled={enrol.isPending}
        >
          {enrol.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
          Enrol {connection.label}
        </Button>
      </div>

      <button
        type="button"
        className="mt-1 underline underline-offset-4"
        onClick={() => setShowDetail((current) => !current)}
      >
        {showDetail ? "Hide details" : "What gets stored?"}
      </button>

      {showDetail && (
        <ul className="mt-1 space-y-0.5 pl-4">
          <li className="list-disc">
            This budget&rsquo;s API key{connection.encryptionPassword ? " and its encryption password" : ""},
            encrypted with the server&rsquo;s <code className="rounded bg-black/5 px-1 dark:bg-white/10">SYNC_VAULT_KEY</code>.
            The key itself is never stored beside them.
          </li>
          <li className="list-disc">Nothing else: no budget data, and no other budget on this server.</li>
          <li className="list-disc">
            Withdraw it whenever you like, from Automations &rarr; Connections. Anything relying on it
            stops and says so.
          </li>
        </ul>
      )}
    </div>
  );
}
