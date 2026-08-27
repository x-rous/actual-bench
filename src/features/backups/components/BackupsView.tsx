"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  HardDrive,
  Key,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  copyState,
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
import { forgetPassphrase, type PolicyWithAutomation } from "../lib/backupsApi";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { PruneResult } from "@/lib/backup/prune";

type StateFilter = "all" | "verified" | "unverified" | "problem";
type KindFilter = "all" | "budget" | "app-db";

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
  const [ruleDialog, setRuleDialog] = useState<{
    open: boolean;
    existing: PolicyWithAutomation | null;
  } | null>(null);
  const [prunePreview, setPrunePreview] = useState<{
    policy: PolicyWithAutomation;
    result: PruneResult;
  } | null>(null);
  // Every destructive action goes through one confirmation, like the rest of
  // Bench. Deleting a backup is not undoable and should not be one click away.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

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

  const forget = useMutation({
    mutationFn: ({ ref, strand }: { ref: string; strand: boolean }) => forgetPassphrase(ref, strand),
    onSuccess: ({ strandedBackups }) => {
      toast.success(
        strandedBackups > 0
          ? `Passphrase forgotten. ${strandedBackups} encrypted backup(s) can now only be opened with your own copy of it.`
          : "Passphrase forgotten"
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const preview = useMutation({
    mutationFn: (policy: PolicyWithAutomation) =>
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

  const filtered = artifacts.filter((artifact) => {
    if (kindFilter !== "all" && artifact.kind !== kindFilter) return false;
    if (stateFilter === "all") return true;
    const state = copyState(artifact);
    if (stateFilter === "problem") return state === "damaged" || state === "gone";
    return state === stateFilter;
  });

  // The two things that have to happen before anything can be backed up, in
  // the order they have to happen in.
  const needsDestination = (data?.destinations.length ?? 0) === 0;
  const needsRule = !needsDestination && (data?.policies.length ?? 0) === 0;

  const orphanPassphrases = (data?.heldPassphrases ?? []).filter(
    (entry) => !entry.ruleExists && entry.artifactCount > 0
  );

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
          {(data?.destinations.length ?? 0) === 0 ? (
            // The first thing anyone needs is somewhere to put a copy. Offering
            // "New backup rule" first sends them into a dialog they cannot save.
            <Button size="sm" onClick={() => setDestinationDialog({ open: true, existing: null })}>
              <Plus aria-hidden />
              Add a destination
            </Button>
          ) : (
            <Button size="sm" onClick={() => setRuleDialog({ open: true, existing: null })}>
              <Plus aria-hidden />
              New backup rule
            </Button>
          )}
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
                onClick={() =>
                  // Named for what it is, and explained before it runs: this is
                  // the action for the day Bench's own database is gone, and
                  // someone meeting it for the first time cannot tell from two
                  // words whether it is safe to press.
                  setConfirm({
                    title: "Find backups in your destinations?",
                    message: `Bench reads the manifest written beside every backup in ${
                      data?.destinations.length === 1
                        ? `"${data.destinations[0]?.name}"`
                        : `your ${data?.destinations.length ?? 0} destinations`
                    } and adds anything it does not already know about. It only adds — nothing is changed, moved or deleted. Use it after restoring Bench onto a new server, or when a destination holds backups this Bench has never seen.`,
                    destructive: false,
                    destructiveLabel: "Scan destinations",
                    onConfirm: () => discover.mutate(),
                  })
                }
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => test.mutate(destination.id)}
                    >
                      Test
                    </Button>
                    {/* Editing and removing are rarer than testing, and one of
                        them is destructive — so they sit behind a menu rather
                        than beside it with the same visual weight. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`More actions for ${destination.name}`}
                      >
                        <MoreHorizontal className="size-3.5" aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDestinationDialog({ open: true, existing: destination })}
                        >
                          Edit destination
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            setConfirm({
                              title: `Remove "${destination.name}"?`,
                              message:
                                "Bench stops writing here and loses track of the copies in it. The files themselves are left exactly where they are.",
                              destructiveLabel: "Remove",
                              onConfirm: () => removeDestination.mutate(destination.id),
                            })
                          }
                        >
                          Remove destination
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                // Two lines rather than one long one: identity and state on
                // top, the settings underneath. A single row packed with seven
                // facts and five actions reads fine at desk width and collapses
                // into a block on anything narrower.
                <li key={policy.id} className="flex items-start gap-2 py-0.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("font-medium", !policy.enabled && "text-muted-foreground")}>
                        {policy.name}
                      </span>
                      {/* The rule says what should happen; its automation says
                          what does. When they disagree — a health auto-pause,
                          or Pause pressed on the Automations page — the page
                          shows the one that is true, not the comfortable one. */}
                      {!policy.enabled ? (
                        <span className="text-muted-foreground">paused</span>
                      ) : policy.automation?.autoPausedAt ? (
                        <span className="text-destructive">
                          paused after repeated failures: {policy.automation.autoPauseReason}
                        </span>
                      ) : policy.automation && !policy.automation.enabled ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          paused on the Automations page — not running
                        </span>
                      ) : policy.automation?.running ? (
                        <span className="text-muted-foreground">running now…</span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-x-2 text-muted-foreground">
                      <span>{describeContents(policy)}</span>
                      <span>· {describeSchedule(policy)}</span>
                      <span>· {describeRetention(policy)}</span>
                      {policy.encryption === "passphrase" && <span>· encrypted</span>}
                      {policy.automation?.lastRunAt && (
                        <span>· last run {relativeTime(policy.automation.lastRunAt)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
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

                    {/* "Back up now" is the action people come here for. The
                        rest — including the one that deletes things — belongs
                        behind a menu, not beside it at equal weight. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`More actions for ${policy.name}`}
                      >
                        <MoreHorizontal className="size-3.5" aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => preview.mutate(policy)}>
                          Preview retention…
                        </DropdownMenuItem>
                        <DropdownMenuItem render={<Link href="/automations" />}>
                          Run history
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setRuleDialog({ open: true, existing: policy })}
                        >
                          Edit rule
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            setConfirm({
                              title: `Delete "${policy.name}"?`,
                              message:
                                policy.encryption === "passphrase"
                                  ? "It stops running. The backups it already took are kept, and so is the passphrase that opens them — Bench forgets that only once the last encrypted copy is gone."
                                  : "It stops running. The backups it already took are kept and stay restorable.",
                              destructiveLabel: "Delete rule",
                              onConfirm: () => removeRule.mutate(policy.id),
                            })
                          }
                        >
                          Delete rule
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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

        {/* Secrets Bench is holding on behalf of rules that no longer exist.
            Kept because a backup you cannot open is worse than a secret you
            meant to remove — and listed because keeping it silently would be
            the wrong half of that trade. */}
        {orphanPassphrases.length > 0 && (
          <section className="border-b border-border px-4 py-2 text-xs">
            <h2 className="font-semibold">Passphrases Bench still holds</h2>
            <ul className="mt-1 space-y-1">
              {orphanPassphrases.map((entry) => (
                <li key={entry.ref} className="flex flex-wrap items-center gap-2">
                  <Key className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{entry.label}</span>
                  <span className="text-muted-foreground">
                    its rule is gone, but {entry.artifactCount} encrypted backup
                    {entry.artifactCount === 1 ? "" : "s"} still need
                    {entry.artifactCount === 1 ? "s" : ""} it
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() =>
                      setConfirm({
                        title: "Forget this passphrase?",
                        message: `${entry.artifactCount} encrypted backup${
                          entry.artifactCount === 1 ? "" : "s"
                        } can only be opened with it. Forget it and they are unrecoverable unless you have written it down somewhere else.`,
                        destructiveLabel: "Forget it",
                        onConfirm: () => forget.mutate({ ref: entry.ref, strand: true }),
                      })
                    }
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {artifacts.length === 0 ? (
          <div className="mx-auto max-w-xl px-6 py-12">
            <h2 className="text-sm font-semibold">
              {needsDestination
                ? "Start by choosing where copies go"
                : needsRule
                  ? "Now say what to copy, and how often"
                  : "No copies yet"}
            </h2>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li className={cn("flex gap-2", !needsDestination && "text-foreground/60 line-through")}>
                <span aria-hidden>1.</span>
                <span>
                  Add a <strong className="font-medium">destination</strong> — a folder on this
                  server, or an S3-compatible bucket. Two of them, if you want to survive losing the
                  machine.
                </span>
              </li>
              <li className={cn("flex gap-2", !needsRule && !needsDestination && "text-foreground/60 line-through")}>
                <span aria-hidden>2.</span>
                <span>
                  Add a <strong className="font-medium">backup rule</strong>: what to copy, where,
                  and when.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden>3.</span>
                <span>
                  Bench takes the copy, opens it to check it is readable, and lists it here with what
                  it found inside.
                </span>
              </li>
            </ol>

            {/* The prerequisite that is invisible until it bites: a scheduled
                backup runs with the browser closed, so it needs credentials the
                server can use on its own. */}
            {!needsDestination && (data?.sources.length ?? 0) === 0 && (
              <p className="mt-4 rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                To back up a budget on a schedule, Bench needs a connection enrolled for unattended
                use — a scheduled backup runs with no browser open.{" "}
                <Link href="/sync" className="underline underline-offset-4">
                  Enrol one in Budget File Sync
                </Link>
                . Without that you can still back up Bench&rsquo;s own settings.
              </p>
            )}

            {!needsDestination && !needsRule && (
              <p className="mt-4 text-xs text-muted-foreground">
                Already have Bench backups in a destination? Use{" "}
                <strong className="font-medium">Find backups</strong> to read them back into the
                inventory.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-xs">
              <span className="text-muted-foreground">
                {filtered.length === artifacts.length
                  ? `${artifacts.length} ${artifacts.length === 1 ? "copy" : "copies"}`
                  : `${filtered.length} of ${artifacts.length}`}
                , {formatBytes(filtered.reduce((total, entry) => total + entry.sizeBytes, 0))}
              </span>

              <select
                className="h-6 rounded-md border border-input bg-background px-1.5 text-xs"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value as StateFilter)}
                aria-label="Filter by state"
              >
                <option value="all">Any state</option>
                <option value="verified">Verified</option>
                <option value="unverified">Not checked</option>
                <option value="problem">Damaged or missing</option>
              </select>

              <select
                className="h-6 rounded-md border border-input bg-background px-1.5 text-xs"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as KindFilter)}
                aria-label="Filter by contents"
              >
                <option value="all">Anything</option>
                <option value="budget">Budgets</option>
                <option value="app-db">Bench settings</option>
              </select>

              <span className="flex-1" />
              <span className="text-muted-foreground">
                Pinned copies and the newest verified one are never deleted. Backups you take by hand
                are kept until you delete them.
              </span>
            </div>
            <BackupsTable
              artifacts={filtered}
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

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        state={confirm}
      />

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
