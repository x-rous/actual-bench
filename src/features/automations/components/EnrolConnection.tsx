"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isHttpApiConnection } from "@/store/connection";
import { enrollCredential, getVaultStatus } from "@/features/sync/lib/syncApi";
import type { ConnectionInstance } from "@/store/connection";

/**
 * Enrolling a budget for unattended access (RD-058, relocated).
 *
 * A scheduled anything - sync, bank pull, backup - runs with the browser closed,
 * so the server needs that budget's credentials stored: an API key for an HTTP
 * API connection, the Actual server's password for a Direct one (RD-095 M4).
 * That has always been true; what was wrong was where you could do it. The
 * only path ran through a Budget File Sync flow editor, so someone setting up a
 * backup was sent to a feature they may never use, losing the dialog they were
 * filling in.
 *
 * This is that action, in one component, usable wherever the need appears. The
 * server checks the credentials against the Actual server before storing
 * anything, so enrolling takes a moment and can fail with a reason.
 *
 * Any budget connected in this session can be enrolled, not only the open one:
 * the browser holds each one's key or password for the session (RD-095 M5).
 *
 * One limit it states rather than hides: enrolment is per budget, not per server. Three budgets means three
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
  allowDirect = false,
  onConnectionsPage = false,
}: {
  /** The budget that needs enrolling. Usually the active connection. */
  connection: ConnectionInstance | null;
  onEnrolled?: () => void;
  /** Shown on Automations > Connections itself, where removing it happens. */
  onConnectionsPage?: boolean;
  /**
   * Offer enrolment for a Direct connection. Only where something can use it:
   * Connections today; the backup and bank-sync dialogs once their jobs run
   * Direct budgets.
   */
  allowDirect?: boolean;
}) {
  const queryClient = useQueryClient();
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
      toast.success(`${connection?.label ?? "This budget"} is set up for scheduled runs`);
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

  const notSetUp = <span className="font-medium">{connection.label} is not set up for scheduled runs.</span>;

  const vaultKey = <code className="rounded bg-black/5 px-1 dark:bg-white/10">SYNC_VAULT_KEY</code>;
  const secret = direct ? "password" : "API key";
  const removeWhere = onConnectionsPage ? "on this page" : "in Automations \u2192 Connections";

  return (
    <div className={box}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          {notSetUp} Enrol it to let automations run when Bench is closed.
        </span>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => enrol.mutate()}
          disabled={enrol.isPending}
        >
          {enrol.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
          {enrol.isPending ? "Checking..." : `Enrol ${connection.label}`}
        </Button>
      </div>

      {enrol.isPending && (
        <p className="mt-1" role="status">
          Checking with your Actual server. This usually takes a few seconds, but can take a few minutes the
          first time. Nothing is saved if the check fails.
        </p>
      )}

      <button
        type="button"
        className="mt-1 underline underline-offset-4"
        onClick={() => setShowDetail((current) => !current)}
      >
        {showDetail ? "Hide details" : "What gets saved?"}
      </button>

      {showDetail && (
        <ul className="mt-1 space-y-0.5 pl-4">
          <li className="list-disc">
            {direct ? "Your Actual server password" : "This budget\u2019s API key"} is encrypted with Bench&rsquo;s vault key
            ({vaultKey}) and saved.
          </li>
          <li className="list-disc">
            The vault key is kept in the server settings, not in Bench&rsquo;s database, so someone with a copy of the
            database cannot read the {secret}. Keep the vault key private.
          </li>
          <li className="list-disc">
            Bench only unlocks the {secret} on the server when an automation runs. It is never shown again or sent to
            your browser.
          </li>
          <li className="list-disc">
            If your budget has an encryption password, it is saved the same way. No budget data is saved.
          </li>
          <li className="list-disc">
            If you change {direct ? "your Actual server password" : "the API key"}, automations for budgets on that
            server stop running. Enrol one of those budgets again to save the new {secret} for all of them.
          </li>
          <li className="list-disc">
            You can remove it {removeWhere} at any time. Automations that use it will stop running until you enrol
            again.
          </li>
        </ul>
      )}
    </div>
  );
}
