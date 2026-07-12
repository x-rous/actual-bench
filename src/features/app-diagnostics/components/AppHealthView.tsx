"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Database, HardDrive, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import type { AppDbHealth } from "@/lib/app-db/types";

async function fetchAppDbHealth(): Promise<AppDbHealth> {
  const response = await fetch("/api/app-db/health", { cache: "no-store" });
  const data = (await response.json()) as AppDbHealth;
  if (!response.ok) {
    throw new Error(data.error ?? `App DB health request failed (${response.status})`);
  }
  return data;
}

type SchedulerState = {
  enabled: boolean;
  lastTickAt: string | null;
  inFlight: string[];
  pausedByHealth: string[];
  lastResults: Record<string, { status: string; at: string; message?: string }>;
};
type VaultStatus = { enabled: boolean; credentials: { connectionFingerprint: string; label: string; budgetSyncId: string }[] };

async function fetchSchedulerState(): Promise<SchedulerState> {
  const res = await fetch("/api/sync/scheduler/tick", { cache: "no-store" });
  if (!res.ok) throw new Error(`Scheduler status request failed (${res.status})`);
  return (await res.json()) as SchedulerState;
}
async function fetchVaultStatus(): Promise<VaultStatus> {
  const res = await fetch("/api/sync-credentials", { cache: "no-store" });
  if (!res.ok) throw new Error(`Vault status request failed (${res.status})`);
  return (await res.json()) as VaultStatus;
}

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-border/60 px-4 py-3 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  );
}

function HealthStatus({ health }: { health: AppDbHealth }) {
  if (health.ready) {
    return (
      <Badge variant="status-active" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </Badge>
    );
  }

  return (
    <Badge variant="status-warning" className="gap-1">
      <AlertTriangle className="h-3 w-3" />
      Unavailable
    </Badge>
  );
}

function AppDatabaseCard({ health }: { health: AppDbHealth }) {
  return (
    <section className="rounded-md border border-border bg-background shadow-sm">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">App metadata database</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Stores Actual Bench workflow metadata only. Actual credentials are not saved here.
            </p>
          </div>
        </div>
        <HealthStatus health={health} />
      </div>

      <dl>
        <DetailRow label="Path" value={<code className="text-xs">{health.configuredPath}</code>} />
        <DetailRow label="Writable" value={health.writable ? "Yes" : "No"} />
        <DetailRow label="Schema" value={`${health.schemaVersion ?? "Not initialized"} / ${health.latestSchemaVersion}`} />
        <DetailRow label="Migrated" value={formatDate(health.lastMigratedAt)} />
        <DetailRow label="Runtime" value={health.runtime === "vercel" ? "Vercel / non-durable filesystem" : "Node.js self-hosted"} />
        <DetailRow label="Persistence" value={health.durable ? "Persistent when /data is mounted" : "Not durable without external storage"} />
      </dl>

      {health.error && (
        <div className="border-t border-amber-400/30 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          {health.error}
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Back up the Docker volume mounted at /data to preserve app metadata.</span>
      </div>
    </section>
  );
}

function UnattendedSyncCard() {
  const scheduler = useQuery({ queryKey: ["sync-scheduler-state"], queryFn: fetchSchedulerState });
  const vault = useQuery({ queryKey: ["sync-vault-status"], queryFn: fetchVaultStatus });
  const state = scheduler.data;
  const enabled = state?.enabled ?? vault.data?.enabled ?? false;
  const paused = state?.pausedByHealth ?? [];
  const results = Object.entries(state?.lastResults ?? {});

  return (
    <section className="rounded-md border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Unattended sync scheduler</h2>
        </div>
        <Badge variant={enabled ? "status-active" : "secondary"} className="text-[10px]">
          {enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>
      <dl>
        <DetailRow
          label="Vault"
          value={enabled ? "Configured (SYNC_VAULT_KEY set)" : "Disabled - set SYNC_VAULT_KEY to enable unattended sync"}
        />
        <DetailRow label="Enrolled connections" value={vault.data ? String(vault.data.credentials.length) : "-"} />
        <DetailRow label="Last scheduler tick" value={formatDate(state?.lastTickAt ?? null)} />
        <DetailRow
          label="Paused by health"
          value={paused.length === 0 ? "None" : paused.join(", ")}
        />
        <DetailRow
          label="Recent runs"
          value={
            results.length === 0 ? (
              "No unattended runs yet"
            ) : (
              <ul className="flex flex-col gap-1">
                {results.map(([flowId, r]) => (
                  <li key={flowId} className="break-words">
                    <span className="font-mono text-xs">{flowId.slice(0, 8)}</span>: {r.status}
                    {r.message && <span className="text-muted-foreground"> — {r.message}</span>}
                  </li>
                ))}
              </ul>
            )
          }
        />
      </dl>
    </section>
  );
}

export function AppHealthView() {
  const query = useQuery({
    queryKey: ["app-db-health"],
    queryFn: fetchAppDbHealth,
  });

  const actions = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void query.refetch()}
      disabled={query.isFetching}
      aria-label="Refresh app health"
    >
      <RefreshCw className={query.isFetching ? "animate-spin" : undefined} />
      Refresh
    </Button>
  );

  return (
    <PageLayout
      title="App Health"
      actions={actions}
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 lg:p-5">
        {query.data && <AppDatabaseCard health={query.data} />}
        <UnattendedSyncCard />
      </div>
    </PageLayout>
  );
}
