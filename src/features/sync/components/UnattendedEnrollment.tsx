"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, PlayCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isHttpApiConnection, type ConnectionInstance } from "@/store/connection";
import { enrollCredential, getVaultStatus, runFlowNow, withdrawCredential } from "../lib/syncApi";
import { useFlowAutomations } from "../hooks/useFlowAutomations";
import { computeUnattendedStatus, nextRunPhrase } from "../lib/unattendedStatus";

/**
 * Credential enrollment for unattended server sync (RD-058 / PR-024d). Shown when
 * a flow's policy is `auto_sync_unattended`. It stores the source + target
 * credentials (API key or Actual server password) in the server vault so the
 * scheduler can run with the app closed, and
 * is explicit about exactly what gets persisted. It also surfaces the armed
 * state, the next run, and a "Run now" action so the flow is not a black box.
 */
export function UnattendedEnrollment({
  sourceConnection,
  targetConnection,
  flowId,
  intervalMinutes,
  flowEnabled,
  autoPaused,
  lastRunAtMs = null,
  onRan,
}: {
  sourceConnection?: ConnectionInstance;
  targetConnection?: ConnectionInstance;
  /** Saved flow id; absent for an unsaved new flow (disables Run now). */
  flowId?: string;
  intervalMinutes: number;
  flowEnabled: boolean;
  autoPaused: boolean;
  lastRunAtMs?: number | null;
  onRan?: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ status: string; message: string | null } | null>(null);
  const enginePauses = useFlowAutomations();

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

  // Either mode can run on the server (RD-095): an HTTP API budget with its
  // API key, a Direct one with the Actual server's password.
  const endpoints = [sourceConnection, targetConnection].filter((c): c is ConnectionInstance => !!c);
  const bothChosen = endpoints.length === 2;
  const bothEnrolled = bothChosen && endpoints.every((c) => enrolled.has(connectionFingerprint(c)));

  const enrollAll = async () => {
    setBusy(true);
    setError(null);
    try {
      // One at a time, and only what is missing: each is checked with its
      // server before it is saved.
      for (const conn of endpoints) {
        if (enrolled.has(connectionFingerprint(conn))) continue;
        const encryption = conn.encryptionPassword ? { encryptionPassword: conn.encryptionPassword } : {};
        await enrollCredential({
          connectionFingerprint: connectionFingerprint(conn),
          mode: conn.mode,
          baseUrl: conn.baseUrl,
          budgetSyncId: conn.budgetSyncId,
          label: conn.label,
          secret: isHttpApiConnection(conn)
            ? { apiKey: conn.apiKey, ...encryption }
            : { serverPassword: conn.serverPassword, ...encryption },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the credentials.");
    } finally {
      // Always resync UI state - a partial enrollment still changed the vault.
      await refresh();
      setBusy(false);
    }
  };

  const withdrawAll = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const conn of endpoints) {
        await withdrawCredential(connectionFingerprint(conn));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the credentials.");
    } finally {
      // Always resync UI state - a partial withdrawal still changed the vault.
      await refresh();
      setBusy(false);
    }
  };

  const doRunNow = async () => {
    if (!flowId) return;
    setRunning(true);
    setRunResult(null);
    try {
      const { result } = await runFlowNow(flowId);
      setRunResult(result);
      onRan?.();
    } catch (e) {
      setRunResult({ status: "error", message: e instanceof Error ? e.message : "Run failed" });
    } finally {
      setRunning(false);
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

  if (!bothChosen) {
    return (
      <div className={box}>
        <span className="text-muted-foreground">Choose the source and target budgets first.</span>
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
        To run when Bench is closed, Bench saves each budget&apos;s API key or Actual server password, encrypted with
        Bench&apos;s vault key (<code className="rounded bg-muted px-1">SYNC_VAULT_KEY</code>). Each one is checked
        with its server first. It is never shown again or sent to your browser.
      </span>
      <div className="flex items-center gap-2 pt-1">
        {bothEnrolled ? (
          <Button size="sm" variant="outline" onClick={withdrawAll} disabled={busy}>
            {busy ? "Removing…" : "Remove stored credentials"}
          </Button>
        ) : (
          <Button size="sm" onClick={enrollAll} disabled={busy}>
            {busy ? "Checking…" : "Store credentials for unattended sync"}
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {bothEnrolled ? "Both budgets are enrolled." : "Both budgets must be enrolled to run unattended."}
        </span>
      </div>
      {error && <span className="text-destructive">{error}</span>}

      {(() => {
        const status = computeUnattendedStatus({
          reviewPolicy: "auto_sync_unattended",
          flowEnabled,
          autoPaused,
          // The engine can have health-paused this flow's automation; without
          // reading that, this panel reported "Armed" for a flow that was not
          // going to run, and offered a next-run time to match.
          enginePause: flowId ? (enginePauses.get(flowId) ?? null) : null,
          vaultEnabled: enabled,
          bothEnrolled,
          lastRunAtMs,
          intervalMinutes,
          nowMs: Date.now(),
        });
        return (
          <div className="mt-1 flex flex-col gap-2 border-t border-border/60 pt-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${status.armed ? "bg-green-500" : "bg-amber-500"}`}
                aria-hidden
              />
              <span className="font-medium">{status.armed ? "Armed - runs unattended" : "Not armed"}</span>
            </div>
            <span className="text-muted-foreground">{nextRunPhrase(status, Date.now())}</span>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button
                size="sm"
                variant="outline"
                onClick={doRunNow}
                disabled={running || !status.armed || !flowId}
                title={!flowId ? "Save the flow first" : !status.armed ? status.reason ?? "" : "Run this flow on the server now"}
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                {running ? "Running…" : "Run now"}
              </Button>
              {!flowId && <span className="text-[11px] text-muted-foreground">Save the flow to enable Run now.</span>}
              {/* A flow set to unattended becomes an automation, and every run
                  it makes is recorded there - but nothing here said so, so the
                  history was reachable only by knowing it existed. */}
              {flowId && status.armed && (
                <Link
                  href="/automations/runs"
                  className="text-[11px] text-primary underline-offset-4 hover:underline"
                >
                  Run history
                </Link>
              )}
              {runResult && (
                <span className="text-[11px] text-muted-foreground">
                  Run finished: <strong>{runResult.status}</strong>
                  {runResult.message ? ` - ${runResult.message}` : ""}
                </span>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
