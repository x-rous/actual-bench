"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  HardDrive,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { cn } from "@/lib/utils";
import {
  backUpNow,
  deleteDestination,
  deletePolicy,
  discoverBackups,
  fetchRecoveryCenter,
  previewRetention,
  scrubNow,
  testDestination,
} from "../lib/backupsApi";
import {
  describeContents,
  describeRetention,
  describeSchedule,
  formatBytes,
  relativeTime,
  sortArtifacts,
} from "../lib/presentation";
import { fetchSafetySettings, patchSafetySettings } from "../lib/safetyPoint";
import { BackupDetail } from "./BackupDetail";
import { BackupRuleDialog } from "./BackupRuleDialog";
import { BackupsTable } from "./BackupsTable";
import { DestinationDialog } from "./DestinationDialog";
import { ReadinessBanner } from "./ReadinessBanner";
import { RetentionPreviewDialog } from "./RetentionPreviewDialog";
import type { BackupDestination, BackupPolicy } from "@/lib/app-db/backupRepository";
import type { PruneResult } from "@/lib/backup/prune";

/**
 * The Recovery Center (RD-077 / PR-047e).
 *
 * Ordered by the questions people arrive with, most urgent first: *am I covered
 * right now* (the readiness statement), *where do copies go and are those
 * places working* (destinations), *what is scheduled* (rules), and *which copy
 * do I want* (the inventory).
 *
 * The inventory gets the remaining height because it is the part you scan; the
 * two configuration strips above it are one line per item and stay out of the
 * way. A backup screen that spends its space on the rules rather than on the
 * backups has its priorities the wrong way round — the rules are read twice a
 * year, the copies are read on the worst day of it.
 */

