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
 * so the server needs that budget's credentials stored: an API key for an HTTP
 * API connection, the Actual server's password for a Direct one (RD-095 M4).
 * That has always been true; what was wrong was where you could do it. The only path ran through a Budget
 * File Sync flow editor, so someone setting up a backup was sent to a feature
 * they may never use, losing the dialog they were filling in.
 *
 * This is that action, in one component, usable wherever the need appears. The
 * server checks the credentials against the Actual server before storing
 * anything, so enrolling takes a moment and can fail with a reason.
 *
 * Two limits it states rather than hides:
 *
 *   * Bench can only enrol the connection you are **currently connected as**,
 *     because that is the only key or password the browser holds. Any other budget has
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
  allowDirect = false,
}: {
  /** The budget that needs enrolling. Usually the active connection. */
  connection: ConnectionInstance | null;
  onEnrolled?: () => void;
  compact?: boolean;
  /**
   * Offer enrolment for a Direct connection. Only where something can use it:
   * Connections today; the backup and bank-sync dialogs once their jobs run
   * Direct budgets.
   */
  allowDirect?: boolean;
}) {
  const queryClient = useQueryClient();
  const active = useConnectionStore(selectActiveInstance);
  const [showDetail, setShowDetail] = useState(false);
  const vault = useEnrolledFingerprints();

  const enrol = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error("There is no connection to enrol.");
      const encryption = connection.encryptionPassword ? { encryptionPassword: connection.encryptionPassword } : {};
      return enrollCredential({
        connectionFingerprint: connectionFingerprint(connection),
        mode: connection.mode,
        baseUrl: connection.baseUrl,
        budgetSyncId: connection.budgetSyncId,
        label: connection.label,
        secret: isHttpApiConnection(connection)
          ? { apiKey: connection.apiKey, ...encryption }
          : { serverPassword: connection.serverPassword, ...encryption },
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

  const direct = !isHttpApiConnection(connection);
  if (direct && !allowDirect) {
    return (
      <div className={box}>
        <span className="font-medium">{connection.label} is a Direct connection.</span> Scheduling this
        with the browser closed is not available for Direct connections yet. Connect through an Actual
        HTTP API server to schedule work against this budget now.
      </div>
    );
  }

  if (vault.data.fingerprints.has(connectionFingerprint(connection))) return null;

  // Only the connection the browser is currently using carries its key or password.
  const isActive = active?.id === connection.id;
  if (!isActive) {
    return (
      <div className={box}>
        <span className="font-medium">{connection.label} is not enrolled for unattended access.</span>{" "}
        Bench can only enrol the budget you are connected to right now, because that is the only one
        whose {direct ? "password" : "key"} your browser holds. Switch to it, then enrol it here.
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
            : direct
              ? "Anything scheduled against it runs with your browser closed, so Bench needs the Actual server's password stored on the server."
              : "Anything scheduled against it runs with your browser closed, so Bench needs this budget's API key stored on the server."}
        </span>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => enrol.mutate()}
          disabled={enrol.isPending}
        >
          {enrol.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
          {enrol.isPending ? "Checking with the server..." : `Enrol ${connection.label}`}
        </Button>
      </div>

      {enrol.isPending && (
        <p className="mt-1" role="status">
          Bench is checking {direct ? "the password" : "the key"} with the server
          {direct ? " by opening the budget, which can take up to a minute" : ""}. Nothing is stored unless
          it works.
        </p>
      )}

      <button
        type="button"
        className="mt-1 underline underline-offset-4"
        onClick={() => setShowDetail((current) => !current)}
      >
        {showDetail ? "Hide details" : "What gets stored?"}
      </button>

      {showDetail && (
        <ul className="mt-1 space-y-0.5 pl-4">
          {direct ? (
            <>
              <li className="list-disc">
                The Actual server&rsquo;s password{connection.encryptionPassword ? " and this budget's encryption password" : ""},
                encrypted with the server&rsquo;s <code className="rounded bg-black/5 px-1 dark:bg-white/10">SYNC_VAULT_KEY</code>.
                The key itself is never stored beside them.
              </li>
              <li className="list-disc">
                The password, not a login session: Actual&rsquo;s session never expires and survives a password
                change, while a stored password stops working the moment you change it.
              </li>
              <li className="list-disc">
                One password serves every enrolled budget on this server. After changing it, enrol any one of
                them again to update them all.
              </li>
            </>
          ) : (
            <li className="list-disc">
              This budget&rsquo;s API key{connection.encryptionPassword ? " and its encryption password" : ""},
              encrypted with the server&rsquo;s <code className="rounded bg-black/5 px-1 dark:bg-white/10">SYNC_VAULT_KEY</code>.
              The key itself is never stored beside them.
            </li>
          )}
          <li className="list-disc">It is checked with the server first. Nothing is stored unless it works.</li>
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
