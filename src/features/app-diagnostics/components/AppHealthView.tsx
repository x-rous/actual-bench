"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Database, HardDrive, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import type { AppDbHealth } from "@/lib/app-db/types";
import type { AppDbStorageUsage } from "@/lib/app-db/storageUsage";

async function fetchAppDbHealth(): Promise<AppDbHealth> {
  const response = await fetch("/api/app-db/health", { cache: "no-store" });
  const data = (await response.json()) as AppDbHealth;
  if (!response.ok) {
    throw new Error(data.error ?? `App DB health request failed (${response.status})`);
  }
  return data;
}

async function fetchAppDbStorage(): Promise<AppDbStorageUsage> {
  const response = await fetch("/api/app-db/storage", { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `App DB storage request failed (${response.status})`);
  }
  return (await response.json()) as AppDbStorageUsage;
}

type AutomationHealthSummary = {
  checkedAt: string;
  singleInstance: boolean;
  vaultEnabled: boolean;
  runningIds: string[];
  overall: "ok" | "warning" | "failing" | "paused" | "idle";
  automations: {
    id: string;
    name: string;
    typeLabel: string;
    status: "ok" | "warning" | "failing" | "paused" | "idle";
    summary: string;
    schedule: string;
    executionMode: "browser" | "server";
    nextRunAt: string | null;
    stale: boolean;
  }[];
};
type VaultStatus = { enabled: boolean; credentials: { connectionFingerprint: string; label: string; budgetSyncId: string }[] };