export function BackupsView() {
  const queryClient = useQueryClient();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [destinationDialog, setDestinationDialog] = useState<
    { open: boolean; existing: BackupDestination | null } | null
  >(null);
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; existing: BackupPolicy | null } | null>(
    null
  );
  const [prunePreview, setPrunePreview] = useState<{ policy: BackupPolicy; result: PruneResult } | null>(
    null
  );
  const [refreshing, setRefreshing] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["backup-settings"],
    queryFn: fetchSafetySettings,
  });

  const setSafetyPoints = useMutation({
    mutationFn: (enabled: boolean) => patchSafetySettings({ enabled }),
    onSuccess: (settings) => {
      toast.success(
        settings.enabled
          ? "Bench will take a recovery point before risky changes"
          : "Recovery points before risky changes are off"
      );
      void queryClient.invalidateQueries({ queryKey: ["backup-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const query = useQuery({
    queryKey: ["backups"],
    queryFn: fetchRecoveryCenter,
    // Runs finish while the page is open — a scheduled backup at 2am, a scrub, a
    // manual run in another tab.
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["backups"] });
  };

  const runNow = useMutation({
    mutationFn: backUpNow,
    onSuccess: (result) => {
      // Say what happened. A backup that stored nothing comes back as a 200 with
      // a failed result, and calling that "Backup finished" hides exactly what
      // the user pressed the button to find out.
      if (!result.stored) toast.error(result.message ?? "Nothing could be stored");
      else if (!result.verified) toast.warning(result.message ?? "Stored, but Bench could not read it back");
      else toast.success(result.message ?? "Backed up and verified");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const verify = useMutation({
    mutationFn: () => scrubNow(),
    onSuccess: (results) => {
      const checked = results.reduce((total, entry) => total + entry.checked, 0);
      const bad = results.reduce((total, entry) => total + entry.failed + entry.missing, 0);
      if (bad > 0) toast.error(`${bad} of ${checked} copies are damaged or missing`);
      else if (checked === 0) toast.info("There are no stored copies to verify yet");
      else toast.success(`${checked} copies verified`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const discover = useMutation({
    mutationFn: () => discoverBackups(),
    onSuccess: (results) => {
      const imported = results.reduce((total, entry) => total + entry.imported, 0);
      const notes = results.flatMap((entry) => entry.notes);
      if (imported > 0) toast.success(`Found ${imported} backup(s) not in the inventory`);
      else toast.info(notes[0] ?? "Nothing new — the inventory already matches what is stored");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: testDestination,
    onSuccess: (result) => {
      const failure = result.checks.find((check) => check.status === "fail");
      if (result.ok) toast.success("Wrote a test file and read it back");
      else toast.error(failure?.detail ?? "The destination test failed");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeDestination = useMutation({
    mutationFn: deleteDestination,
    onSuccess: ({ orphanedCopies }) => {
      toast.success(
        orphanedCopies > 0
          ? `Destination removed. ${orphanedCopies} stored copy(ies) are still there — Bench just no longer manages them.`
          : "Destination removed"
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeRule = useMutation({
    mutationFn: deletePolicy,
    onSuccess: ({ keptArtifacts }) => {
      toast.success(
        keptArtifacts > 0
          ? `Rule deleted. Its ${keptArtifacts} backup(s) are kept — deleting a rule never deletes backups.`
          : "Rule deleted"
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const preview = useMutation({
    mutationFn: (policy: BackupPolicy) =>
      previewRetention(policy.id).then((result) => ({ policy, result })),
    onSuccess: (value) => setPrunePreview(value),
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  const data = query.data;
  const artifacts = sortArtifacts(data?.artifacts ?? []);
  const selected = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;

  return (
    <PageLayout
      title="Backups"
      count={
        data ? `${artifacts.length} ${artifacts.length === 1 ? "copy" : "copies"}` : undefined
      }
      scrollManaged
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Refresh backups"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => verify.mutate()}
            disabled={verify.isPending || artifacts.length === 0}
          >
            {verify.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
            Verify now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("/api/backups/recovery-sheet", "_blank")}
          >
            <FileText aria-hidden />
            Recovery sheet
          </Button>
          <Button size="sm" onClick={() => setRuleDialog({ open: true, existing: null })}>
            <Plus aria-hidden />
            New backup rule
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {data && <ReadinessBanner readiness={data.readiness} />}

        {/* Destinations: one line each. Health lives here because a destination
            fails independently of whichever rule discovered it. */}
        <section className="border-b border-border px-4 py-2" aria-labelledby="destinations-heading">
          <div className="flex items-center justify-between gap-2">
            <h2 id="destinations-heading" className="text-xs font-semibold">
              Destinations
            </h2>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => discover.mutate()}
                disabled={discover.isPending || (data?.destinations.length ?? 0) === 0}
              >
                {discover.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ScanSearch aria-hidden />}
                Find backups
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setDestinationDialog({ open: true, existing: null })}
              >
                <Plus aria-hidden />
                Add
              </Button>
            </div>
          </div>

          {(data?.destinations.length ?? 0) === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Nowhere to put a backup yet. Add a folder on this server, or an S3-compatible bucket.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data?.destinations.map((destination) => {
                const broken =
                  destination.lastFailureAt &&
                  (!destination.lastSuccessAt || destination.lastFailureAt > destination.lastSuccessAt);
                return (
                  <li
                    key={destination.id}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <HardDrive
                      className={cn("size-3.5", broken ? "text-destructive" : "text-muted-foreground")}
                      aria-hidden
                    />
                    <span className="font-medium">{destination.name}</span>
                    <span className="text-muted-foreground">
                      {destination.kind === "local"
                        ? String(destination.config.data.path ?? "")
                        : `${String(destination.config.data.bucket ?? "")}${
                            destination.config.data.prefix ? `/${String(destination.config.data.prefix)}` : ""
                          }`}
                    </span>
                    {broken ? (
                      <span className="text-destructive">
                        failed {relativeTime(destination.lastFailureAt)}: {destination.lastFailureReason}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        last wrote {relativeTime(destination.lastSuccessAt)}
                      </span>
                    )}
                    <span className="flex-1" />
                    <button
                      type="button"
                      className="text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => test.mutate(destination.id)}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => setDestinationDialog({ open: true, existing: destination })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => removeDestination.mutate(destination.id)}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Rules: also one line each, with the two actions that matter on them. */}
        <section className="border-b border-border px-4 py-2" aria-labelledby="rules-heading">
          <h2 id="rules-heading" className="text-xs font-semibold">
            Backup rules
          </h2>
          {(data?.policies.length ?? 0) === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No rule yet, so nothing is being copied on a schedule.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data?.policies.map((policy) => (
                <li key={policy.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={cn("font-medium", !policy.enabled && "text-muted-foreground")}>
                    {policy.name}
                  </span>
                  {!policy.enabled && <span className="text-muted-foreground">(paused)</span>}
                  <span className="text-muted-foreground">{describeContents(policy)}</span>
                  <span className="text-muted-foreground">· {describeSchedule(policy)}</span>
                  <span className="text-muted-foreground">· {describeRetention(policy)}</span>
                  {policy.encryption === "passphrase" && (
                    <span className="text-muted-foreground">· encrypted</span>
                  )}
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => runNow.mutate(policy.id)}
                    disabled={runNow.isPending}
                  >
                    {runNow.isPending && runNow.variables === policy.id ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Play aria-hidden />
                    )}
                    Back up now
                  </Button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => preview.mutate(policy)}
                  >
                    Retention
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => setRuleDialog({ open: true, existing: policy })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => removeRule.mutate(policy.id)}
                  >
                    <Trash2 className="inline size-3" aria-hidden /> Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-2 flex items-start gap-2 border-t border-border pt-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settingsQuery.data?.enabled ?? true}
              disabled={setSafetyPoints.isPending || settingsQuery.isLoading}
              onChange={(event) => setSafetyPoints.mutate(event.target.checked)}
            />
            <span>
              <span className="font-medium">Take a recovery point before risky changes</span>
              <span className="block text-muted-foreground">
                Before Bench saves a batch of deletions or payee merges, it copies the budget first —
                so there is something from five minutes ago, not just from last night. Several
                changes in one session share a recovery point, and these expire on their own instead
                of piling up.
              </span>
            </span>
          </label>
        </section>

        {artifacts.length === 0 ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center">
            <h2 className="text-sm font-semibold">No copies yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Once a rule runs, every copy it takes appears here with what Bench found inside it. If
              you already have Bench backups in a destination, use{" "}
              <strong className="font-medium">Find backups</strong> to read them back into the
              inventory.
            </p>
          </div>
        ) : (
          <>
            <p className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
              Total stored: {formatBytes(artifacts.reduce((total, entry) => total + entry.sizeBytes, 0))}.
              Bench never deletes a pinned copy or the newest verified one.
            </p>
            <BackupsTable
              artifacts={artifacts}
              selectedId={selectedArtifactId}
              onOpen={setSelectedArtifactId}
            />
          </>
        )}
      </div>

      {destinationDialog && (
        <DestinationDialog
          open={destinationDialog.open}
          onOpenChange={(open) => setDestinationDialog(open ? destinationDialog : null)}
          existing={destinationDialog.existing}
          onSaved={invalidate}
        />
      )}

      {ruleDialog && data && (
        <BackupRuleDialog
          open={ruleDialog.open}
          onOpenChange={(open) => setRuleDialog(open ? ruleDialog : null)}
          destinations={data.destinations}
          sources={data.sources}
          vaultEnabled={data.vaultEnabled}
          existing={ruleDialog.existing}
          onSaved={invalidate}
        />
      )}

      {prunePreview && (
        <RetentionPreviewDialog
          policy={prunePreview.policy}
          result={prunePreview.result}
          onClose={() => setPrunePreview(null)}
          onApplied={() => {
            setPrunePreview(null);
            invalidate();
          }}
        />
      )}

      {selected && (
        <BackupDetail
          artifact={selected}
          onClose={() => setSelectedArtifactId(null)}
          onChanged={invalidate}
        />
      )}
    </PageLayout>
  );
}
