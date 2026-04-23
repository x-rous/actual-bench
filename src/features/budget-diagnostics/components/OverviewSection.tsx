import { AlertCircle, CheckCircle2, Database, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DownloadResult } from "@/lib/api/client";
import type { ConnectionInstance } from "@/store/connection";
import type { OverviewPayload, ProgressStage } from "../types";
import { buildOverviewMetrics, formatBytes } from "../lib/fileOverviewStats";
import { MetadataSummary } from "./MetadataSummary";
import { OpenSnapshotPanel } from "./OpenSnapshotPanel";

type OverviewSectionProps = {
  connection: ConnectionInstance;
  overview: OverviewPayload | null;
  download: DownloadResult | null;
  status: "idle" | "loading" | "ready" | "error";
  diagnosticsStatus: "idle" | "loading" | "ready" | "error";
  progressStage: ProgressStage | null;
  errorMessage: string | null;
  diagnosticsErrorMessage: string | null;
  onRetry: () => void;
};

function fallbackZipFilename(connection: ConnectionInstance): string {
  return `budget-${connection.budgetSyncId}-${new Date().toISOString().slice(0, 10)}.zip`;
}

function displayZipFilename(filename: string): string {
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function downloadZip(download: DownloadResult, connection: ConnectionInstance) {
  const blob = new Blob([download.bytes], {
    type: download.contentType || "application/zip",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename ?? fallbackZipFilename(connection);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function StatusBadge({ overview }: { overview: OverviewPayload }) {
  return overview.file.opened && overview.file.zipValid ? (
    <Badge variant="status-active" className="gap-1">
      <CheckCircle2 data-icon="inline-start" />
      Opened
    </Badge>
  ) : (
    <Badge variant="status-warning" className="gap-1">
      <AlertCircle data-icon="inline-start" />
      Needs attention
    </Badge>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-muted/12 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

export function OverviewSection({
  connection,
  overview,
  download,
  status,
  diagnosticsStatus,
  progressStage,
  errorMessage,
  diagnosticsErrorMessage,
  onRetry,
}: OverviewSectionProps) {
  const metrics = overview ? buildOverviewMetrics(overview) : [];
  const canDownload = Boolean(download && overview);
  const showProgressPanel = status === "loading" || diagnosticsStatus === "loading";

  return (
    <section className="bg-background">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Exported snapshot summary, metadata, and file details.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canDownload}
          onClick={() => {
            if (download) downloadZip(download, connection);
          }}
        >
          <Download data-icon="inline-start" />
          Download ZIP
        </Button>
      </div>

      <div className="mt-5 space-y-5">
        {showProgressPanel && (
          <OpenSnapshotPanel
            status="loading"
            stage={progressStage}
            errorMessage={null}
            onRetry={onRetry}
          />
        )}
        {(status === "error" || diagnosticsStatus === "error") && (
          <OpenSnapshotPanel
            status="error"
            stage={progressStage}
            errorMessage={
              diagnosticsStatus === "error"
                ? (diagnosticsErrorMessage ?? errorMessage)
                : errorMessage
            }
            onRetry={onRetry}
          />
        )}

        {overview && (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Snapshot counts</h3>
                <StatusBadge overview={overview} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {metrics.map((metric) => (
                  <div
                    key={metric.id}
                    className="min-h-24 rounded-md border border-border/70 bg-muted/12 p-3"
                  >
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {metric.label}
                    </div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight">
                      {metric.value}
                    </div>
                    {metric.detail && (
                      <div className="mt-1 text-xs text-muted-foreground">{metric.detail}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Metadata</h3>
              <div className="rounded-md border border-border/70 bg-muted/12 p-4">
                <MetadataSummary metadata={overview.metadata} />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">File / source</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <DetailRow
                  label="Export source"
                  value={`/v1/budgets/${connection.budgetSyncId}/export`}
                />
                <DetailRow
                  label="ZIP filename"
                  value={displayZipFilename(
                    overview.file.zipFilename ?? fallbackZipFilename(connection)
                  )}
                />
                <DetailRow label="ZIP size" value={formatBytes(overview.file.zipSizeBytes)} />
                <DetailRow label="db.sqlite size" value={formatBytes(overview.file.dbSizeBytes)} />
                <DetailRow
                  label="Metadata present"
                  value={overview.file.hadMetadata ? "Yes" : "No"}
                />
                <DetailRow
                  label="ZIP structure"
                  value={overview.file.zipValid ? "Valid" : "Invalid"}
                />
                <DetailRow
                  label="Database opened"
                  value={overview.file.opened ? "Yes" : "No"}
                />
                <DetailRow label="Connection" value={connection.label} />
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