async function fetchAutomationHealth(): Promise<AutomationHealthSummary> {
  const res = await fetch("/api/automations/health", { cache: "no-store" });
  if (!res.ok) throw new Error(`Automation health request failed (${res.status})`);
  return (await res.json()) as AutomationHealthSummary;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Loaded on request, not with the page: counting every table is a scan, and
 * App health polls. Rows rather than per-table bytes because SQLite does not
 * report per-table size without the dbstat extension, and the row count is the
 * number that actually explains a growing file here anyway.
 */
function StorageUsagePanel() {
  const [requested, setRequested] = useState(false);
  const query = useQuery({
    queryKey: ["app-db-storage"],
    queryFn: fetchAppDbStorage,
    enabled: requested,
  });

  if (!requested) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          See how large this database is and which tables hold the rows.
        </p>
        <Button size="sm" variant="outline" onClick={() => setRequested(true)}>
          <HardDrive aria-hidden /> Check size
        </Button>
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div className="border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">Measuring…</div>
    );
  }

  if (query.isError) {
    return (
      <div className="border-t border-border/60 px-4 py-3 text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Could not measure the database"}
      </div>
    );
  }

  const usage = query.data;
  const populated = usage.tables.filter((table) => table.rows > 0);

  return (
    <>
      {/* Data first, because it is the number people are actually after, and
          the one that matches a downloaded backup. Leading with bytes-on-disk
          meant a file holding 9 MB of data announcing itself as 310 MB. */}
      <DetailRow label="Data" value={formatBytes(usage.dataBytes)} />
      <DetailRow
        label="Taking up on disk"
        value={
          <span>
            {formatBytes(usage.totalBytes)}
            <span className="text-muted-foreground">
              {" "}
              ({formatBytes(usage.fileBytes)} file
              {usage.walBytes > 0 && <> + {formatBytes(usage.walBytes)} write-ahead log</>})
            </span>
          </span>
        }
      />
      <DetailRow
        label="Reclaimable"
        value={
          usage.freePages === 0 ? (
            "None - the file is about as small as its contents allow"
          ) : (
            <span>
              {formatBytes(usage.freeBytes)} freed by deleted rows, not yet returned to the disk.
              <span className="text-muted-foreground">
                {" "}
                {usage.autoVacuum === "incremental"
                  ? "Reclaimed as automations run, and on the next restart."
                  : "Reclaimed on the next restart."}
              </span>
            </span>
          )
        }
      />
      <DetailRow
        label="Rows by table"
        value={
          populated.length === 0 ? (
            "Empty"
          ) : (
            <ul className="grid gap-0.5">
              {populated.map((table) => (
                <li key={table.name} className="flex justify-between gap-4 tabular-nums">
                  <code className="text-xs">{table.name}</code>
                  <span>{table.rows.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )
        }
      />
      <div className="flex items-center justify-end border-t border-border/60 px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw aria-hidden className={query.isFetching ? "animate-spin" : undefined} /> Re-check
        </Button>
      </div>
    </>
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
        {health.ready && <StorageUsagePanel />}
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

const AUTOMATION_STATUS_BADGE = {
  ok: { variant: "status-active" as const, label: "Healthy" },
  warning: { variant: "status-warning" as const, label: "Needs attention" },
  failing: { variant: "destructive" as const, label: "Failing" },
  paused: { variant: "status-warning" as const, label: "Paused" },
  idle: { variant: "secondary" as const, label: "Idle" },
};

/**
 * Automations, from the engine's own health accessor (RD-079 / PR-043e).
 *
 * Replaces the RD-058 "unattended sync scheduler" card, which read a single
 * global snapshot blob and could only describe sync. There is one source of
 * truth for automation health now, and this card and the Automations page both
 * read it — two cards disagreeing about whether something ran is worse than one
 * card with less detail.
 */
function AutomationsCard() {
  const health = useQuery({ queryKey: ["automation-health"], queryFn: fetchAutomationHealth });
  const vault = useQuery({ queryKey: ["sync-vault-status"], queryFn: fetchVaultStatus });

  const report = health.data;
  const vaultEnabled = report?.vaultEnabled ?? vault.data?.enabled ?? false;
  // An unknown status must not blank the card: the response is JSON from a
  // server that may be a different version, so the lookup is defended.
  const badge = health.isError
    ? { variant: "status-warning" as const, label: "Unknown" }
    : AUTOMATION_STATUS_BADGE[report?.overall ?? "idle"] ?? AUTOMATION_STATUS_BADGE.idle;

  return (
    <section className="rounded-md border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Automations</h2>
        </div>
        <Badge variant={badge.variant} className="text-[10px]">
          {badge.label}
        </Badge>
      </div>
      <dl>
        <DetailRow
          label="Credential vault"
          value={
            vaultEnabled
              ? "Configured (SYNC_VAULT_KEY set)"
              : "Disabled - automations that need stored credentials will pause until SYNC_VAULT_KEY is set"
          }
        />
        <DetailRow label="Enrolled connections" value={vault.data ? String(vault.data.credentials.length) : "-"} />
        <DetailRow label="Checked" value={formatDate(report?.checkedAt ?? null)} />
        <DetailRow
          label="Running now"
          value={report && report.runningIds.length > 0 ? String(report.runningIds.length) : "Nothing running"}
        />
        <DetailRow
          label="Automations"
          value={
            health.isError ? (
              // Distinguish "nothing is configured" from "we could not ask".
              // During an outage the first reads as reassurance and is wrong.
              <span className="text-destructive">
                Status unavailable - {(health.error as Error).message}
              </span>
            ) : !report || report.automations.length === 0 ? (
              "None configured"
            ) : (
              <ul className="flex flex-col gap-1.5">
                {report.automations.map((automation) => (
                  <li key={automation.id} className="break-words">
                    <span className="font-medium">{automation.name}</span>{" "}
                    <span className="text-muted-foreground">
                      ({automation.typeLabel} · {automation.schedule} ·{" "}
                      {automation.executionMode === "server" ? "server" : "browser only"})
                    </span>
                    <br />
                    <span className={automation.status === "ok" ? "text-muted-foreground" : undefined}>
                      {automation.summary}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        />
      </dl>
      <div className="flex items-start gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Automations run inside this single Actual Bench process. Running more than one instance
          against the same database would run them more than once.
        </span>
      </div>
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
        <AutomationsCard />
      </div>
    </PageLayout>
  );
}
