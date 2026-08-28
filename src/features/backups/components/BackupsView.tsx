"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SortDirection } from "@/components/ui/sortable-header";
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
  byNewestFirst,
  filterArtifacts,
  sortArtifacts,
} from "../lib/presentation";
import { fetchSafetySettings, patchSafetySettings } from "../lib/safetyPoint";
import { BackupDetail } from "./BackupDetail";
import { InventoryTab, type KindFilter, type StateFilter } from "./InventoryTab";
import type { BackupSortKey } from "./BackupsTable";
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

/** Matches the workbench tabs on Budget File Health, deliberately. */
const TAB_CLASS =
  "flex flex-1 items-center justify-center gap-1 rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-2 py-2 text-[12px] font-medium text-muted-foreground transition-colors after:hidden hover:text-foreground focus-visible:ring-0 data-[active]:border-primary data-[active]:text-foreground lg:flex-none lg:px-6";

export function BackupsView() {
  const queryClient = useQueryClient();
  const params = useSearchParams();
  // Arriving from "New automation -> Backup" is a create intent, not a browse:
  // land on Setup with the dialog open rather than on a list of old copies.
  const wantsNewRule = params.get("new") === "rule";
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [destinationDialog, setDestinationDialog] = useState<
    { open: boolean; existing: BackupDestination | null } | null
  >(null);
  const [ruleDialog, setRuleDialog] = useState<{
    open: boolean;
    existing: PolicyWithAutomation | null;
  } | null>(wantsNewRule ? { open: true, existing: null } : null);
  const [prunePreview, setPrunePreview] = useState<{
    policy: PolicyWithAutomation;
    result: PruneResult;
  } | null>(null);
  // Every destructive action goes through one confirmation, like the rest of
  // Bench. Deleting a backup is not undoable and should not be one click away.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters persist, the way the entity pages persist theirs. The tab does not:
  // it is where you are looking right now, not a preference. Arriving at the
  // page should land on the copies when there are copies - having once opened
  // Setup should not mean every later visit starts on the settings.
  const [view, setView] = usePersistedFilters<{
    search: string;
    stateFilter: StateFilter;
    kindFilter: KindFilter;
    budget: string;
    policyId: string;
    sortKey: BackupSortKey | null;
    sortDirection: SortDirection;
  }>("filters:backups", {
    search: "",
    stateFilter: "all",
    kindFilter: "all",
    budget: "",
    policyId: "",
    sortKey: null,
    sortDirection: null,
  });
  const [chosenTab, setChosenTab] = useState<"setup" | "backups" | null>(
    wantsNewRule ? "setup" : null
  );

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
      else if (!result.verified) {
        toast.warning(result.message ?? "Stored, but Bench could not read it back");
      } else toast.success(result.message ?? "Backed up and verified");
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
  const artifacts = byNewestFirst(data?.artifacts ?? []);
  const selected = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;

  const sort =
    view.sortKey && view.sortDirection ? { key: view.sortKey, direction: view.sortDirection } : null;

  const filtered = sortArtifacts(
    filterArtifacts(artifacts, data?.policies ?? [], {
      search: view.search,
      state: view.stateFilter,
      kind: view.kindFilter,
      budget: view.budget,
      policyId: view.policyId,
    }),
    data?.policies ?? [],
    sort
  );

  // The two things that have to happen before anything can be backed up, in
  // the order they have to happen in.
  const needsDestination = (data?.destinations.length ?? 0) === 0;
  const needsRule = !needsDestination && (data?.policies.length ?? 0) === 0;

  const orphanPassphrases = (data?.heldPassphrases ?? []).filter(
    (entry) => !entry.ruleExists && entry.artifactCount > 0
  );

  // Land on the copies when there are copies, and on Setup when there is
  // nothing to look at yet. A choice made during this visit wins until you
  // leave the page.
  //
  // Only decided once the data is in: the tab strip is part of the page header,
  // so it renders while the query is still running, and reading "nothing here"
  // from an empty loading state made the page open on Setup and jump a moment
  // later.
  const tab = chosenTab ?? (data && artifacts.length === 0 ? "setup" : "backups");
  const setTab = (next: string) => setChosenTab(next as "setup" | "backups");

  return (
    // The Tabs root wraps the layout so the tab strip can serve as the page's
    // toolbar: a title bar above two tabs is a second header repeating the tab
    // you are already on. Actions move into each tab, beside what they act on.
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <PageLayout
        header={
          // Refresh sits with the tabs because it refreshes both of them. Given
          // a row of its own it read as a page element with nothing to be part
          // of; inside a section it read as though it only refreshed that
          // section.
          <div className="flex items-center justify-between gap-2 border-b border-border pr-3">
            {/* The border moves to this row: left on the list, the underline
                ran out where the tabs did and stopped short of the button. */}
            <TabsList className="flex-1 border-b-0">
              <TabsTrigger value="setup" className={TAB_CLASS}>
                Setup
              </TabsTrigger>
              <TabsTrigger value="backups" className={TAB_CLASS}>
                Backups
              </TabsTrigger>
            </TabsList>
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 text-xs"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              aria-label="Refresh backups"
              title="Re-read destinations, backup rules and the inventory"
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
              Refresh
            </Button>
            <Button
              size="sm"
              className="h-6 shrink-0 text-xs"
              onClick={() => setRuleDialog({ open: true, existing: null })}
              disabled={(data?.destinations.length ?? 0) === 0}
              title={
                (data?.destinations.length ?? 0) === 0
                  ? "Add a destination first - a rule needs somewhere to write"
                  : "Choose what to copy, where to put it, how often, and how long to keep it"
              }
            >
              <Plus aria-hidden />
              New backup rule
            </Button>
          </div>
        }
        scrollManaged
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <TabsContent value="setup" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {data && (
            <SetupTab
              data={data}
              discovering={discover.isPending}
              runningPolicyId={runNow.isPending ? (runNow.variables ?? null) : null}
              safetyEnabled={settingsQuery.data?.enabled ?? false}
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
              onVerify={() => verify.mutate()}
              verifying={verify.isPending}
              data={data}
              artifacts={artifacts}
              filtered={filtered}
              search={view.search}
              stateFilter={view.stateFilter}
              kindFilter={view.kindFilter}
              budget={view.budget}
              policyId={view.policyId}
              sort={sort}
              selectedArtifactId={selectedArtifactId}
              needsDestination={needsDestination}
              needsRule={needsRule}
              onSearch={(value) => setView((current) => ({ ...current, search: value }))}
              onStateFilter={(value) => setView((current) => ({ ...current, stateFilter: value }))}
              onKindFilter={(value) => setView((current) => ({ ...current, kindFilter: value }))}
              onBudget={(value) => setView((current) => ({ ...current, budget: value }))}
              onPolicy={(value) => setView((current) => ({ ...current, policyId: value }))}
              onSort={(sortKey, sortDirection) =>
                setView((current) => ({
                  ...current,
                  sortKey: sortDirection ? sortKey : null,
                  sortDirection,
                }))
              }
              onClearFilters={() =>
                setView((current) => ({
                  ...current,
                  search: "",
                  stateFilter: "all",
                  kindFilter: "all",
                  budget: "",
                  policyId: "",
                }))
              }
              onOpenArtifact={setSelectedArtifactId}
              onGoToSetup={() => setTab("setup")}
            />
          )}
        </TabsContent>
      </PageLayout>

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
    </Tabs>
  );
}
