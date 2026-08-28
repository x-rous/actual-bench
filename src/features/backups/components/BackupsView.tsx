"use client";

import { useState } from "react";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { PageLayout } from "@/components/layout/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { copyState, sortArtifacts } from "../lib/presentation";
import { fetchSafetySettings, patchSafetySettings } from "../lib/safetyPoint";
import { BackupDetail } from "./BackupDetail";
import { InventoryTab, type KindFilter, type StateFilter } from "./InventoryTab";
import { SetupTab } from "./SetupTab";
import { BackupRuleDialog } from "./BackupRuleDialog";
import { DestinationDialog } from "./DestinationDialog";
import { RetentionPreviewDialog } from "./RetentionPreviewDialog";
import { forgetPassphrase, type PolicyWithAutomation } from "../lib/backupsApi";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { PruneResult } from "@/lib/backup/prune";

/**
 * The Recovery Center (RD-077 / PR-047).
 *
 * Two tabs, split by the two different jobs people come here to do. **Setup**
 * decides what happens — where copies go, what is copied and when, and whether
 * Bench takes one before you do something risky. **Backups** is what came of
 * it: the copies that exist, how old they are, whether they have been opened
 * and read, and where they live.
 *
 * The split is by task, not by object type: separate Destinations, Rules and
 * Recovery tabs would make configuring one backup a tour of three screens, when
 * the three decisions are made together, once, in that order.
 *
 * Configuration is read twice a year; the inventory is read on the worst day of
 * it — so the inventory keeps the full height and Setup keeps its actions
 * beside the sections they act on, where "Add" can say what it adds.
 *
 * This shell owns the data, the mutations and every dialog, because both tabs
 * act on the same query and a confirmation raised in one must survive switching
 * to the other.
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

  // Same sessionStorage-backed pattern the entity pages use for their filters,
  // so the tab and the filters survive navigating away and back within a tab.
  // `tab: null` means "not chosen yet", which is what lets a fresh install open
  // on Setup without overriding a choice someone has actually made.
  const [view, setView] = usePersistedFilters<{
    tab: "setup" | "backups" | null;
    stateFilter: StateFilter;
    kindFilter: KindFilter;
  }>("filters:backups", { tab: null, stateFilter: "all", kindFilter: "all" });

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
      else toast.info(notes[0] ?? "Nothing new - the inventory already matches what is stored");
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
          ? `Destination removed. ${orphanedCopies} stored copy(ies) are still there - Bench just no longer manages them.`
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
          ? `Rule deleted. Its ${keptArtifacts} backup(s) are kept - deleting a rule never deletes backups.`
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
    if (view.kindFilter !== "all" && artifact.kind !== view.kindFilter) return false;
    if (view.stateFilter === "all") return true;
    const state = copyState(artifact);
    if (view.stateFilter === "problem") return state === "damaged" || state === "gone";
    return state === view.stateFilter;
  });

  // The two things that have to happen before anything can be backed up, in
  // the order they have to happen in.
  const needsDestination = (data?.destinations.length ?? 0) === 0;
  const needsRule = !needsDestination && (data?.policies.length ?? 0) === 0;

  const orphanPassphrases = (data?.heldPassphrases ?? []).filter(
    (entry) => !entry.ruleExists && entry.artifactCount > 0
  );

  // A fresh install opens on Setup, because there is nothing else to look at
  // and the tab someone needs first is the one they have not used. Once a
  // choice has been made it wins — including the choice to sit on Setup.
  const tab = view.tab ?? (needsDestination || needsRule ? "setup" : "backups");
  const setTab = (next: string) => setView((current) => ({ ...current, tab: next as "setup" | "backups" }));

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
        // Refresh belongs to the page. Verify and the recovery sheet act on the
        // inventory, so they appear with it; Setup's own actions sit beside the
        // sections they act on, where "Add" can say what it adds.
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Refresh backups"
            title="Re-read destinations, rules and the inventory"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            Refresh
          </Button>
          {tab === "backups" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => verify.mutate()}
                disabled={verify.isPending || artifacts.length === 0}
                title="Re-read the newest copies in every destination: are they present, the right size, and still readable?"
              >
                {verify.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck aria-hidden />
                )}
                Verify now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/api/backups/recovery-sheet", "_blank")}
                title="Download a printable page telling you how to restore these backups without Bench - paths, object keys, checksums and commands"
              >
                <FileText aria-hidden />
                Recovery sheet
              </Button>
            </>
          )}
        </>
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Styling comes from the shared tab component - the underline
            indicator every other tabbed page in Bench uses - rather than a
            second look invented here. */}
        <TabsList className="px-2">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="backups">
            Backups
            {artifacts.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">{artifacts.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {data && (
            <SetupTab
              data={data}
              discovering={discover.isPending}
              runningPolicyId={runNow.isPending ? (runNow.variables ?? null) : null}
              safetyEnabled={settingsQuery.data?.enabled ?? true}
              safetyPending={setSafetyPoints.isPending || settingsQuery.isLoading}
              orphanPassphrases={orphanPassphrases}
              onAddDestination={() => setDestinationDialog({ open: true, existing: null })}
              onEditDestination={(destination) =>
                setDestinationDialog({ open: true, existing: destination })
              }
              onRemoveDestination={(destination) =>
                setConfirm({
                  title: `Remove "${destination.name}"?`,
                  message:
                    "Bench stops writing here and loses track of the copies in it. The files themselves are left exactly where they are.",
                  destructiveLabel: "Remove",
                  onConfirm: () => removeDestination.mutate(destination.id),
                })
              }
              onTestDestination={(destinationId) => test.mutate(destinationId)}
              onScanDestinations={() => discover.mutate()}
              onNewRule={() => setRuleDialog({ open: true, existing: null })}
              onEditRule={(policy) => setRuleDialog({ open: true, existing: policy })}
              onDeleteRule={(policy) =>
                setConfirm({
                  title: `Delete "${policy.name}"?`,
                  message:
                    policy.encryption === "passphrase"
                      ? "It stops running. The backups it already took are kept, and so is the passphrase that opens them - Bench forgets that only once the last encrypted copy is gone."
                      : "It stops running. The backups it already took are kept and stay restorable.",
                  destructiveLabel: "Delete rule",
                  onConfirm: () => removeRule.mutate(policy.id),
                })
              }
              onRunNow={(policyId) => runNow.mutate(policyId)}
              onPreviewRetention={(policy) => preview.mutate(policy)}
              onForgetPassphrase={(entry) =>
                setConfirm({
                  title: "Forget this passphrase?",
                  message: `${entry.artifactCount} encrypted backup${
                    entry.artifactCount === 1 ? "" : "s"
                  } can only be opened with it. Forget it and they are unrecoverable unless you have written it down somewhere else.`,
                  destructiveLabel: "Forget it",
                  onConfirm: () => forget.mutate({ ref: entry.ref, strand: true }),
                })
              }
              onToggleSafetyPoints={(enabled) => setSafetyPoints.mutate(enabled)}
            />
          )}
        </TabsContent>

        <TabsContent value="backups" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {data && (
            <InventoryTab
              data={data}
              artifacts={artifacts}
              filtered={filtered}
              stateFilter={view.stateFilter}
              kindFilter={view.kindFilter}
              selectedArtifactId={selectedArtifactId}
              needsDestination={needsDestination}
              needsRule={needsRule}
              onStateFilter={(value) => setView((current) => ({ ...current, stateFilter: value }))}
              onKindFilter={(value) => setView((current) => ({ ...current, kindFilter: value }))}
              onOpenArtifact={setSelectedArtifactId}
              onGoToSetup={() => setTab("setup")}
            />
          )}
        </TabsContent>
      </Tabs>

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
