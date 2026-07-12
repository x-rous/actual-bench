"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isHttpApiConnection, type ConnectionInstance } from "@/store/connection";
import { enrollCredential, getVaultStatus, withdrawCredential } from "../lib/syncApi";

/**
 * Credential enrollment for unattended server sync (RD-058 / PR-024d). Shown when
 * a flow's policy is `auto_sync_unattended`. It stores the source + target HTTP
 * API keys in the server vault so the scheduler can run with the app closed, and
 * is explicit about exactly what gets persisted.
 */
export function UnattendedEnrollment({
  sourceConnection,
  targetConnection,
}: {
  sourceConnection?: ConnectionInstance;
  targetConnection?: ConnectionInstance;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getVaultStatus();
      setEnabled(res.enabled);
      setEnrolled(new Set(res.credentials.map((c) => c.connectionFingerprint)));
    } catch {
      setEnabled(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const httpEndpoints = [sourceConnection, targetConnection].filter(
    (c): c is ConnectionInstance => isHttpApiConnection(c)
  );
  const bothHttp = httpEndpoints.length === 2;
  const bothEnrolled = bothHttp && httpEndpoints.every((c) => enrolled.has(connectionFingerprint(c)));

  const enrollAll = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const conn of httpEndpoints) {
        if (!isHttpApiConnection(conn)) continue;
        await enrollCredential({
          connectionFingerprint: connectionFingerprint(conn),
          mode: "http-api",
          baseUrl: conn.baseUrl,
          budgetSyncId: conn.budgetSyncId,
          label: conn.label,
          secret: {
            apiKey: conn.apiKey,
            ...(conn.encryptionPassword ? { encryptionPassword: conn.encryptionPassword } : {}),
          },
        });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not store the credentials.");
    } finally {
      setBusy(false);
    }
  };

  const withdrawAll = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const conn of httpEndpoints) {
        await withdrawCredential(connectionFingerprint(conn));
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the credentials.");
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) return null;

  const box = "flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs";

  if (!enabled) {
    return (
      <div className={box}>
        <span className="font-medium text-amber-600 dark:text-amber-400">Server vault is not configured.</span>
        <span className="text-muted-foreground">
          Set the <code className="rounded bg-muted px-1">SYNC_VAULT_KEY</code> environment variable on the server to
          enable unattended sync. Until then this flow can only run while the app is open.
        </span>
      </div>
    );
  }

  if (!bothHttp) {
    return (
      <div className={box}>
        <span className="text-muted-foreground">
          Unattended sync runs on the server, so both the source and target must be <strong>HTTP API</strong>{" "}
          connections. Direct connections can only sync while the app is open.
        </span>
      </div>
    );
  }

  return (
    <div className={box}>
      <span className="flex items-center gap-1.5 font-medium">
        <ShieldCheck className="h-3.5 w-3.5" /> Stored credentials
        {bothEnrolled && <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />}
      </span>
      <span className="text-muted-foreground">
        To run with the app closed, the server stores each budget&apos;s <strong>API key</strong> (encrypted with{" "}
        <code className="rounded bg-muted px-1">SYNC_VAULT_KEY</code>). It is never shown again and never sent back to
        the browser.
      </span>
      <div className="flex items-center gap-2 pt-1">
        {bothEnrolled ? (
          <Button size="sm" variant="outline" onClick={withdrawAll} disabled={busy}>
            {busy ? "Removing…" : "Remove stored credentials"}
          </Button>
        ) : (
          <Button size="sm" onClick={enrollAll} disabled={busy}>
            {busy ? "Storing…" : "Store credentials for unattended sync"}
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {bothEnrolled ? "Both budgets are enrolled." : "Both budgets must be enrolled to run unattended."}
        </span>
      </div>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
